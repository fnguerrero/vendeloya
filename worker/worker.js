/* ============================================================
   worker.js — el backend de VendeloYa.

   Guarda lo que no puede estar en una página pública: el token de
   MercadoLibre (en KV, porque rota con cada renovación) y las claves
   de Claude y de la app de MercadoLibre (como secretos).

   Rutas:
     POST /oauth/start (k=CLAVE) conecta la cuenta de MercadoLibre
     GET  /oauth/callback        vuelta del OAuth (redirect_uri fija)
     GET  /api/estado            ¿hay cuenta conectada? ¿cuál?
     POST /api/analizar          fotos → propuesta de publicación
     POST /api/categoria         otra categoría → sus atributos
     POST /api/guia-talles       ropa/calzado: guías de talles y talles disponibles (solo lectura)
     POST /api/revisar           sube fotos y valida SIN publicar
     POST /api/publicar          publica de verdad + descripción
     POST /api/desconectar       borra el token de MercadoLibre (cerrar sesión)
     GET  /api/registros         historial (resúmenes)
     GET|PUT|DELETE /api/registros/<id>   un borrador o publicación guardada
     GET  /api/seguimiento       estado, visitas y preguntas de lo publicado (?forzar=1 salta el caché)
     GET  /api/preguntas         preguntas sin responder, con el registro al que pertenecen
     POST /api/preguntas/<id>/borrador    Claude propone una respuesta (no la envía)
     POST /api/preguntas/<id>/responder   envía la respuesta a MercadoLibre
     POST /api/publicaciones/<mlId>       precio | pausar | reactivar | vendida

   Todo /api/* pide el header x-clave = APP_SECRET. El Origin solo no
   alcanza: cualquiera lo falsifica con curl, y esta app publica en la
   cuenta real de Nico.
   ============================================================ */

import { identificar, completarAtributos, responderPregunta as borradorConIA } from './ia.js';
import * as registros from './registros.js';
import { elegirAtributos, armarItem, faltantes, precioDeReferencia, redondearPrecio, erroresML, limpiarDescripcion, aplicarGtin, aplicarDefaults, separarCausas, armarSeguimiento, estadoPublicacion, cambioPublicacion, validarRespuesta, elegirParecidos, leerComisiones, leerVisitas, bloqueoPorPermisos, mensajePermisoPreguntas, paraHuella, marcarValidado, estaValidado, gastarValidacion, CONDICIONES, requisitosDeGuia, armarBusquedaGuia, elegirGuia, filaDeGuia, tallesDeGuia, aplicarGuia, validarDescripcion, limpiarTalles, conTalle, itemsDeRegistro, juntarSeguimiento } from './logica.js';

