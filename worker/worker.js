/* ============================================================
   worker.js — el backend de VendeloYa.

   Guarda lo que no puede estar en una página pública: el token de
   MercadoLibre (en KV, porque rota con cada renovación) y las claves
   de Claude y de la app de MercadoLibre (como secretos).

   Rutas:
     GET  /oauth/start?k=CLAVE   conecta la cuenta de MercadoLibre
     GET  /oauth/callback        vuelta del OAuth (redirect_uri fija)
     GET  /api/estado            ¿hay cuenta conectada? ¿cuál?
     POST /api/analizar          fotos → propuesta de publicación
     POST /api/categoria         otra categoría → sus atributos
     POST /api/revisar           sube fotos y valida SIN publicar
     POST /api/publicar          publica de verdad + descripción
     GET  /api/registros         historial (resúmenes)
     GET|PUT|DELETE /api/registros/<id>   un borrador o publicación guardada

   Todo /api/* pide el header x-clave = APP_SECRET. El Origin solo no
   alcanza: cualquiera lo falsifica con curl, y esta app publica en la
   cuenta real de Nico.
   ============================================================ */

import { identificar, completarAtributos } from './ia.js';
import * as registros from './registros.js';
import { elegirAtributos, armarItem, faltantes, precioDeReferencia, redondearPrecio, erroresML, limpiarDescripcion, aplicarGtin, aplicarDefaults, separarCausas, CONDICIONES } from './logica.js';

const ML_API = 'https://api.mercadolibre.com';
const ML_AUTH = 'https://auth.mercadolibre.com.ar/authorization';
const SITIO = 'MLA';

const ORIGENES = [
  'https://vendeloya-app.fnguerrero.workers.dev',
  'https://fnguerrero.github.io',
  'http://localhost:5610',
  'http://127.0.0.1:5610'
];

/* Hasta 6 fotos de ~1200 px en base64. */
const MAX_CUERPO = 15 * 1024 * 1024;
const MAX_FOTOS = 6;

/* ---------- respuestas ---------- */

function cors(origen) {
  return {
    'Access-Control-Allow-Origin': origen,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-clave',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

const json = (datos, status, origen) => new Response(JSON.stringify(datos), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...cors(origen) }
});

