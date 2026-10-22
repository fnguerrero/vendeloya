/* ============================================================
   ia.js — las dos llamadas a Claude.

   1. identificar(): mira las fotos y dice qué es, en qué estado está,
      cómo titularlo, cómo describirlo y cuánto vale más o menos.
   2. completarAtributos(): con eso y la lista de atributos de la
      categoría, llena la ficha técnica. Va sin fotos (ya se miraron),
      así cuesta poco.

   Llamada directa a la API por fetch: el Worker no tiene build ni
   dependencias, igual que el de Déficit.
   ============================================================ */

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODELO = 'claude-opus-5-5';

const SCHEMA_IDENTIFICACION = {
  type: 'object',
  additionalProperties: false,
  required: ['producto', 'titulo', 'busqueda', 'marca', 'modelo', 'condicion', 'estado_detalle',
    'descripcion', 'caracteristicas', 'codigo_barras', 'precio_estimado', 'confianza', 'advertencias'],
  properties: {
    producto: { type: 'string', description: 'Qué es, en pocas palabras.' },
    titulo: { type: 'string', description: 'Título para MercadoLibre: producto + marca + modelo + specs. Máximo 60 caracteres. Sin estado, sin envío, sin signos.' },
    busqueda: { type: 'string', description: 'Lo que escribiría un comprador en el buscador para encontrar este producto. 2 a 5 palabras.' },
    marca: { type: 'string', description: 'Marca visible, o "Genérica" si no tiene o no se ve.' },
    modelo: { type: 'string', description: 'Modelo visible, o cadena vacía si no se ve.' },
    condicion: { type: 'string', enum: ['nuevo', 'usado', 'reacondicionado'] },
    estado_detalle: { type: 'string', description: 'Estado real que se ve en las fotos: marcas de uso, faltantes, caja. Honesto.' },
    descripcion: {
      type: 'string',
      description: 'Descripción en texto plano para la publicación, en español rioplatense neutro, sin emojis ni HTML. ' +
        'Separada en párrafos cortos con una línea en blanco entre cada uno (\\n\\n), nunca un bloque corrido: ' +
        '1) una frase de qué es; 2) características (material, medidas si se ven, detalles), una por línea con "- "; ' +
        '3) estado real; 4) qué incluye y qué no; 5) entrega o retiro y una invitación a consultar.'
    },
    caracteristicas: {
      type: 'array',
      description: 'Datos que se ven o se deducen con seguridad de las fotos (color, material, medidas, potencia, capacidad...).',
      items: {
        type: 'object', additionalProperties: false, required: ['nombre', 'valor'],
        properties: { nombre: { type: 'string' }, valor: { type: 'string' } }
      }
    },
    codigo_barras: {
      type: 'string',
      description: 'Los números impresos debajo de un código de barras (EAN/UPC) si se ven en alguna foto, solo dígitos. Cadena vacía si no hay o no se leen todos con seguridad: nunca completes dígitos.'
    },
    precio_estimado: {
      type: 'object', additionalProperties: false, required: ['min', 'sugerido', 'max'],
      description: 'Precio en pesos argentinos para MercadoLibre Argentina hoy, según la condición.',
      properties: { min: { type: 'number' }, sugerido: { type: 'number' }, max: { type: 'number' } }
    },
    confianza: { type: 'string', enum: ['alta', 'media', 'baja'] },
    advertencias: { type: 'array', items: { type: 'string' }, description: 'Lo que el vendedor debería revisar o completar a mano.' }
  }
};

const SCHEMA_ATRIBUTOS = {
  type: 'object',
  additionalProperties: false,
  required: ['atributos'],
  properties: {
    atributos: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'valor'],
        properties: {
          id: { type: 'string' },
          valor: { type: 'string', description: 'Valor elegido de las opciones si las hay; si no, texto libre. Cadena vacía si no se sabe.' }
        }
      }
    }
  }
};

const SISTEMA = `Ayudás a una persona en Argentina a vender sus cosas en MercadoLibre.
Mirás fotos de un producto y armás los datos de la publicación.
Sos honesto con el estado: si se ve uso, rayones o faltantes, lo decís.
Nunca inventás una marca, un modelo o un dato técnico que no se vea o no se pueda deducir con seguridad: preferís dejarlo vacío y avisarlo en advertencias.
Los precios son en pesos argentinos, de octubre de 2026, para MercadoLibre Argentina.`;

/** Una foto en data URL → bloque de imagen de la API. */
function bloqueImagen(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error('Foto con formato inválido.');
  return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
}

async function llamar(env, { contenido, schema, effort, maxTokens }) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      // Si un clasificador declina, la API reintenta sola en otro modelo.
      'anthropic-beta': 'server-side-fallback-2026-07-01'
    },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: maxTokens,
      system: SISTEMA,
      fallbacks: 'default',
      output_config: { effort, format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: contenido }]
    })
  });

  const datos = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Claude respondió ${res.status}: ${datos?.error?.message || 'sin detalle'}`);
  }
  if (datos.stop_reason === 'refusal') throw new Error('Claude no quiso analizar estas fotos.');
  if (datos.stop_reason === 'max_tokens') throw new Error('La respuesta de Claude quedó cortada.');

  const texto = (datos.content || []).find(b => b.type === 'text')?.text;
  if (!texto) throw new Error('Claude no devolvió texto.');
  return { json: JSON.parse(texto), uso: datos.usage };
}

/** Paso 1: qué es, a partir de las fotos. */
export function identificar(env, fotos) {
  return llamar(env, {
    contenido: [
      ...fotos.map(bloqueImagen),
      { type: 'text', text: 'Estas son fotos de algo que quiero vender usado o nuevo. Armá los datos de la publicación.' }
    ],
    schema: SCHEMA_IDENTIFICACION,
    effort: 'medium',
    maxTokens: 16000
  });
}

/** Paso 2: la ficha técnica de la categoría, a partir de lo identificado. */
export function completarAtributos(env, identificacion, atributos) {
  const lista = atributos.map(a => {
    const extra = a.opciones.length
      ? ` Opciones: ${a.opciones.map(o => o.nombre).join(' | ')}`
      : a.unidades.length ? ` Formato: número + unidad (${a.unidades.join(', ')})` : '';
    return `- ${a.id} "${a.nombre}" (${a.requerido ? 'obligatorio' : 'opcional'}, ${a.tipo}).${extra}`;
  }).join('\n');

  return llamar(env, {
    contenido: [{
      type: 'text',
      text: `Producto identificado:\n${JSON.stringify(identificacion, null, 2)}\n\n` +
        `Completá estos atributos de la categoría de MercadoLibre. Si hay opciones, usá exactamente una de ellas. ` +
        `Si un dato no se sabe, dejalo vacío: no lo inventes. Para marca sin marca visible usá "Genérica".\n\n${lista}`
    }],
    schema: SCHEMA_ATRIBUTOS,
    effort: 'low',
    maxTokens: 8000
  });
}
