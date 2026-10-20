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

/** Qué falta antes de poder siquiera validar. Lista vacía = se puede mandar. */
export function faltantes(p) {
  const f = [];
  if (!p.titulo || !String(p.titulo).trim()) f.push('el título');
  if (!p.categoria) f.push('la categoría');
  if (!(Number(p.precio) > 0)) f.push('el precio');
  if (!(p.fotos || []).length) f.push('al menos una foto');
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