const MAX_ITEMS_VISITAS = 30;

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
  /* La clave llega en el cuerpo de un formulario y no en la URL: una URL queda
     en el historial del navegador y en los logs de Cloudflare. */
  if (request.method !== 'POST') {
    return html('Abrilo desde la app', 'La conexión con MercadoLibre se abre desde Ajustes, con el botón "Conectar MercadoLibre".', 405);
  }
  const form = await request.formData().catch(() => null);
  if (!iguales(form && form.get('k'), env.APP_SECRET)) {
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
let refrescoEnCurso = null;
async function token(env) {
  const guardado = await env.KV.get('ml:tokens', 'json');
  if (!guardado) return null;
  if (Date.now() < guardado.vence) return guardado;
  // El refresh token se gasta al usarlo: si dos pedidos simultáneos (la app lanza varios a la vez)
  // lo usan, el segundo falla. Todos esperan el mismo refresco.
  if (refrescoEnCurso) return refrescoEnCurso;
  refrescoEnCurso = (async () => {
    try {
      const t = await pedirToken(env, { grant_type: 'refresh_token', refresh_token: guardado.refresh_token });
      await guardarTokens(env, t);
      await env.KV.put('ml:refresco', new Date().toISOString());
      return await env.KV.get('ml:tokens', 'json');
    } catch (e) {
      // Otra instancia del Worker pudo renovarlo primero: si ya hay un token vigente, se usa ese.
      const otro = await env.KV.get('ml:tokens', 'json');
      if (otro && Date.now() < otro.vence) return otro;
      throw e;
    } finally {
      refrescoEnCurso = null;
    }
  })();
  return refrescoEnCurso;
}

/* ---------- MercadoLibre ---------- */

async function ml(env, ruta, { metodo = 'GET', cuerpo, conToken = true, tolerar = [], cabeceras = {} } = {}) {
  const headers = { accept: 'application/json', ...cabeceras };
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
    return ref ? { disponible: true, ...ref, parecidos: elegirParecidos(datos.results, ref.sugerido) } : { disponible: false, motivo: 'pocos resultados' };
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

/**
 * Desconecta la cuenta: le pide a MercadoLibre que revoque el permiso de la app
 * (si falla, no importa) y borra los tokens guardados. Para volver a publicar
 * hay que tocar "Conectar" de nuevo.
 */
async function desconectar(env) {
  const t = await env.KV.get('ml:tokens', 'json');
  if (t?.user_id && env.ML_CLIENT_ID) {
    try {
      await fetch(`${ML_API}/users/${t.user_id}/applications/${env.ML_CLIENT_ID}`, {
        method: 'DELETE', headers: { authorization: `Bearer ${t.access_token}` }
      });
    } catch (e) { console.log('revocar:', e.message); }
  }
  await env.KV.delete('ml:tokens');
  return { ok: true };
}

/* ---------- seguimiento ---------- */

// MercadoLibre no cambia tan seguido y el historial se abre a cada rato: unos minutos de caché alcanzan.
const SEGUIMIENTO_TTL = 300;
const lotes = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/** Estado, visitas y preguntas sin responder de todo lo publicado, por id de registro.
 *  Visitas y preguntas son extras: si fallan, el estado sale igual. */
async function seguimiento(env, forzar = false) {
  if (!forzar) {
    const cache = await env.KV.get('seguimiento', 'json');
    if (cache) return { ...cache, cache: true };
  }
  const pubs = await registros.publicadas(env);
  const ids = [...new Set(pubs.flatMap(p => itemsDeRegistro(p).map(i => i.id)))];   // un ítem por talle
  const consultado = new Date().toISOString();
  if (!ids.length) return { registros: {}, consultado };

  const items = [];
  for (const lote of lotes(ids, 20)) {
    const { datos } = await ml(env, `/items?ids=${lote.join(',')}&attributes=id,status,sub_status,sold_quantity,available_quantity,price`);
    for (const r of datos || []) if (r.code === 200 && r.body) items.push(r.body);
  }
  // Visitas y preguntas son extras: si fallan, el estado sale igual, y el motivo queda en `diagnostico`
  // (solo códigos y formas, nunca datos de la cuenta) para poder ver qué respondió MercadoLibre.
  const diagnostico = { visitas: { estado: null }, preguntas: { estado: null } };
  const visitas = {};
  try {
    // Con la cuenta real (12/11/2026) ML contestó 400 "maximum amount of items to query is 1": /visits/items
    // admite UN ítem por llamada. Si falla, se prueba el total de los últimos 90 días de ese ítem.
    const intentos = [];
    // Un pedido por ítem (y hasta dos): con varios talles se acota para no pasar el límite de pedidos de un Worker.
    for (const lote of lotes(ids.slice(0, MAX_ITEMS_VISITAS), 1)) {
      const id1 = encodeURIComponent(lote[0]);
      const vias = [['visits/items', `/visits/items?ids=${id1}`],
                    ['visits/time_window', `/items/${id1}/visits/time_window?last=90&unit=day`]];
      for (const [via, ruta] of vias) {
        const { status, datos } = await ml(env, ruta, { tolerar: [400, 403, 404] });
        const leidas = status === 200 ? leerVisitas(datos) : {};
        intentos.push({ via, estado: status, forma: Array.isArray(datos) ? 'lista' : datos === null ? 'vacío' : typeof datos,
          codigo: status === 200 ? null : (datos?.code || datos?.error || null), mensaje: status === 200 ? null : String(datos?.message || '').slice(0, 160) });
        if (Object.keys(leidas).length) { Object.assign(visitas, leidas); diagnostico.visitas.via = via; break; }
      }
    }
    const ultimo = intentos[intentos.length - 1] || {};
    Object.assign(diagnostico.visitas, { estado: ultimo.estado ?? null, forma: ultimo.forma, codigo: ultimo.codigo, mensaje: ultimo.mensaje, intentos, conDatos: Object.keys(visitas).length });
  } catch (e) { console.log('visitas', e.message); diagnostico.visitas.error = e.message.slice(0, 120); }
  let preguntas = null;   // null = no se pudo consultar (distinto de cero preguntas)
  try {
    const r = await preguntasSinResponder(env);
    preguntas = r.preguntas;
    diagnostico.preguntas = { estado: 200, via: r.via };
  } catch (e) {
    console.log('preguntas', e.message);
    diagnostico.preguntas = { estado: e.status || null, codigo: e.ml?.code || null };
  }

  const porItem = armarSeguimiento(items, visitas, preguntas);
  const resultado = {
    registros: juntarSeguimiento(pubs, porItem),
    consultado,
    diagnostico
  };
  await env.KV.put('seguimiento', JSON.stringify(resultado), { expirationTtl: SEGUIMIENTO_TTL });
  return resultado;
}

/* ---------- preguntas y acciones sobre lo publicado ---------- */

/**
 * Las preguntas sin responder (solo lectura). Primero el recurso nuevo (/my/received_questions); si
 * MercadoLibre lo bloquea por permisos, el documentado por vendedor (/questions/search?seller_id=…).
 * Si los dos están bloqueados, el error dice qué permiso activar.
 */
async function preguntasSinResponder(env) {
  const nuevo = await ml(env, '/my/received_questions/search?status=UNANSWERED&limit=50&api_version=4', { tolerar: [403] });
  if (nuevo.status !== 403) return { preguntas: nuevo.datos?.questions || [], via: 'my/received_questions' };
  const yo = await usuario(env);
  const viejo = await ml(env, `/questions/search?seller_id=${encodeURIComponent(yo.id)}&status=UNANSWERED&limit=50&api_version=4`, { tolerar: [403] });
  if (viejo.status !== 403) return { preguntas: viejo.datos?.questions || [], via: 'questions/search' };
  throw Object.assign(new Error(mensajePermisoPreguntas('leer')), { status: 403, ml: nuevo.datos });
}

/** Preguntas sin responder, cada una con el registro de la app al que pertenece (si lo hay). */
async function preguntas(env) {
  const pubs = await registros.publicadas(env);
  const porMl = new Map(pubs.flatMap(p => itemsDeRegistro(p).map(i => [i.id, p.id])));   // cualquier talle lleva a su registro
  const titulos = new Map((await registros.listar(env)).registros.map(r => [r.id, r.titulo]));
  const { preguntas: lista } = await preguntasSinResponder(env);
  return {
    preguntas: lista.map(q => {
      const registroId = porMl.get(q.item_id) || null;
      return { id: String(q.id), mlId: q.item_id, registroId, titulo: titulos.get(registroId) || q.item_id, texto: q.text, fecha: q.date_created };
    })
  };
}

/** Claude propone la respuesta con lo que dice la publicación y la nota privada. No la envía. */
async function borradorRespuesta(env, id, cuerpo) {
  const reg = cuerpo.registroId ? await registros.leer(env, cuerpo.registroId).catch(() => null) : null;
  const p = reg?.publicacion || {};
  const a = reg?.analisis?.propuesta || {};
  const { json } = await borradorConIA(env, {
    pregunta: String(cuerpo.pregunta || '').slice(0, 2000),
    titulo: p.titulo || a.titulo || cuerpo.titulo || '',
    descripcion: p.descripcion || a.descripcion || '',
    nota: p.nota || '',
    precio: p.precio || a.precio || '',
    condicion: p.condicion || a.condicion || ''
  });
  return { texto: validarRespuesta(json.respuesta) };
}

async function responderPregunta(env, id, cuerpo) {
  const text = validarRespuesta(cuerpo.texto);
  try {
    await ml(env, '/answers', { metodo: 'POST', cuerpo: { question_id: Number(id), text } });
  } catch (e) {
    if (bloqueoPorPermisos(e)) throw Object.assign(new Error(mensajePermisoPreguntas('responder')), { status: 403, ml: e.ml });
    throw e;
  }
  await env.KV.delete('seguimiento'); // que el historial deje de contarla
  return { ok: true };
}

/**
 * Precio, stock, descripción, pausar, reactivar o marcar vendida (cerrar) una publicación.
 * El título no se edita: con User Products el nombre es el family_name y MercadoLibre no lo deja cambiar.
 */
async function cambiarPublicacion(env, mlId, cuerpo) {
  if (cuerpo.accion === 'descripcion') {
    const texto = validarDescripcion(cuerpo.descripcion);
    // Si la publicación ya tiene descripción se reemplaza (PUT); si nunca tuvo, MercadoLibre contesta 404 y se crea (POST).
    const r = await ml(env, `/items/${mlId}/description?api_version=2`, { metodo: 'PUT', cuerpo: { plain_text: texto }, tolerar: [404] });
    if (r.status === 404) await ml(env, `/items/${mlId}/description`, { metodo: 'POST', cuerpo: { plain_text: texto } });
    return { descripcion: texto };
  }
  const cambio = cambioPublicacion(cuerpo.accion, cuerpo.accion === 'stock' ? cuerpo.stock : cuerpo.precio);
  const { datos } = await ml(env, `/items/${mlId}`, { metodo: 'PUT', cuerpo: cambio });
  await env.KV.delete('seguimiento');
  return { estado: estadoPublicacion(datos), precio: Number.isFinite(datos?.price) ? datos.price : null,
    cantidad: Number.isFinite(datos?.available_quantity) ? datos.available_quantity : null };
}

/**
 * Lo que cobra MercadoLibre por vender a ese precio en esa categoría, para cada tipo
 * de publicación. Pide token (sin token da 403). Si MercadoLibre no contesta algo
 * con forma de comisión, devuelve disponible:false y la app deja cargar el porcentaje a mano.
 */
async function comision(env, categoria, precio) {
  const p = Math.round(Number(precio));
  if (!/^[A-Z]{3}\d+$/.test(categoria || '') || !(p > 0)) {
    throw Object.assign(new Error('Faltan la categoría o el precio.'), { status: 400 });
  }
  try {
    const q = new URLSearchParams({ price: String(p), category_id: categoria, currency_id: 'ARS' });
    const { status, datos } = await ml(env, `/sites/${SITIO}/listing_prices?${q}`, { tolerar: [400, 401, 403, 404] });
    const tipos = status === 200 ? leerComisiones(datos) : [];
    return tipos.length ? { disponible: true, precio: p, tipos } : { disponible: false, motivo: `MercadoLibre no informó comisiones (${status})` };
  } catch (e) {
    return { disponible: false, motivo: e.message };
  }
}

async function estado(env) {
  const faltan = faltanSecretos(env);
  if (faltan.length) return { conectado: false, faltan };
  const t = await env.KV.get('ml:tokens', 'json');
  if (!t) return { conectado: false };
  try {
    const yo = await usuario(env);   // si el token venció, acá se renueva
    const t = await env.KV.get('ml:tokens', 'json');
    // Sin el token ni nada secreto: solo cuándo vence y cuándo se renovó por última vez.
    return {
      conectado: true, ...yo,
      token: { venceEnMin: t ? Math.round((t.vence - Date.now()) / 60000) : null, ultimoRefresco: (await env.KV.get('ml:refresco')) || null }
    };
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
    ? { valor: mercado.sugerido, fuente: 'mercadolibre', min: mercado.min, max: mercado.max, muestras: mercado.muestras, parecidos: mercado.parecidos }
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

/* ---------- Guía de talles (ropa y calzado): solo lectura en MercadoLibre ---------- */

const cacheModa = new Map();   // categoría → qué pide la guía y su dominio (dura lo que dure el Worker en memoria)

async function requisitosDeModa(env, categoriaId) {
  if (cacheModa.has(categoriaId)) return cacheModa.get(categoriaId);
  // Si MercadoLibre no responde los atributos, no se bloquea nada acá (y no se recuerda): el validador igual avisa si faltaba la guía.
  const { status, datos } = await ml(env, `/categories/${categoriaId}/attributes`, { conToken: false, tolerar: [400, 404, 429, 500, 502, 503] });
  if (status !== 200 || !Array.isArray(datos)) return { pide: false };
  const r = requisitosDeGuia(datos);
  if (r.pide) {
    // El dominio ("MLA-SNEAKERS") no viene en la categoría: sale de la búsqueda de dominios por su nombre.
    const { datos: cat } = await ml(env, `/categories/${categoriaId}`, { conToken: false });
    const { datos: pred } = await ml(env, `/sites/${SITIO}/domain_discovery/search?limit=8&q=${encodeURIComponent(cat.name)}`, { conToken: false, tolerar: [400, 404] });
    r.dominio = (Array.isArray(pred) ? pred : []).find(x => x.category_id === categoriaId)?.domain_id || null;
  }
  cacheModa.set(categoriaId, r);
  return r;
}

/**
 * Busca la guía de talles que corresponde a la publicación: POST /catalog/charts/search y GET /catalog/charts/{id},
 * las dos de solo lectura. Nunca crea una guía en la cuenta: si no hay ninguna, lo dice.
 * Devuelve { pide:false } si la categoría no usa guía, o { pide:true, guia, charts, talles, error }.
 */
async function buscarGuia(env, p, yo) {
  if (!/^[A-Z]{3}\d+$/.test(p.categoria || '')) return { pide: false };
  const req = await requisitosDeModa(env, p.categoria);
  if (!req.pide) return { pide: false };
  if (!req.dominio) return { pide: true, error: 'No pude saber el dominio de ropa o calzado de esta categoría para buscar su guía de talles.' };

  const cabeceras = { 'x-caller-id': String(yo.id) };
  const buscar = async sinMarca => {
    const { cuerpo, faltan } = armarBusquedaGuia({ dominio: req.dominio, sitio: SITIO, vendedor: yo.id, requisitos: req, atributos: p.atributos, sinMarca });
    if (faltan.length) return { faltan };
    const { status, datos } = await ml(env, '/catalog/charts/search', { metodo: 'POST', cuerpo, cabeceras, tolerar: [400, 404, 422] });
    return { status, datos };
  };
  let r = await buscar(false);
  if (r.faltan) return { pide: true, error: `Para elegir la guía de talles falta completar: ${r.faltan.join(', ')}.` };
  if (r.status === 200 && !(r.datos?.charts || []).length) r = await buscar(true);   // sin la marca, por si no hay guía de esa marca
  if (r.status !== 200) return { pide: true, error: `MercadoLibre no pudo buscar la guía de talles: ${r.datos?.message || r.status}.` };

  const charts = (r.datos.charts || []).filter(c => c && c.id);
  const marca = String((p.atributos || []).find(a => a.id === 'BRAND')?.valor ?? '');
  const elegida = elegirGuia(charts, marca);
  if (!elegida) return { pide: true, charts, error: 'MercadoLibre no tiene una guía de talles estándar para este producto. Hay que crear una en la cuenta (eso lo decide Nico) o publicarlo directo desde MercadoLibre.' };
  // La búsqueda trae la guía sin filas: las filas salen de la guía puntual.
  const { datos: guia } = await ml(env, `/catalog/charts/${encodeURIComponent(elegida.id)}`);
  return { pide: true, charts, guia, talles: tallesDeGuia(guia) };
}

/** La publicación con su guía de talles puesta (si la categoría la pide). { p } o { error } con el motivo en criollo. */
async function conGuiaDeTalles(env, p, yo, busqueda) {
  const b = busqueda || await buscarGuia(env, p, yo);   // con varios talles la guía se busca una sola vez
  if (!b.pide) return { p };
  if (b.error) return { error: b.error };
  const talle = String((p.atributos || []).find(a => a.id === 'SIZE')?.valor ?? '').trim();
  const hallada = filaDeGuia(b.guia, talle);
  if (!hallada) {
    const nombre = Object.values(b.guia.names || {})[0] || `guía ${b.guia.id}`;
    return { error: `El talle «${talle || 'sin talle'}» no está en la guía de talles «${nombre}». Talles de esa guía: ${b.talles.slice(0, 20).join(', ')}.` };
  }
  return { p: aplicarGuia(p, b.guia, hallada), guia: { id: String(b.guia.id), nombre: Object.values(b.guia.names || {})[0] || null, tipo: b.guia.type || null, fila: hallada.fila } };
}

/** Solo lectura: qué guías de talles hay para esta categoría y qué talles tiene la elegida. No valida ni publica. */
async function guiaTalles(env, cuerpo) {
  const yo = await usuario(env);
  const p = { categoria: cuerpo.categoria, atributos: cuerpo.atributos || [] };
  const b = await buscarGuia(env, p, yo);
  if (!b.pide) return { pide: false };
  return {
    pide: true, error: b.error || null,
    guias: (b.charts || []).map(c => ({ id: String(c.id), tipo: c.type || null, nombre: Object.values(c.names || {})[0] || null, principal: c.main_attribute_id || null })),
    elegida: b.guia ? { id: String(b.guia.id), tipo: b.guia.type || null, nombre: Object.values(b.guia.names || {})[0] || null, filas: (b.guia.rows || []).length } : null,
    talles: b.talles || [],
    formaFila: b.guia?.rows?.[0] ? { id: b.guia.rows[0].id, columnas: (b.guia.rows[0].attributes || []).map(a => a.id) } : null
  };
}

/**
 * Revisa la publicación con el validador de MercadoLibre. No publica nada.
 * Con `publicacion.talles` (ropa y calzado) revisa un ítem por talle: con User Products no hay `variations`.
 */
async function revisar(env, cuerpo) {
  const talles = limpiarTalles(cuerpo.publicacion?.talles);
  return talles.length ? revisarVarios(env, cuerpo, talles) : revisarUno(env, cuerpo);
}

async function revisarVarios(env, cuerpo, talles) {
  const p = cuerpo.publicacion;
  const fotos = await subirFotos(env, cuerpo.fotos || []);
  const falta = faltantes({ ...conTalle(p, talles[0]), fotos });
  if (falta.length) return { ok: false, fotos, errores: [`Falta completar: ${falta.join(', ')}.`] };
  const yo = await usuario(env);
  const busqueda = await buscarGuia(env, conTalle(p, talles[0]), yo);
  const porTalle = [];
  for (const talle of talles) {
    const r = await revisarUno(env, { publicacion: conTalle(p, talle), fotos: fotos.map(id => ({ id })) }, { yo, busqueda });
    porTalle.push({ talle, ok: !!r.ok, errores: r.errores || [], avisos: r.avisos || [], guia: r.guia || null });
  }
  return {
    ok: porTalle.every(t => t.ok), fotos, porTalle,
    errores: porTalle.flatMap(t => t.errores.map(e => `Talle ${t.talle}: ${e}`)),
    avisos: [...new Set(porTalle.flatMap(t => t.avisos))],
    guia: porTalle.find(t => t.guia)?.guia || null
  };
}

async function revisarUno(env, cuerpo, ctx = {}) {
  const p = cuerpo.publicacion || {};
  const fotos = await subirFotos(env, cuerpo.fotos || []);
  let conFotos = { ...p, fotos };
  const falta = faltantes(conFotos);
  if (falta.length) return { ok: false, fotos, errores: [`Falta completar: ${falta.join(', ')}.`] };

  const yo = ctx.yo || await usuario(env);
  const g = await conGuiaDeTalles(env, conFotos, yo, ctx.busqueda);
  if (g.error) return { ok: false, fotos, errores: [g.error] };
  conFotos = g.p;
  const item = armarItem(conFotos, { userProducts: yo.userProducts });
  const { status, datos } = await ml(env, '/items/validate', { metodo: 'POST', cuerpo: item, tolerar: [400] });
  const sello = paraHuella(item, p.descripcion);
  if (status !== 400) {
    await marcarValidado(env.KV, sello);   // /api/publicar solo acepta lo que pasó por acá, con este mismo contenido (descripción incluida)
    return { ok: true, fotos, item, avisos: [], guia: g.guia };
  }
  // Queda en el log del Worker (wrangler tail) por si hay que ver la respuesta cruda.
  console.log('validate 400', JSON.stringify(datos));
  const { errores, avisos } = separarCausas(datos, { envio: p.envio });
  if (!errores.length) await marcarValidado(env.KV, sello);   // solo avisos: se puede publicar
  return { ok: !errores.length, fotos, item, errores, avisos, guia: g.guia };
}

const SIN_REVISAR = 'Esta publicación no pasó la revisión de MercadoLibre con este contenido (o cambió después). Tocá Publicar de nuevo para que la revise.';

/**
 * Prepara lo que se va a publicar y comprueba que pasó la revisión, SIN publicar nada.
 * Tira 412 si no pasó (o cambió), 422 si la guía de talles no sirve, 400 si falta algo.
 */
async function prepararPublicacion(env, cuerpo, ctx = {}) {
  const p = cuerpo.publicacion || {};
  // Una foto sin id nunca pasó por la revisión (la revisión es la que las sube): no se sube nada acá.
  if ((cuerpo.fotos || []).some(f => !f.id)) throw Object.assign(new Error(SIN_REVISAR), { status: 412 });
  const fotos = await subirFotos(env, cuerpo.fotos || []);
  let conFotos = { ...p, fotos };
  const falta = faltantes(conFotos);
  if (falta.length) throw Object.assign(new Error(`Falta completar: ${falta.join(', ')}.`), { status: 400 });

  const yo = ctx.yo || await usuario(env);
  // La guía de talles se vuelve a buscar igual que en la revisión: si cambió, el sello no coincide y pide revisar de nuevo.
  const g = await conGuiaDeTalles(env, conFotos, yo, ctx.busqueda);
  if (g.error) throw Object.assign(new Error(g.error), { status: 422 });
  conFotos = g.p;
  const cuerpoItem = armarItem(conFotos, { userProducts: yo.userProducts });
  // Solo se publica el contenido exacto que aprobó el validador (POST /items/validate, vía /api/revisar).
  const sello = paraHuella(cuerpoItem, p.descripcion);
  if (!(await estaValidado(env.KV, sello))) throw Object.assign(new Error(SIN_REVISAR), { status: 412 });
  return { cuerpoItem, sello, descripcion: limpiarDescripcion(p.descripcion) };
}

/** Publica de verdad un ítem ya preparado y comprobado. */
async function emitirPublicacion(env, { cuerpoItem, sello, descripcion }) {
  const { datos: item } = await ml(env, '/items', { metodo: 'POST', cuerpo: cuerpoItem });
  await gastarValidacion(env.KV, sello);

  // La descripción va aparte y después: si falla, la publicación ya existe y se avisa.
  let avisoDescripcion = null;
  if (descripcion) {
    try {
      await ml(env, `/items/${item.id}/description`, { metodo: 'POST', cuerpo: { plain_text: descripcion } });
    } catch (e) {
      avisoDescripcion = `La publicación salió, pero la descripción no se cargó: ${e.message}`;
    }
  }
  return { id: item.id, permalink: item.permalink, estado: item.status, avisoDescripcion };
}

/**
 * Publica de verdad. La app lo llama solo después de que Nico confirma.
 * Con `publicacion.talles` publica un ítem por talle: antes de publicar ninguno se comprueba que TODOS pasaron la
 * revisión (si uno no, no sale nada); después, si ML rechaza uno, los demás siguen y el resultado lo informa en `fallaron`.
 */
async function publicar(env, cuerpo) {
  const talles = limpiarTalles(cuerpo.publicacion?.talles);
  if (!talles.length) return emitirPublicacion(env, await prepararPublicacion(env, cuerpo));

  const p = cuerpo.publicacion;
  if ((cuerpo.fotos || []).some(f => !f.id)) throw Object.assign(new Error(SIN_REVISAR), { status: 412 });
  const fotos = await subirFotos(env, cuerpo.fotos || []);
  const yo = await usuario(env);
  const busqueda = await buscarGuia(env, conTalle(p, talles[0]), yo);
  const preparados = [];
  for (const talle of talles) {
    try {
      preparados.push({ talle, prep: await prepararPublicacion(env, { publicacion: conTalle(p, talle), fotos: fotos.map(id => ({ id })) }, { yo, busqueda }) });
    } catch (e) {
      if (e.status !== 412) e.message = `Talle ${talle}: ${e.message}`;
      throw e;
    }
  }
  const items = [];
  const fallaron = [];
  for (const { talle, prep } of preparados) {
    try {
      const r = await emitirPublicacion(env, prep);
      items.push({ talle, ...r });
    } catch (e) {
      fallaron.push({ talle, error: e.message });
    }
  }
  if (!items.length) throw Object.assign(new Error(`No salió ningún talle. ${fallaron[0].error}`), { status: 502 });
  const primero = items[0];
  return { id: primero.id, permalink: primero.permalink, estado: primero.estado, avisoDescripcion: items.find(i => i.avisoDescripcion)?.avisoDescripcion || null, items, fallaron };
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
      if (request.method === 'GET' && url.pathname === '/api/seguimiento') return json(await seguimiento(env, url.searchParams.has('forzar')), 200, origen);
      if (request.method === 'GET' && url.pathname === '/api/preguntas') return json(await preguntas(env), 200, origen);
      if (request.method === 'GET' && url.pathname === '/api/comision') return json(await comision(env, url.searchParams.get('categoria'), url.searchParams.get('precio')), 200, origen);

      if (Number(request.headers.get('content-length') || 0) > MAX_CUERPO) return json({ error: 'Las fotos pesan demasiado.' }, 413, origen);

      // Historial y borradores: /api/registros y /api/registros/<id>
      if (url.pathname === '/api/desconectar' && request.method === 'POST') return json(await desconectar(env), 200, origen);
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

      const preg = /^\/api\/preguntas\/(\d+)\/(borrador|responder)$/.exec(url.pathname);
      if (preg) return json(await (preg[2] === 'borrador' ? borradorRespuesta : responderPregunta)(env, preg[1], cuerpo), 200, origen);
      const pub = /^\/api\/publicaciones\/([A-Z]{3}\d{6,})$/.exec(url.pathname);
      if (pub) return json(await cambiarPublicacion(env, pub[1], cuerpo), 200, origen);

      const rutas = { '/api/analizar': analizar, '/api/categoria': cambiarCategoria, '/api/revisar': revisar, '/api/publicar': publicar, '/api/guia-talles': guiaTalles };
      const ruta = rutas[url.pathname];
      if (!ruta) return json({ error: 'No existe.' }, 404, origen);
      return json(await ruta(env, cuerpo), 200, origen);
    } catch (e) {
      console.log(url.pathname, e.status || 500, e.message);
      return json({ error: e.message, detalle: e.ml || null }, e.status && e.status < 600 ? e.status : 500, origen);
    }
  }
};