const html = (titulo, texto, status = 200) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title><body style="font-family:system-ui;max-width:28rem;margin:4rem auto;padding:0 1rem;line-height:1.5">
<h1 style="font-size:1.4rem">${titulo}</h1><p>${texto}</p></body>`,
  { status, headers: { 'content-type': 'text/html; charset=utf-8' } }
);

/** Compara sin cortar en el primer carácter distinto (no filtra el largo por timing). */
function iguales(a, b) {
  const x = new TextEncoder().encode(String(a || ''));
  const y = new TextEncoder().encode(String(b || ''));
  let dif = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) dif |= (x[i] || 0) ^ (y[i] || 0);
  return dif === 0 && x.length > 0;
}

/* ---------- OAuth ---------- */

const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const azar = n => base64url(crypto.getRandomValues(new Uint8Array(n)));

function redirectUri(request) {
  return `${new URL(request.url).origin}/oauth/callback`;
}

async function oauthStart(request, env) {
  if (!iguales(new URL(request.url).searchParams.get('k'), env.APP_SECRET)) {
    return html('Clave incorrecta', 'Abrí la conexión desde la app, que agrega la clave sola.', 403);
  }
  if (!env.ML_CLIENT_ID || !env.ML_CLIENT_SECRET) {
    return html('Falta configurar', 'El Worker no tiene cargados ML_CLIENT_ID y ML_CLIENT_SECRET. Corré tools/cargar-secretos.ps1.', 500);
  }

  // PKCE: el verifier queda acá, solo viaja su hash.
  const state = azar(24);
  const verifier = azar(48);
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  await env.KV.put(`oauth:${state}`, verifier, { expirationTtl: 600 });

  const url = new URL(ML_AUTH);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: env.ML_CLIENT_ID,
    redirect_uri: redirectUri(request),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  });
  return Response.redirect(url.toString(), 302);
}

async function guardarTokens(env, t) {
  await env.KV.put('ml:tokens', JSON.stringify({
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    user_id: t.user_id,
    // Cinco minutos de margen: mejor renovar antes que fallar en medio de una publicación.
    vence: Date.now() + (Number(t.expires_in) || 10800) * 1000 - 5 * 60 * 1000
  }));
}

async function pedirToken(env, campos) {
  const res = await fetch(`${ML_API}/oauth/token`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.ML_CLIENT_ID, client_secret: env.ML_CLIENT_SECRET, ...campos })
  });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`MercadoLibre no dio el token: ${datos.error || res.status} ${datos.error_description || ''}`.trim());
  return datos;
}

async function oauthCallback(request, env) {
  const p = new URL(request.url).searchParams;
  const state = p.get('state');
  const code = p.get('code');
  if (!state || !code) return html('Faltan datos', 'MercadoLibre no devolvió el código de autorización.', 400);

  const verifier = await env.KV.get(`oauth:${state}`);
  if (!verifier) return html('Pedido vencido', 'Pasaron más de 10 minutos o el pedido no salió de esta app. Volvé a tocar "Conectar".', 400);
  await env.KV.delete(`oauth:${state}`);

  try {
    const t = await pedirToken(env, {
      grant_type: 'authorization_code', code, redirect_uri: redirectUri(request), code_verifier: verifier
    });
    await guardarTokens(env, t);
  } catch (e) {
    return html('No se pudo conectar', e.message, 502);
  }
  return html('Cuenta conectada', 'Listo: VendeloYa ya puede publicar en tu cuenta. Podés cerrar esta pestaña y volver a la app.');
}

/** El access token vigente; lo renueva si venció. El refresh token es de un solo uso. */
async function token(env) {
  const guardado = await env.KV.get('ml:tokens', 'json');
  if (!guardado) return null;
  if (Date.now() < guardado.vence) return guardado;
  const t = await pedirToken(env, { grant_type: 'refresh_token', refresh_token: guardado.refresh_token });
  await guardarTokens(env, t);
  return env.KV.get('ml:tokens', 'json');
}

/* ---------- MercadoLibre ---------- */

async function ml(env, ruta, { metodo = 'GET', cuerpo, conToken = true, tolerar = [] } = {}) {
  const headers = { accept: 'application/json' };
  if (conToken) {
    const t = await token(env);
    if (!t) throw Object.assign(new Error('La cuenta de MercadoLibre no está conectada.'), { status: 409 });
    headers.authorization = `Bearer ${t.access_token}`;
  }
  if (cuerpo && !(cuerpo instanceof FormData)) headers['content-type'] = 'application/json';
  const res = await fetch(`${ML_API}${ruta}`, {
    method: metodo,
    headers,
    body: cuerpo instanceof FormData ? cuerpo : cuerpo ? JSON.stringify(cuerpo) : undefined
  });
  const texto = await res.text();
  let datos = null;
  try { datos = texto ? JSON.parse(texto) : null; } catch { datos = { message: texto.slice(0, 200) }; }
  // Un 401 de MercadoLibre no es la clave de la app: es el token. Se devuelve
  // como 409 para que la app pida reconectar en vez de "clave incorrecta".
  if (res.status === 401 && !tolerar.includes(401)) {
    throw Object.assign(new Error('MercadoLibre rechazó el token. Volvé a conectar la cuenta.'), { status: 409 });
  }
  if (!res.ok && !tolerar.includes(res.status)) {
    throw Object.assign(new Error(erroresML(datos).join(' · ')), { status: res.status, ml: datos });
  }
  return { status: res.status, datos };
}

async function usuario(env) {
  const { datos } = await ml(env, '/users/me');
  return {
    id: datos.id,
    nickname: datos.nickname,
    userProducts: (datos.tags || []).includes('user_product_seller')
  };
}

/** Atributos, límites y tipos de publicación de una categoría. */
async function datosCategoria(env, categoriaId, condicion, usuarioId) {
  const [cat, attrs, tipos] = await Promise.all([
    ml(env, `/categories/${categoriaId}`, { conToken: false }),
    ml(env, `/categories/${categoriaId}/attributes`, { conToken: false }),
    ml(env, `/users/${usuarioId}/available_listing_types?category_id=${categoriaId}`, { tolerar: [400, 403, 404] })
  ]);
  const todos = attrs.datos || [];
  return {
    id: cat.datos.id,
    nombre: (cat.datos.path_from_root || []).map(c => c.name).join(' › ') || cat.datos.name,
    maxTitulo: cat.datos.settings?.max_title_length || 60,
    precioMinimo: cat.datos.settings?.minimum_price || 0,
    maxFotos: cat.datos.settings?.max_pictures_per_item || MAX_FOTOS,
    pideGtin: todos.some(a => a.id === 'EMPTY_GTIN_REASON'),
    atributos: elegirAtributos(todos, condicion),
    tiposPublicacion: Array.isArray(tipos.datos?.available) ? tipos.datos.available.map(t => ({ id: t.id, nombre: t.name })) : []
  };
}

/**
 * Precio de referencia buscando publicaciones parecidas. La búsqueda pública
 * da 403 sin token, y puede seguir cerrada con token (MercadoLibre la viene
 * restringiendo). Si no hay datos, el precio queda el que estimó la IA.
 */
async function precioDeMercado(env, busqueda, condicion) {
  const q = new URLSearchParams({ q: busqueda, limit: '30', condition: CONDICIONES[condicion]?.condition || 'used' });
  try {
    const { status, datos } = await ml(env, `/sites/${SITIO}/search?${q}`, { tolerar: [401, 403] });
    if (status !== 200) return { disponible: false, motivo: `búsqueda cerrada (${status})` };
    const ref = precioDeReferencia(datos.results || []);
    return ref ? { disponible: true, ...ref } : { disponible: false, motivo: 'pocos resultados' };
  } catch (e) {
    return { disponible: false, motivo: e.message };
  }
}

/** La IA llena los atributos y se les pegan los valores a la lista de la categoría. */
async function atributosCompletos(env, identificacion, categoria) {
  if (!categoria.atributos.length) return [];
  const { json: r } = await completarAtributos(env, identificacion, categoria.atributos);
  const valores = new Map((r.atributos || []).map(a => [a.id, a.valor]));
  const completos = categoria.atributos.map(a => ({ ...a, valor: valores.get(a.id) || '' }));
  return aplicarDefaults(aplicarGtin(completos, identificacion?.codigo_barras));
}

/* ---------- rutas de la app ---------- */

/** Qué secretos faltan. Solo los nombres: los valores no salen nunca del Worker. */
function faltanSecretos(env) {
  return ['ML_CLIENT_ID', 'ML_CLIENT_SECRET', 'ANTHROPIC_API_KEY', 'APP_SECRET'].filter(n => !env[n]);
}

async function estado(env) {
  const faltan = faltanSecretos(env);
  if (faltan.length) return { conectado: false, faltan };
  const t = await env.KV.get('ml:tokens', 'json');
  if (!t) return { conectado: false };
  try {
    return { conectado: true, ...(await usuario(env)) };
  } catch (e) {
    return { conectado: false, error: e.message };
  }
}

async function analizar(env, cuerpo) {
  const fotos = (cuerpo.fotos || []).slice(0, MAX_FOTOS);
  if (!fotos.length) throw Object.assign(new Error('Mandá al menos una foto.'), { status: 400 });

  const yo = await usuario(env);
  const { json: id } = await identificar(env, fotos);

  const { datos: predicciones } = await ml(env,
    `/sites/${SITIO}/domain_discovery/search?limit=3&q=${encodeURIComponent(id.titulo)}`, { conToken: false });
  if (!predicciones?.length) throw Object.assign(new Error('MercadoLibre no encontró una categoría para este producto.'), { status: 422 });

  const [categoria, mercado] = await Promise.all([
    datosCategoria(env, predicciones[0].category_id, id.condicion, yo.id),
    precioDeMercado(env, id.busqueda, id.condicion)
  ]);
  const atributos = await atributosCompletos(env, id, categoria);

  const precio = mercado.disponible
    ? { valor: mercado.sugerido, fuente: 'mercadolibre', min: mercado.min, max: mercado.max, muestras: mercado.muestras }
    : {
        valor: redondearPrecio(id.precio_estimado.sugerido), fuente: 'ia',
        min: redondearPrecio(id.precio_estimado.min), max: redondearPrecio(id.precio_estimado.max), motivo: mercado.motivo
      };

  return {
    identificacion: id,
    categorias: predicciones.map(p => ({ id: p.category_id, nombre: `${p.domain_name} › ${p.category_name}` })),
    categoria,
    atributos,
    precio,
    userProducts: yo.userProducts,
    propuesta: {
      titulo: id.titulo,
      condicion: id.condicion,
      descripcion: limpiarDescripcion(id.descripcion),
      precio: precio.valor,
      categoria: categoria.id,
      tipoPublicacion: categoria.tiposPublicacion.some(t => t.id === 'gold_special') ? 'gold_special' : categoria.tiposPublicacion[0]?.id || 'gold_special',
      garantia: id.condicion === 'nuevo' ? '' : 'Sin garantía',
      // Por defecto lo retiran en persona (pedido de Nico, 22/10/2026); se cambia en la revisión.
      envio: 'retiro'
    }
  };
}

async function cambiarCategoria(env, cuerpo) {
  const yo = await usuario(env);
  const categoria = await datosCategoria(env, cuerpo.categoria, cuerpo.identificacion?.condicion, yo.id);
  const atributos = await atributosCompletos(env, cuerpo.identificacion, categoria);
  return { categoria, atributos };
}

/** Sube a MercadoLibre las fotos que todavía no tienen id. */
async function subirFotos(env, fotos) {
  const ids = [];
  for (const f of fotos.slice(0, MAX_FOTOS)) {
    if (f.id) { ids.push(f.id); continue; }
    const m = /^data:(image\/(?:jpeg|png));base64,(.+)$/.exec(f.dataUrl || '');
    if (!m) throw Object.assign(new Error('Foto con formato inválido.'), { status: 400 });
    const bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: m[1] }), `foto.${m[1] === 'image/png' ? 'png' : 'jpg'}`);
    const { datos } = await ml(env, '/pictures/items/upload', { metodo: 'POST', cuerpo: form });
    ids.push(datos.id);
  }
  return ids;
}

/** Revisa la publicación con el validador de MercadoLibre. No publica nada. */
async function revisar(env, cuerpo) {
  const p = cuerpo.publicacion || {};
  const fotos = await subirFotos(env, cuerpo.fotos || []);
  const conFotos = { ...p, fotos };
  const falta = faltantes(conFotos);
  if (falta.length) return { ok: false, fotos, errores: [`Falta completar: ${falta.join(', ')}.`] };

  const yo = await usuario(env);
  const item = armarItem(conFotos, { userProducts: yo.userProducts });
  const { status, datos } = await ml(env, '/items/validate', { metodo: 'POST', cuerpo: item, tolerar: [400] });
  if (status !== 400) return { ok: true, fotos, item, avisos: [] };
  // Queda en el log del Worker (wrangler tail) por si hay que ver la respuesta cruda.
  console.log('validate 400', JSON.stringify(datos));
  const { errores, avisos } = separarCausas(datos);
  return { ok: !errores.length, fotos, item, errores, avisos };
}

/** Publica de verdad. La app lo llama solo después de que Nico confirma. */
async function publicar(env, cuerpo) {
  const p = cuerpo.publicacion || {};
  const fotos = await subirFotos(env, cuerpo.fotos || []);
  const conFotos = { ...p, fotos };
  const falta = faltantes(conFotos);
  if (falta.length) throw Object.assign(new Error(`Falta completar: ${falta.join(', ')}.`), { status: 400 });

  const yo = await usuario(env);
  const { datos: item } = await ml(env, '/items', { metodo: 'POST', cuerpo: armarItem(conFotos, { userProducts: yo.userProducts }) });

  // La descripción va aparte y después: si falla, la publicación ya existe y se avisa.
  let avisoDescripcion = null;
  const descripcion = limpiarDescripcion(p.descripcion);
  if (descripcion) {
    try {
      await ml(env, `/items/${item.id}/description`, { metodo: 'POST', cuerpo: { plain_text: descripcion } });
    } catch (e) {
      avisoDescripcion = `La publicación salió, pero la descripción no se cargó: ${e.message}`;
    }
  }
  return { id: item.id, permalink: item.permalink, estado: item.status, avisoDescripcion };
}

/* ---------- entrada ---------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/oauth/start') return oauthStart(request, env);
    if (url.pathname === '/oauth/callback') return oauthCallback(request, env);
    if (url.pathname === '/') return html('VendeloYa', 'Backend de VendeloYa. La app está en GitHub Pages.');

    const origen = request.headers.get('Origin') || '';
    const permitido = ORIGENES.includes(origen);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(permitido ? origen : ORIGENES[0]) });
    if (!url.pathname.startsWith('/api/')) return json({ error: 'No existe.' }, 404, ORIGENES[0]);
    if (!permitido) return json({ error: 'Origen no permitido.' }, 403, ORIGENES[0]);
    // Sin APP_SECRET no hay clave que pueda coincidir: decirlo, en vez de "clave incorrecta".
    if (!env.APP_SECRET) {
      return json({ error: 'El Worker todavía no tiene los secretos cargados. Corré tools/cargar-secretos.ps1.', faltan: faltanSecretos(env) }, 503, origen);
    }
    if (!iguales(request.headers.get('x-clave'), env.APP_SECRET)) {
      return json({ error: 'Clave incorrecta. Revisala en Ajustes.' }, 401, origen);
    }

    try {
      if (request.method === 'GET' && url.pathname === '/api/estado') return json(await estado(env), 200, origen);

      if (Number(request.headers.get('content-length') || 0) > MAX_CUERPO) return json({ error: 'Las fotos pesan demasiado.' }, 413, origen);

      // Historial y borradores: /api/registros y /api/registros/<id>
      if (url.pathname === '/api/registros' && request.method === 'GET') return json(await registros.listar(env), 200, origen);
      const reg = /^\/api\/registros\/([^/]+)$/.exec(url.pathname);
      if (reg) {
        const id = decodeURIComponent(reg[1]);
        if (request.method === 'GET') return json(await registros.leer(env, id), 200, origen);
        if (request.method === 'DELETE') return json(await registros.borrar(env, id), 200, origen);
        if (request.method === 'PUT') {
          const cambios = await request.json().catch(() => null);
          if (!cambios) return json({ error: 'Cuerpo inválido.' }, 400, origen);
          return json(await registros.guardar(env, id, cambios), 200, origen);
        }
        return json({ error: 'Método no permitido.' }, 405, origen);
      }

      if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405, origen);
      const cuerpo = await request.json().catch(() => null);
      if (!cuerpo) return json({ error: 'Cuerpo inválido.' }, 400, origen);

      const rutas = { '/api/analizar': analizar, '/api/categoria': cambiarCategoria, '/api/revisar': revisar, '/api/publicar': publicar };
      const ruta = rutas[url.pathname];
      if (!ruta) return json({ error: 'No existe.' }, 404, origen);
      return json(await ruta(env, cuerpo), 200, origen);
    } catch (e) {
      console.log(url.pathname, e.status || 500, e.message);
      return json({ error: e.message, detalle: e.ml || null }, e.status && e.status < 600 ? e.status : 500, origen);
    }
  }
};
