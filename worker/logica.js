/* ============================================================
   logica.js — todo lo que no habla con nadie.

   Elegir qué atributos completar, convertir lo que dice la IA en
   valores que MercadoLibre acepta y armar el cuerpo de POST /items.
   Está separado del Worker para poder testearlo con node sin red
   (node test.mjs).
   ============================================================ */

/** Condición tal como la nombra la IA → los dos campos que espera MercadoLibre. */
export const CONDICIONES = {
  nuevo: { condition: 'new', item_condition: 'Nuevo' },
  usado: { condition: 'used', item_condition: 'Usado' },
  reacondicionado: { condition: 'used', item_condition: 'Reacondicionado' }
};

/* Atributos que se manejan aparte: la condición sale de su propio campo y el
   código de barras se resuelve con EMPTY_GTIN_REASON si no hay. */
const APARTE = new Set(['ITEM_CONDITION', 'EMPTY_GTIN_REASON', 'SELLER_SKU']);

/* Cuántos atributos opcionales se le piden a la IA, además de los obligatorios.
   Más atributos = mejor ficha técnica, pero más tokens y más cosas para revisar. */
const MAX_OPCIONALES = 12;

/* Una lista de valores larga no le sirve a la IA y cuesta tokens: arriba de esto
   va sin opciones y escribe el valor libre. */
const MAX_OPCIONES = 60;

/**
 * Qué atributos de la categoría vale la pena completar: los obligatorios
 * siempre, y los más relevantes hasta un tope. Nunca los de uso interno.
 */
export function elegirAtributos(atributos, condicion) {
  const esNuevo = condicion === 'nuevo';
  const usables = atributos.filter(a => {
    const t = a.tags || {};
    return !t.read_only && !t.fixed && !t.inferred && !APARTE.has(a.id);
  });

  const requerido = a => {
    const t = a.tags || {};
    return !!(t.required || t.catalog_required || t.conditional_required || (esNuevo && t.new_required));
  };

  const obligatorios = usables.filter(requerido);
  const opcionales = usables
    .filter(a => !requerido(a) && !(a.tags || {}).hidden && !(a.tags || {}).variation_attribute)
    .sort((x, y) => (x.relevance || 9) - (y.relevance || 9))
    .slice(0, MAX_OPCIONALES);

  return [...obligatorios, ...opcionales].map(a => ({
    id: a.id,
    nombre: a.name,
    tipo: a.value_type,
    requerido: requerido(a),
    unidades: (a.allowed_units || []).map(u => u.name),
    opciones: (a.values || []).length <= MAX_OPCIONES ? (a.values || []).map(v => ({ id: v.id, nombre: v.name })) : []
  }));
}

const sinAcentos = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Lo que escribió la IA (o Nico en la revisión) → atributo para MercadoLibre.
 * Si el atributo tiene lista de valores y el texto coincide con uno, va con su
 * value_id; si no, va como value_name libre y MercadoLibre lo valida.
 */
export function atributoParaML(attr, valor) {
  const texto = String(valor ?? '').trim();
  if (!texto) return null;
  const match = (attr.opciones || []).find(o => sinAcentos(o.nombre) === sinAcentos(texto));
  return match ? { id: attr.id, value_id: match.id, value_name: match.nombre } : { id: attr.id, value_name: texto };
}

