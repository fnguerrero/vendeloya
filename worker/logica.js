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

/* Tags de ML que ocultan un atributo según la condición del ítem (la lista de tags viene de las categorías reales). */
const OCULTO_SEGUN_CONDICION = {
  nuevo: ['new_hidden'],
  usado: ['used_hidden'],
  reacondicionado: ['refurbished_hidden', 'reconditioned_hidden']
};

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
  const ocultos = OCULTO_SEGUN_CONDICION[condicion] || [];
  const usables = atributos.filter(a => {
    const t = a.tags || {};
    // Un atributo "<condición>_hidden" no se muestra para esa condición: ML pide borrarlo si se manda
    // (GRADING en auriculares y heladera usados, validado contra ML real el 09/11/2026).
    // Los ids de grilla de talles (SIZE_GRID_ID…) los asigna ML al armar la guía de talles: un texto libre ahí
    // se rechaza (invalid.fashion_grid.grid_id.values, validado contra ML real el 12/11/2026, zapatillas).
    const deGrilla = a.value_type === 'grid_id' || a.value_type === 'grid_row_id';
    return !t.read_only && !t.fixed && !t.inferred && !APARTE.has(a.id) && !deGrilla && !ocultos.some(h => t[h]);
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

/** La descripción nueva de una publicada, limpia. Vacía no se acepta (ML no deja borrarla así). */
export function validarDescripcion(texto) {
  const t = limpiarDescripcion(texto);
  if (t.length < 2) throw Object.assign(new Error('Escribí la descripción.'), { status: 400 });
  if (t.length > 50000) throw Object.assign(new Error('La descripción es demasiado larga.'), { status: 400 });
  return t;
}

/* ---------- varios talles: un ítem por talle ---------- */

export const MAX_TALLES = 12;

/**
 * Lista de talles a publicar, sin repetidos ni vacíos, en el orden en que vinieron. Acepta un arreglo o un texto
 * separado por comas, punto y coma o saltos de línea. Con User Products MercadoLibre no admite `variations`:
 * cada talle es un ítem propio.
 */
export function limpiarTalles(entrada) {
  const crudo = Array.isArray(entrada) ? entrada : String(entrada ?? '').split(/[,;\n]/);
  const vistos = new Set();
  const lista = [];
  for (const t of crudo) {
    const talle = String(t ?? '').replace(/\s+/g, ' ').trim();
    const clave = talle.toLowerCase();
    if (!talle || vistos.has(clave)) continue;
    vistos.add(clave);
    lista.push(talle);
  }
  if (lista.length > MAX_TALLES) throw Object.assign(new Error(`Son demasiados talles: el máximo es ${MAX_TALLES} por publicación.`), { status: 400 });
  return lista;
}

/**
 * Las variantes a publicar: una por talle, cada una con su cantidad y su precio si difieren de los comunes.
 * Acepta talles sueltos ("40" o "40, 41") y/o objetos { talle, cantidad?, precio? }. Sin repetidos (por talle),
 * en orden, hasta MAX_TALLES. Cantidad: entero de 1 a 999999. Precio: número mayor a cero (se redondea).
 * Lo que viene vacío no se incluye: esa variante usa el valor común de la publicación.
 */
export function limpiarVariantes(entrada) {
  const crudo = Array.isArray(entrada) ? entrada : String(entrada ?? '').split(/[,;\n]/);
  const vistos = new Set();
  const lista = [];
  for (const x of crudo) {
    const obj = x && typeof x === 'object' ? x : { talle: x };
    const talle = String(obj.talle ?? '').replace(/\s+/g, ' ').trim();
    const clave = talle.toLowerCase();
    if (!talle || vistos.has(clave)) continue;
    vistos.add(clave);
    const v = { talle };
    const vacio = z => z === undefined || z === null || String(z).trim() === '';
    if (!vacio(obj.cantidad)) {
      const c = Number(obj.cantidad);
      if (!Number.isInteger(c) || c < 1 || c > 999999) throw err400(`La cantidad del talle ${talle} tiene que ser un entero de 1 a 999999.`);
      v.cantidad = c;
    }
    if (!vacio(obj.precio)) {
      const p = Math.round(Number(obj.precio));
      if (!Number.isFinite(p) || p <= 0) throw err400(`El precio del talle ${talle} tiene que ser un número mayor a cero.`);
      v.precio = p;
    }
    lista.push(v);
  }
  if (lista.length > MAX_TALLES) throw err400(`Son demasiados talles: el máximo es ${MAX_TALLES} por publicación.`);
  return lista;
}

/** La publicación de una variante: su talle, y su cantidad y precio si los tiene. No muta la original. */
export function conVariante(p, v) {
  const q = conTalle(p, v.talle);
  if (v.cantidad !== undefined) q.cantidad = v.cantidad;
  if (v.precio !== undefined) q.precio = v.precio;
  return q;
}

/** La publicación con ese talle puesto (reemplaza o agrega SIZE). No muta la original. */
export function conTalle(p, talle) {
  const resto = (p.atributos || []).filter(a => a.id !== 'SIZE');
  const size = (p.atributos || []).find(a => a.id === 'SIZE') || { id: 'SIZE', nombre: 'Talle', opciones: [] };
  const { talles, ...sinLista } = p;
  return { ...sinLista, atributos: [...resto, { ...size, valor: talle }] };
}

/* ---------- envío: peso y medidas del paquete ---------- */

const MEDIDA_PAQUETE = { pesoG: 'SELLER_PACKAGE_WEIGHT', largoCm: 'SELLER_PACKAGE_LENGTH', anchoCm: 'SELLER_PACKAGE_WIDTH', altoCm: 'SELLER_PACKAGE_HEIGHT' };

/* Topes de cordura para detectar errores de tipeo (1500 vs 1.5 vs 1e9). NO son reglas de MercadoLibre. */
const MAX_PESO_G = 100000;   // 100 kg
const MAX_MEDIDA_CM = 300;
const MAX_MONTO = 1e9;

/**
 * Un número escrito a la argentina: coma decimal y punto de miles ("1.250,50", "99,90", "1.500"), o punto
 * decimal ("1234.56"). Cualquier otra cosa (letras, notación científica, hexa, signo +, separadores
 * mezclados) es NaN: nunca se adivina. "1.500" es mil quinientos; "1.5", uno coma cinco.
 */
export function parsearNumero(texto) {
  const t = String(texto ?? '').trim();
  let m;
  if ((m = /^(-?)(\d{1,3}(?:\.\d{3})+)(?:,(\d+))?$/.exec(t))) return Number(`${m[1]}${m[2].replace(/\./g, '')}${m[3] ? `.${m[3]}` : ''}`);
  if ((m = /^(-?)(\d+)(?:,(\d+))?$/.exec(t))) return Number(`${m[1]}${m[2]}${m[3] ? `.${m[3]}` : ''}`);
  if ((m = /^(-?)(\d+\.\d+)$/.exec(t))) return Number(m[1] + m[2]);
  return NaN;
}

/** Un monto en pesos escrito a mano. Vacío = 0 sin error; negativo, ilegible o enorme = error (valor 0). */
export function parsearMonto(texto) {
  const t = String(texto ?? '').trim();
  if (t === '') return { valor: 0, error: '' };
  const v = parsearNumero(t);
  if (!Number.isFinite(v)) return { valor: 0, error: 'Escribí un monto válido, por ejemplo 12.500 o 12.500,50.' };
  if (v < 0) return { valor: 0, error: 'El monto no puede ser negativo.' };
  if (v > MAX_MONTO) return { valor: 0, error: 'Ese monto es demasiado grande: revisalo.' };
  return { valor: v, error: '' };
}

/**
 * Peso (g) y medidas (cm) del paquete tal como se escribieron → { ok, valores, errores }.
 * El peso va en gramos enteros; las medidas se redondean al cm. Todo con rango razonable.
 */
export function validarPaquete(paquete) {
  const campos = [['pesoG', 'el peso'], ['largoCm', 'el largo'], ['anchoCm', 'el ancho'], ['altoCm', 'el alto']];
  const vacio = v => String(v ?? '').trim() === '';
  if (!paquete || campos.every(([k]) => vacio(paquete[k]))) return { ok: false, valores: null, errores: ['Cargá el peso y las medidas del paquete.'] };
  const valores = {};
  const errores = [];
  for (const [k, nombre] of campos) {
    if (vacio(paquete[k])) { errores.push(`Falta ${nombre}.`); continue; }
    const Nombre = nombre[0].toUpperCase() + nombre.slice(1);
    const v = parsearNumero(paquete[k]);
    if (!Number.isFinite(v)) { errores.push(`${Nombre} no es un número válido (por ejemplo 1500 o 30,5).`); continue; }
    if (k === 'pesoG') {
      if (!Number.isInteger(v)) errores.push('El peso va en gramos y sin decimales (1,5 kg se escribe 1500).');
      else if (v < 1 || v > MAX_PESO_G) errores.push('El peso tiene que estar entre 1 g y 100.000 g (100 kg).');
      else valores[k] = v;
      continue;
    }
    const r = Math.round(v);
    if (r < 1 || r > MAX_MEDIDA_CM) errores.push(`${Nombre} tiene que estar entre 1 y 300 cm.`);
    else valores[k] = r;
  }
  return errores.length ? { ok: false, valores: null, errores } : { ok: true, valores, errores: [] };
}

/** "45 cm", "1,2 m", "800 mm" o "45" (sin unidad = cm) → centímetros enteros; null si no se entiende. */
export function aCentimetros(texto) {
  const m = /^\s*([\d.,]+)\s*(mm|cm|m|"|in|pulgadas?)?\s*$/i.exec(String(texto ?? ''));
  const n = m ? parsearNumero(m[1]) : NaN;
  if (!(n > 0)) return null;
  const u = (m[2] || 'cm').toLowerCase();
  const cm = u === 'mm' ? n / 10 : u === 'm' ? n * 100 : /^(in|"|pulgada)/.test(u) ? n * 2.54 : n;
  return Math.max(1, Math.round(cm));
}

/** "800 g", "1,5 kg", "2 lb" o "800" (sin unidad = g) → gramos enteros; null si no se entiende. */
export function aGramos(texto) {
  const m = /^\s*([\d.,]+)\s*(mg|g|kg|lb|oz)?\s*$/i.exec(String(texto ?? ''));
  const n = m ? parsearNumero(m[1]) : NaN;
  if (!(n > 0)) return null;
  const u = (m[2] || 'g').toLowerCase();
  const g = u === 'mg' ? n / 1000 : u === 'kg' ? n * 1000 : u === 'lb' ? n * 453.592 : u === 'oz' ? n * 28.3495 : n;
  return Math.max(1, Math.round(g));
}

/** Los cuatro valores ya validados (g y cm enteros), o null si falta alguno o no pasa la cordura. */
export function leerPaquete(paquete) {
  return validarPaquete(paquete).valores;
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
  // Ropa y calzado: la guía de talles (SIZE_GRID_ID) y la fila de este talle, a nivel del ítem (sin variaciones).
  if (p.guiaTalles?.id && p.guiaTalles?.fila) {
    atributos.push({ id: 'SIZE_GRID_ID', value_name: String(p.guiaTalles.id) });
    atributos.push({ id: 'SIZE_GRID_ROW_ID', value_name: String(p.guiaTalles.fila) });
  }
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
    mlId: reg.ml?.id || null,
    // Varios talles: un ítem de ML por talle. Solo se guarda cuando hay más de uno (los índices viejos no lo traen).
    ...(reg.ml?.items?.length > 1 ? { mlItems: reg.ml.items.filter(i => i?.id).map(i => ({ talle: i.talle ?? null, id: i.id })) } : {})
  };
}

/** Los ítems de ML de una publicada: uno por talle, o el único de siempre. */
export function itemsDeRegistro(pub) {
  if (pub?.mlItems?.length > 1) return pub.mlItems;
  return pub?.mlId ? [{ talle: null, id: pub.mlId }] : [];
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

/**
 * Las visitas por ítem, venga como venga: { MLA1: 12 } (lo documentado), [{ item_id, total_visits }]
 * o { item_id, total_visits } suelto. Lo que no se entiende se descarta; devuelve { id: número }.
 */
export function leerVisitas(datos) {
  const mapa = {};
  const poner = (id, n) => {
    if (!/^[A-Z]{3}\d+$/.test(String(id)) || n == null || n === '' || !Number.isFinite(Number(n))) return;   // solo ids de ítem (no "status", "code"…)
    mapa[id] = Number(n);
  };
  const cuenta = x => (x && typeof x === 'object' ? (x.total_visits ?? x.visits ?? x.total) : x);
  if (Array.isArray(datos)) for (const x of datos) poner(x?.item_id ?? x?.id, cuenta(x));
  else if (datos && typeof datos === 'object') {
    if (datos.item_id) poner(datos.item_id, cuenta(datos));
    else for (const [id, v] of Object.entries(datos)) poner(id, cuenta(v));
  }
  return mapa;
}

/** ¿MercadoLibre rechazó por permisos de la app (PolicyAgent) y no por el token? */
export function bloqueoPorPermisos(e) {
  return e?.status === 403 && (e.ml?.blocked_by === 'PolicyAgent' || /PA_UNAUTHORIZED/.test(e.ml?.code || ''));
}

/** Qué hacer cuando MercadoLibre no deja leer o responder preguntas con el permiso actual de la app. */
export function mensajePermisoPreguntas(accion = 'leer') {
  return `MercadoLibre no le deja a la app ${accion} las preguntas: falta el permiso. En developers.mercadolibre.com.ar → Mis aplicaciones → tu app → Editar → Permisos, poné «Comunicaciones pre y post venta» en Lectura y escritura, guardá y después tocá «Volver a conectar» en Ajustes.`;
}

/**
 * Junta ítems, visitas y preguntas sin responder en un resumen por id de MercadoLibre.
 * preguntas === null significa "no se pudo consultar" (no es lo mismo que cero preguntas).
 */
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
      preguntas: preguntas === null ? null : 0
    };
  }
  for (const q of preguntas || []) if (porItem[q?.item_id]) porItem[q.item_id].preguntas++;
  return porItem;
}

const suma = (xs) => (xs.every(x => x == null) ? null : xs.reduce((t, x) => t + (x || 0), 0));
const PRIORIDAD_ESTADO = ['activa', 'pausada', 'en_revision', 'vendida', 'finalizada'];

/**
 * El seguimiento por registro de la app. Un registro de un solo ítem queda igual que siempre; uno con varios talles
 * suma vendidas, disponibles, visitas y preguntas, toma el estado "más vivo" (activa antes que pausada, etc.), el
 * precio y el mlId del primero, y trae el detalle de cada talle en `talles`.
 */
export function juntarSeguimiento(pubs, porItem) {
  const registros = {};
  for (const pub of pubs) {
    const lista = itemsDeRegistro(pub).filter(i => porItem[i.id]);
    if (!lista.length || !porItem[pub.mlId]) continue;   // el principal (el primero) manda: sin él no hay fila, como antes
    if (itemsDeRegistro(pub).length === 1) { registros[pub.id] = { ...porItem[pub.mlId], mlId: pub.mlId }; continue; }
    const filas = lista.map(i => ({ talle: i.talle, id: i.id, ...porItem[i.id] }));
    const estados = filas.map(f => f.estado);
    const estado = PRIORIDAD_ESTADO.find(e => estados.includes(e)) || estados[0];
    registros[pub.id] = {
      estado, mlId: pub.mlId, precio: porItem[pub.mlId].precio,
      vendidas: suma(filas.map(f => f.vendidas)), disponibles: suma(filas.map(f => f.disponibles)),
      visitas: suma(filas.map(f => f.visitas)), preguntas: suma(filas.map(f => f.preguntas)),
      talles: filas
    };
  }
  return registros;
}

/* ---------- acciones sobre una publicación ---------- */

const err400 = m => Object.assign(new Error(m), { status: 400 });

/** Cuerpo del PUT /items/{id} para cada acción de la app (precio y stock llevan su valor). */
export function cambioPublicacion(accion, valor) {
  if (accion === 'precio') {
    const p = Math.round(Number(valor));
    if (!Number.isFinite(p) || p <= 0) throw err400('El precio tiene que ser un número mayor a cero.');
    return { price: p };
  }
  if (accion === 'stock') {
    const n = Number(valor);
    if (valor === '' || valor === null || !Number.isInteger(n) || n < 1 || n > 999999) throw err400('El stock tiene que ser un número entero de 1 a 999999 (para dejar de vender, pausá o cerrá la publicación).');
    return { available_quantity: n };
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

/* ---------- publicar solo lo que pasó el validador ---------- */

/** Lo mismo con las claves en cualquier orden: dos ítems iguales dan la misma huella. */
function ordenado(v) {
  if (Array.isArray(v)) return v.map(ordenado);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, ordenado(v[k])]));
  return v;
}