/** Recorta el título al largo de la categoría sin cortar una palabra al medio. */
export function recortarTitulo(titulo, max = 60) {
  const t = String(titulo || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const corte = t.slice(0, max + 1).lastIndexOf(' ');
  return (corte > max * 0.6 ? t.slice(0, corte) : t.slice(0, max)).trim();
}

/**
 * Descripción en texto plano: MercadoLibre rechaza HTML y emojis, y marca la
 * posición del primer carácter inválido. Se limpia antes de mandarla.
 */
export function limpiarDescripcion(texto) {
  return String(texto || '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ---------- envío: peso y medidas del paquete ---------- */

const MEDIDA_PAQUETE = { pesoG: 'SELLER_PACKAGE_WEIGHT', largoCm: 'SELLER_PACKAGE_LENGTH', anchoCm: 'SELLER_PACKAGE_WIDTH', altoCm: 'SELLER_PACKAGE_HEIGHT' };

/**
 * Peso (gramos) y medidas (cm) del paquete tal como las cargó Nico → número entero
 * por cada una, o null si falta alguna o no es un número mayor a cero. Los
 * atributos SELLER_PACKAGE_* de MercadoLibre solo aceptan g y cm.
 */
export function leerPaquete(paquete) {
  if (!paquete) return null;
  const v = {};
  for (const k of Object.keys(MEDIDA_PAQUETE)) {
    const n = Math.round(Number(String(paquete[k] ?? '').replace(',', '.')));
    if (!Number.isFinite(n) || n <= 0) return null;
    v[k] = n;
  }
  return v;
}

/**
 * Cómo se declara el paquete en el ítem. Las cuentas con User Products lo mandan como
 * atributos SELLER_PACKAGE_*; las anteriores, en shipping.dimensions ("AltoxAnchoxLargo,pesoEnGramos").
 */
export function paqueteParaML(paquete, { userProducts }) {
  const p = leerPaquete(paquete);
  if (!p) return null;
  return userProducts
    ? { atributos: [
        { id: MEDIDA_PAQUETE.pesoG, value_name: `${p.pesoG} g` },
        { id: MEDIDA_PAQUETE.largoCm, value_name: `${p.largoCm} cm` },
        { id: MEDIDA_PAQUETE.anchoCm, value_name: `${p.anchoCm} cm` },
        { id: MEDIDA_PAQUETE.altoCm, value_name: `${p.altoCm} cm` }] }
    : { dimensions: `${p.altoCm}x${p.anchoCm}x${p.largoCm},${p.pesoG}` };
}

/** "45 cm", "1,2 m", "800 mm" o "45" (sin unidad = cm) → centímetros enteros; null si no se entiende. */
export function aCentimetros(texto) {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m|"|in|pulgadas?)?\s*$/i.exec(String(texto ?? ''));
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  const u = (m[2] || 'cm').toLowerCase();
  const cm = u === 'mm' ? n / 10 : u === 'm' ? n * 100 : /^(in|"|pulgada)/.test(u) ? n * 2.54 : n;
  return cm > 0 ? Math.max(1, Math.round(cm)) : null;
}

/** "800 g", "1,5 kg", "2 lb" o "800" (sin unidad = g) → gramos enteros; null si no se entiende. */
export function aGramos(texto) {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(mg|g|kg|lb|oz)?\s*$/i.exec(String(texto ?? ''));
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  const u = (m[2] || 'g').toLowerCase();
  const g = u === 'mg' ? n / 1000 : u === 'kg' ? n * 1000 : u === 'lb' ? n * 453.592 : u === 'oz' ? n * 28.3495 : n;
  return g > 0 ? Math.max(1, Math.round(g)) : null;
}

/**
 * El cuerpo de POST /items (y de /items/validate, que es el mismo).
 *
 * p: lo que quedó en la pantalla de revisión.
 * userProducts: si la cuenta tiene el tag user_product_seller, el nombre va en
 * family_name y NO se manda title (modelo nuevo de MercadoLibre).
 */
export function armarItem(p, { userProducts }) {
  const cond = CONDICIONES[p.condicion] || CONDICIONES.usado;
  const titulo = recortarTitulo(p.titulo, p.maxTitulo || 60);

  const atributos = [];
  for (const a of p.atributos || []) {
    const conv = atributoParaML(a, a.valor);
    if (conv) atributos.push(conv);
  }
  atributos.push({ id: 'ITEM_CONDITION', value_name: cond.item_condition });

  // Sin código de barras: hay que decir por qué, si la categoría lo pide.
  const tieneGtin = atributos.some(a => a.id === 'GTIN');
  if (!tieneGtin && p.pideGtin) {
    atributos.push({ id: 'EMPTY_GTIN_REASON', value_name: 'El producto no tiene código registrado' });
  }

  const item = {
    category_id: p.categoria,
    price: Math.round(Number(p.precio)),
    currency_id: 'ARS',
    available_quantity: Math.max(1, Math.round(Number(p.cantidad) || 1)),
    buying_mode: 'buy_it_now',
    listing_type_id: p.tipoPublicacion || 'gold_special',
    condition: cond.condition,
    pictures: (p.fotos || []).map(id => ({ id })),
    attributes: atributos
  };
  if (userProducts) item.family_name = titulo;
  else item.title = titulo;

  // Muebles y cosas grandes: sin Mercado Envíos, se retira en persona.
  if (p.envio === 'retiro') {
    item.shipping = { mode: 'not_specified', local_pick_up: true, free_shipping: false };
  } else {
    // Con envío: peso y medidas del paquete (si se cargaron) para que MercadoLibre calcule el costo.
    const paquete = paqueteParaML(p.paquete, { userProducts });
    if (paquete?.atributos) item.attributes.push(...paquete.atributos);
    if (p.envio === 'me2') {
      item.shipping = { mode: 'me2', local_pick_up: !!p.retiroTambien, free_shipping: !!p.envioGratis };
      if (paquete?.dimensions) item.shipping.dimensions = paquete.dimensions;
    } else if (paquete?.dimensions) {
      item.shipping = { dimensions: paquete.dimensions };
    }
  }

  if (p.garantia) {
    item.sale_terms = [{ id: 'WARRANTY_TYPE', value_name: p.garantia }];
    if (p.garantia !== 'Sin garantía' && p.garantiaTiempo) {
      item.sale_terms.push({ id: 'WARRANTY_TIME', value_name: p.garantiaTiempo });
    }
  }
  return item;
}

/**
 * ¿Es un código de barras real? GTIN-8, 12 (UPC), 13 (EAN) o 14, con su dígito
 * verificador. La IA lee los números de abajo del código en la foto, y un
 * dígito mal leído no puede llegar a MercadoLibre como dato del producto.
 */
export function gtinValido(codigo) {
  const d = String(codigo || '').replace(/[\s-]/g, '');
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(d)) return false;
  const nums = [...d].map(Number);
  const verificador = nums.pop();
  const suma = nums.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (suma % 10)) % 10 === verificador;
}

/**
 * El GTIN sale solo del código leído en la foto, y solo si es válido. Si la
 * segunda llamada a la IA completó uno que no pasa el verificador, se borra:
 * mejor que MercadoLibre lo pida a que quede un código inventado.
 */
export function aplicarGtin(atributos, codigoLeido) {
  const limpio = String(codigoLeido || '').replace(/[\s-]/g, '');
  return atributos.map(a => {
    if (a.id !== 'GTIN') return a;
    if (gtinValido(limpio)) return { ...a, valor: limpio };
    return gtinValido(a.valor) ? a : { ...a, valor: '' };
  });
}

/** Lo que muestra el historial de un registro: liviano, sin las fotos grandes. */
export function resumenRegistro(reg) {
  const p = reg.publicacion || {};
  const a = reg.analisis?.propuesta || {};
  return {
    id: reg.id,
    creado: reg.creado,
    actualizado: reg.actualizado,
    titulo: p.titulo || a.titulo || reg.analisis?.identificacion?.producto || 'Sin título',
    precio: Number(p.precio || a.precio) || 0,
    estado: reg.estado || 'borrador',
    thumb: reg.thumb || '',
    permalink: reg.ml?.permalink || '',
    mlId: reg.ml?.id || null
  };
}

/* ---------- seguimiento de publicaciones ---------- */

/** Estado legible de una publicación según lo que devuelve /items.
 *  Una usada de una sola unidad, al venderse, queda closed o paused sin stock: las dos son "vendida". */
export function estadoPublicacion(item) {
  if (!item?.status) return 'desconocido';
  const sub = item.sub_status || [];
  const vendio = (item.sold_quantity || 0) > 0;
  if (item.status === 'active') return sub.includes('under_review') ? 'en_revision' : 'activa';
  if (item.status === 'paused') return vendio && sub.includes('out_of_stock') ? 'vendida' : 'pausada';
  if (item.status === 'closed') return vendio ? 'vendida' : 'finalizada';
  if (item.status === 'under_review') return 'en_revision';
  return item.status;
}

/** Junta ítems, visitas y preguntas sin responder en un resumen por id de MercadoLibre. */
export function armarSeguimiento(items, visitas = {}, preguntas = []) {
  const porItem = {};
  for (const it of items) {
    if (!it?.id) continue;
    porItem[it.id] = {
      estado: estadoPublicacion(it),
      vendidas: it.sold_quantity || 0,
      disponibles: Number.isFinite(it.available_quantity) ? it.available_quantity : null,
      precio: Number.isFinite(it.price) ? it.price : null,
      visitas: Number.isFinite(visitas[it.id]) ? visitas[it.id] : null,
      preguntas: 0
    };
  }
  for (const q of preguntas) if (porItem[q?.item_id]) porItem[q.item_id].preguntas++;
  return porItem;
}

/* ---------- acciones sobre una publicación ---------- */

const err400 = m => Object.assign(new Error(m), { status: 400 });

/** Cuerpo del PUT /items/{id} para cada acción de la app. */
export function cambioPublicacion(accion, precio) {
  if (accion === 'precio') {
    const p = Math.round(Number(precio));
    if (!Number.isFinite(p) || p <= 0) throw err400('El precio tiene que ser un número mayor a cero.');
    return { price: p };
  }
  const estados = { pausar: 'paused', reactivar: 'active', vendida: 'closed' };
  if (!estados[accion]) throw err400('Acción desconocida.');
  return { status: estados[accion] };
}

/** La respuesta a una pregunta: texto plano, hasta 2000 caracteres, sin links, mails ni teléfonos (MercadoLibre los rechaza). */
export function validarRespuesta(texto) {
  const t = String(texto || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (t.length < 2) throw err400('Escribí la respuesta.');
  if (/https?:\/\/|www\.|@|\d[\d .-]{7,}\d/i.test(t)) throw err400('MercadoLibre no deja links, mails ni teléfonos en las respuestas.');
  return t.slice(0, 2000);
}

/** Los parecidos más cercanos al precio sugerido, para comparar a ojo. */
export function elegirParecidos(resultados, sugerido, n = 5) {
  return (resultados || [])
    .filter(r => r?.title && Number(r.price) > 0 && r.permalink)
    .sort((a, b) => Math.abs(a.price - sugerido) - Math.abs(b.price - sugerido))
    .slice(0, n)
    .map(r => ({ titulo: r.title, precio: Number(r.price), permalink: r.permalink, thumb: r.thumbnail || '' }));
}

/* ---------- costos y ganancia ---------- */

const numero = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };

/**
 * Lo que cobra MercadoLibre por vender, por cada tipo de publicación, a partir de
 * la respuesta de GET /sites/MLA/listing_prices?price=..&category_id=.. (un arreglo
 * con un elemento por tipo: sale_fee_amount y sale_fee_details con el porcentaje y
 * el cargo fijo). Se descarta lo que no tiene forma de comisión.
 */
export function leerComisiones(respuesta) {
  const lista = Array.isArray(respuesta) ? respuesta : respuesta ? [respuesta] : [];
  return lista
    .filter(r => r && typeof r.listing_type_id === 'string' && informado(r.sale_fee_amount) !== null && informado(r.sale_fee_amount) >= 0)
    .map(r => {
      const d = r.sale_fee_details || {};
      return {
        id: r.listing_type_id,
        nombre: r.listing_type_name || r.listing_type_id,
        comision: Math.round(informado(r.sale_fee_amount) * 100) / 100,
        pct: informado(d.percentage_fee),    // null = MercadoLibre no lo informó (nunca 0 por defecto)
        fijo: informado(d.fixed_fee)
      };
    });
}

/** Un número que MercadoLibre realmente informó: null, "", ausente o no numérico → null (Number(null) daría 0, y 0 no es "sin dato"). */
function informado(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/**
 * ¿Cuánto queda? precio − comisión − envío a cargo − costo del producto.
 * Todo en pesos y por unidad. `neto` es lo que acredita MercadoLibre (antes del costo);
 * `ganancia` es lo que queda en el bolsillo. El margen es sobre el precio de venta.
 * Los impuestos del vendedor (monotributo, IIBB) no se incluyen: dependen de cada cuenta.
 */
export function calcularGanancia({ precio, comision, envio, costo }) {
  const p = numero(precio);
  if (!p) return null;
  const c = Math.min(numero(comision), p);
  const e = numero(envio);
  const k = numero(costo);
  const neto = p - c - e;
  const ganancia = neto - k;
  return {
    precio: p, comision: c, envio: e, costo: k, neto, ganancia,
    margen: Math.round((ganancia / p) * 1000) / 10,           // % con un decimal
    comisionPct: Math.round((c / p) * 1000) / 10
  };
}

/** El precio más bajo (a la centena, o al millar arriba de $50.000) con el que la ganancia no es negativa. Siempre redondea hacia arriba. */
export function precioDeEquilibrio({ costo, envio, pct, fijo }) {
  const k = numero(costo) + numero(envio) + numero(fijo);
  const f = numero(pct) / 100;
  if (!k || f >= 1) return 0;
  const v = k / (1 - f);
  const paso = v >= 50000 ? 1000 : 100;
  return Math.ceil(v / paso - 1e-9) * paso;
}

/* El historial guarda hasta esta cantidad; los más viejos se caen de la lista (no del KV). */
export const MAX_HISTORIAL = 200;

/** Pone el resumen arriba de todo (reemplaza el anterior del mismo id) y recorta. */
export function actualizarIndice(indice, resumen, max = MAX_HISTORIAL) {
  return [resumen, ...indice.filter(r => r.id !== resumen.id)].slice(0, max);
}

/* Valores por defecto que eligió Nico (22/10/2026) para lo que MercadoLibre pide
   y casi nunca cambia en ventas de particular. Solo se usan si el campo quedó vacío. */
const POR_DEFECTO = {
  MODEL: 'NA',
  VALUE_ADDED_TAX: 'Exento',
  IMPORT_DUTY: '0 %'
};

/**
 * Completa los vacíos con los valores por defecto, y saca el asterisco al
 * código de barras: si no hay, armarItem manda EMPTY_GTIN_REASON solo
 * ("El producto no tiene código registrado"), así que no tiene por qué frenar.
 */
export function aplicarDefaults(atributos) {
  return atributos.map(a => {
    if (a.id === 'GTIN') return { ...a, requerido: false, nombre: 'Código de barras (solo si tiene)' };
    const defecto = POR_DEFECTO[a.id];
    if (!defecto || String(a.valor ?? '').trim()) return a;
    const enLista = !a.opciones?.length || a.opciones.some(o => o.nombre === defecto);
    return enLista ? { ...a, valor: defecto } : a;
  });
}

/** Qué falta antes de poder siquiera validar. Lista vacía = se puede mandar. */
export function faltantes(p) {
  const f = [];
  if (!p.titulo || !String(p.titulo).trim()) f.push('el título');
  if (!p.categoria) f.push('la categoría');
  if (!(Number(p.precio) > 0)) f.push('el precio');
  if (!(p.fotos || []).length) f.push('al menos una foto');
  if (p.envio === 'me2' && !leerPaquete(p.paquete)) f.push('el peso y las medidas del paquete (Mercado Envíos)');
  for (const a of p.atributos || []) {
    if (a.requerido && !String(a.valor ?? '').trim()) f.push(a.nombre);
  }
  return f;
}

/**
 * Precio de referencia a partir de resultados de búsqueda: la mediana, no el
 * promedio, porque siempre hay publicaciones con precios absurdos (repuestos
 * por $1, combos por diez veces el valor) que arrastrarían un promedio.
 */
export function precioDeReferencia(resultados) {
  const precios = resultados
    .map(r => Number(r.price))
    .filter(n => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  if (precios.length < 3) return null;
  const q = f => precios[Math.min(precios.length - 1, Math.floor(f * precios.length))];
  const medio = Math.floor(precios.length / 2);
  const mediana = precios.length % 2 ? precios[medio] : (precios[medio - 1] + precios[medio]) / 2;
  return { sugerido: redondearPrecio(mediana), min: redondearPrecio(q(0.25)), max: redondearPrecio(q(0.75)), muestras: precios.length };
}

/** Precio "de vidriera": a la centena, o al millar arriba de $50.000. */
export function redondearPrecio(n) {
  const v = Number(n);
  if (!(v > 0)) return 0;
  const paso = v >= 50000 ? 1000 : 100;
  return Math.max(paso, Math.round(v / paso) * paso);
}

/**
 * Los errores de MercadoLibre vienen en `cause[]` con un código técnico y un
 * mensaje en inglés. Se devuelven los mensajes, los errores primero.
 */
export function erroresML(respuesta) {
  if (!respuesta) return ['MercadoLibre no respondió.'];
  const causas = Array.isArray(respuesta.cause) ? respuesta.cause : [];
  if (!causas.length) return [respuesta.message || respuesta.error || 'Error sin detalle.'];
  return causas
    .slice()
    .sort((a, b) => (a.type === 'error' ? 0 : 1) - (b.type === 'error' ? 0 : 1))
    .map(c => `${c.type === 'warning' ? '(aviso) ' : ''}${c.message}${c.code ? ` [${c.code}]` : ''}`);
}

/* Avisos que MercadoLibre manda en inglés y que se entienden mejor dichos en criollo. */
const AVISOS_CONOCIDOS = {
  'shipping.lost_me1_by_user': 'Tu cuenta no tiene Mercado Envíos 1: el envío queda a acordar con el comprador.',
  'shipping.lost_me2_by_catalog': 'Este producto no entra en Mercado Envíos (por tamaño o categoría): el envío queda a acordar con el comprador.'
};

/**
 * El validador devuelve 400 tanto con errores como con avisos sueltos. Un aviso
 * (type "warning") no impide publicar: se muestra, pero no bloquea. Si la
 * respuesta no trae causas, el 400 es un error con su mensaje general.
 */
export function separarCausas(respuesta) {
  const causas = Array.isArray(respuesta?.cause) ? respuesta.cause : [];
  if (!causas.length) return { errores: erroresML(respuesta), avisos: [] };
  const texto = c => AVISOS_CONOCIDOS[c.code] || `${c.message}${c.code ? ` [${c.code}]` : ''}`;
  return {
    errores: causas.filter(c => c.type !== 'warning').map(texto),
    avisos: causas.filter(c => c.type === 'warning').map(texto)
  };
}