/** Huella (SHA-256) del cuerpo exacto del ítem: cualquier cambio de contenido cambia la huella. */
export async function huellaItem(item) {
  const bytes = new TextEncoder().encode(JSON.stringify(ordenado(item)));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Lo que se sella: el ítem y la descripción. La descripción no viaja en el ítem (se manda aparte,
 * después de publicar), así que sin esto se podía cambiar el texto entre revisar y publicar.
 */
export function paraHuella(item, descripcion) {
  return { item, descripcion: limpiarDescripcion(descripcion) };
}

/** El validador de MercadoLibre aprobó ESTE contenido (se guarda una hora en el KV). */
export async function marcarValidado(kv, item, ttl = 3600) {
  await kv.put(`validado:${await huellaItem(item)}`, '1', { expirationTtl: ttl });
}

export async function estaValidado(kv, item) {
  return (await kv.get(`validado:${await huellaItem(item)}`)) === '1';
}

/** Tras publicar, la marca se gasta: el mismo contenido no se publica dos veces con una sola revisión. */
export async function gastarValidacion(kv, item) {
  await kv.delete(`validado:${await huellaItem(item)}`);
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
  IMPORT_DUTY: '0 %',
  // Cada publicación es de una unidad: ML corrige cualquier otro número a 1 (validate del 09/11/2026, mesa ratona).
  UNITS_PER_PACK: '1'
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
  if (p.envio !== 'retiro') {
    const escribioAlgo = p.paquete && Object.values(p.paquete).some(v => String(v ?? '').trim() !== '');
    const v = validarPaquete(p.paquete);
    if ((p.envio === 'me2' || escribioAlgo) && !v.ok) f.push(`el paquete de envío (${v.errores.join(' ')})`);
  }
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

const AVISO_GRILLA = 'MercadoLibre no aceptó la guía de talles de esta categoría (ropa o calzado). Publicala directo desde MercadoLibre o elegí otra categoría.';

/* ---------- Guías de talles (ropa y calzado) ----------
   ML exige SIZE_GRID_ID (la guía) y SIZE_GRID_ROW_ID (la fila del talle, "<guía>:<n>"). Las guías STANDARD
   y de MARCA ya existen en MercadoLibre: se buscan (POST /catalog/charts/search, solo lectura) y se elige
   la fila. VendeloYa no crea ninguna guía en la cuenta. Un ítem = un talle (sin variaciones). */

/** Qué pide la categoría para la guía de talles, según los tags de sus atributos. */
export function requisitosDeGuia(atributosML) {
  const lista = atributosML || [];
  return {
    pide: lista.some(a => a.id === 'SIZE_GRID_ID' && a.value_type === 'grid_id'),
    plantilla: lista.filter(a => (a.tags || {}).grid_template_required).map(a => a.id)
  };
}

const valorDe = (atributos, id) => String((atributos || []).find(a => a.id === id)?.valor ?? '').trim();

/**
 * Cuerpo de POST /catalog/charts/search. El dominio va sin prefijo de sitio ("SNEAKERS", no "MLA-SNEAKERS").
 * Lleva los atributos de la plantilla (ej. GENDER) y, si está cargada, la marca.
 * Devuelve también los que faltan de la plantilla.
 */
export function armarBusquedaGuia({ dominio, sitio = 'MLA', vendedor, requisitos, atributos, sinMarca = false }) {
  const ids = [...new Set([...(requisitos?.plantilla || []), ...(sinMarca ? [] : ['BRAND'])])];
  const attributes = [];
  const faltan = [];
  for (const id of ids) {
    const v = valorDe(atributos, id);
    if (v) attributes.push({ id, values: [{ name: v }] });
    else if ((requisitos?.plantilla || []).includes(id)) faltan.push(id);
  }
  return { cuerpo: { domain_id: String(dominio || '').replace(/^[A-Z]{3}-/, ''), site_id: sitio, seller_id: Number(vendedor), attributes }, faltan };
}

/** De las guías que devolvió la búsqueda, la que sirve: de la marca si hay, si no la estándar, si no una propia. */
export function elegirGuia(charts, marca) {
  const lista = (charts || []).filter(c => c && c.id);
  const m = sinAcentos(marca);
  const nombre = c => sinAcentos(Object.values(c.names || {}).join(' '));
  return (m && lista.find(c => c.type === 'BRAND' && nombre(c).includes(m)))
    || lista.find(c => c.type === 'STANDARD')
    || lista.find(c => c.type === 'SPECIFIC')
    || null;
}

const normTalle = s => sinAcentos(s).replace(',', '.').replace(/\s+/g, ' ');
const numeroDe = s => { const m = /\d+(?:\.\d+)?/.exec(normTalle(s)); return m ? Number(m[0]) : null; };
const valoresDeFila = f => (f.attributes || []).flatMap(a => (a.values || []).map(v => ({ attr: a.id, nombre: String(v.name ?? '') })));

/** Los talles que ofrece una guía (el talle principal de cada fila). */
export function tallesDeGuia(guia) {
  return (guia?.rows || []).map(f => valoresDeFila(f).find(v => v.attr === 'SIZE')?.nombre || valoresDeFila(f)[0]?.nombre).filter(Boolean);
}

/**
 * La fila de la guía que corresponde al talle escrito: primero por nombre (en cualquier columna, "40 AR" = "40 AR"),
 * después por el número en el talle principal, después por el número en cualquier columna.
 * Devuelve { fila: "<guía>:<n>", talle: el nombre del talle principal de la fila } o null.
 */
export function filaDeGuia(guia, talle) {
  const filas = guia?.rows || [];
  const t = normTalle(talle);
  if (!t) return null;
  const principal = f => valoresDeFila(f).find(v => v.attr === 'SIZE')?.nombre || valoresDeFila(f)[0]?.nombre || '';
  const n = numeroDe(talle);
  const hallada = filas.find(f => valoresDeFila(f).some(v => normTalle(v.nombre) === t))
    || (n !== null && filas.find(f => numeroDe(principal(f)) === n))
    || (n !== null && filas.find(f => valoresDeFila(f).some(v => numeroDe(v.nombre) === n)))
    || null;
  return hallada && hallada.id ? { fila: String(hallada.id), talle: principal(hallada) } : null;
}

/** La publicación con la guía aplicada: el talle pasa a ser el de la fila y se guardan los ids para armarItem. */
export function aplicarGuia(p, guia, hallada) {
  const atributos = (p.atributos || []).filter(a => a.id !== 'SIZE');
  atributos.push({ id: 'SIZE', nombre: 'Talle', tipo: 'string', requerido: true, opciones: [], valor: hallada.talle });
  return { ...p, atributos, guiaTalles: { id: String(guia.id), fila: hallada.fila } };
}

/* Avisos que MercadoLibre manda en inglés y que se entienden mejor dichos en criollo. */
const AVISOS_CONOCIDOS = {
  'shipping.lost_me1_by_user': 'Tu cuenta no tiene Mercado Envíos 1: el envío queda a acordar con el comprador.',
  'shipping.lost_me2_by_catalog': 'Este producto no entra en Mercado Envíos (por tamaño o categoría): el envío queda a acordar con el comprador.',
  'shipping.lost_me2_by_intersected_logistics': 'Mercado Envíos no puede llevar este producto con el peso y las medidas cargados (no hay una logística que sirva para tu cuenta): el envío queda a acordar con el comprador. Revisá el paquete o ofrecé retiro en persona.',
  'missing.fashion_grid.grid_id.values': AVISO_GRILLA,
  'invalid.fashion_grid.grid_id.values': AVISO_GRILLA,
  'shipping.free_shipping.cost_exceeded': 'Atención: según MercadoLibre, el costo del envío gratis supera lo que cobrás por este producto. Subí el precio o ofrecé retiro en persona antes de publicar.'
};

/* ME1 es la modalidad antigua. Cuando se eligió Mercado Envíos 2, que la cuenta no tenga ME1 no cambia nada. */
const AVISO_ME1_CON_ME2 = 'Tu cuenta no tiene Mercado Envíos 1 (la modalidad antigua). No afecta al envío por Mercado Envíos 2 que elegiste.';

/**
 * El validador devuelve 400 tanto con errores como con avisos sueltos. Un aviso
 * (type "warning") no impide publicar: se muestra, pero no bloquea. Si la
 * respuesta no trae causas, el 400 es un error con su mensaje general.
 * envio: el modo elegido ('me2', 'retiro'...), para decir el aviso de ME1 en su contexto.
 */
export function separarCausas(respuesta, { envio } = {}) {
  const causas = Array.isArray(respuesta?.cause) ? respuesta.cause : [];
  if (!causas.length) return { errores: erroresML(respuesta), avisos: [] };
  const perdioMe2 = causas.some(c => /^shipping\.lost_me2_/.test(c.code || ''));
  const texto = c => {
    if (c.code === 'shipping.lost_me1_by_user' && envio === 'me2' && !perdioMe2) return AVISO_ME1_CON_ME2;
    return AVISOS_CONOCIDOS[c.code] || `${c.message}${c.code ? ` [${c.code}]` : ''}`;
  };
  // Si se perdió ME2, el aviso de ME1 sobra: el de ME2 ya dice que el envío queda a acordar.
  const sobra = c => c.code === 'shipping.lost_me1_by_user' && envio === 'me2' && perdioMe2;
  return {
    errores: causas.filter(c => c.type !== 'warning').map(texto),
    avisos: causas.filter(c => c.type === 'warning' && !sobra(c)).map(texto)
  };
}
