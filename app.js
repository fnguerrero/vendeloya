/* ============================================================
   app.js — la PWA de VendeloYa.

   Fotos → Armar la publicación (el Worker llama a Claude y a
   MercadoLibre) → revisión editable → Revisar (validador de
   MercadoLibre, no publica) → Publicar (con confirmación).

   Cada análisis es un "registro" guardado en el Worker: lo que se
   edita se autoguarda, al recargar se retoma donde estaba, y el
   historial muestra todo lo analizado y publicado, desde cualquier
   dispositivo.

   ?demo=1 corre sin Worker, con respuestas de mentira, para probar la
   pantalla sin gastar ni publicar nada.
   ============================================================ */

const $ = id => document.getElementById(id);
const DEMO = new URLSearchParams(location.search).has('demo');
// En el demo, ?falla=analizar (o guardar, categoria…) simula que esa llamada falla, para probar los avisos.
const FALLAS = new Set(new URLSearchParams(location.search).getAll('falla'));
const MAX_FOTOS = 6;
const LADO_FOTO = 1200;   // lo que recomienda MercadoLibre; también alcanza para Claude
const LADO_MINIMO = 500;  // debajo de esto MercadoLibre la deja chica y baja la calidad
const LADO_THUMB = 160;   // la miniatura del historial
const ESPERA_GUARDADO = 1200;

const estado = {
  fotos: [],          // { dataUrl, id? }  el id lo da MercadoLibre al subirla
  analisis: null,     // respuesta de /api/analizar
  categoria: null,
  atributos: [],
  revisada: false,    // true solo si el validador dio OK y no se tocó nada después
  registroId: null,   // el registro guardado en el Worker
  estadoReg: 'borrador'
};

/* ---------- utilidades ---------- */

function local(clave, valor) {
  try {
    if (valor === undefined) return localStorage.getItem(clave) || '';
    if (valor === null) localStorage.removeItem(clave);
    else localStorage.setItem(clave, valor);
  } catch { return ''; }
}

const clave = () => local('vendeloya.clave');

function esperar(texto) {
  $('espera-texto').textContent = texto;
  $('espera').hidden = !texto;
}

/** Aviso en la pantalla (en vez de un alert). `accion` agrega un botón, como "Reintentar". */
function avisos(el, tipo, titulo, lista = [], accion) {
  el.className = `avisos ${tipo}`;
  el.replaceChildren();
  const p = document.createElement('p');
  p.textContent = titulo;
  if (accion) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'enlace';
    b.textContent = accion.texto;
    b.onclick = accion.alHacer;
    p.append(' ', b);
  }
  el.append(p);
  if (lista.length) {
    const ul = document.createElement('ul');
    for (const t of lista) { const li = document.createElement('li'); li.textContent = t; ul.append(li); }
    el.append(ul);
  }
  el.hidden = false;
}

const pesos = n => Number(n || 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

const fecha = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  const hoy = new Date();
  if (d.toDateString() === hoy.toDateString()) return `hoy ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`;
  const dias = Math.round((new Date(hoy).setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
  if (dias === 1) return 'ayer';
  if (dias > 1 && dias < 7) return `hace ${dias} días`;
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
};

const nuevoId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

async function api(ruta, cuerpo, metodo, { keepalive = false } = {}) {
  if (DEMO) return apiDemo(ruta, cuerpo, metodo);
  // El estado se pide igual sin clave: así se entera de si al Worker le faltan secretos.
  if (!clave() && ruta !== '/api/estado') {
    abrirConfig();
    throw new Error('Cargá la clave de la app en Ajustes.');
  }
  const res = await fetch(window.VENDELOYA.worker + ruta, {
    method: metodo || (cuerpo ? 'POST' : 'GET'),
    headers: { 'x-clave': clave(), ...(cuerpo ? { 'content-type': 'application/json' } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    keepalive // para el guardado al cerrar la pestaña: el pedido sigue aunque la página se vaya
  });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 409) refrescarCuenta();
    throw Object.assign(new Error(datos.error || `Error ${res.status}`), { faltan: datos.faltan, status: res.status });
  }
  return datos;
}

let toastTimer;
/** Aviso abajo con una acción opcional (Deshacer). Al vencer, corre `alVencer`. */
function toast(texto, { accion, alAccion, alVencer, ms = 6000 } = {}) {
  clearTimeout(toastTimer);
  $('toast-texto').textContent = texto;
  $('toast-accion').hidden = !accion;
  $('toast-accion').textContent = accion || '';
  $('toast-accion').onclick = () => { clearTimeout(toastTimer); $('toast').hidden = true; alAccion?.(); };
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; alVencer?.(); }, ms);
}

/* ---------- pantallas ---------- */

function pantalla(cual) {
  $('paso-fotos').hidden = cual !== 'inicio';
  $('historial').hidden = cual !== 'inicio';
  $('paso-revision').hidden = cual !== 'revision';
  $('paso-listo').hidden = cual !== 'listo';
  // En la revisión la página se ensancha para la columna de la IA (en la compu).
  document.body.classList.toggle('revisando', cual === 'revision');
  scrollTo({ top: 0 });
}

/* ---------- cuenta ---------- */

async function refrescarCuenta() {
  const b = $('cuenta');
  try {
    const e = await api('/api/estado');
    b.dataset.faltan = (e.faltan || []).join(', ');
    b.textContent = e.conectado ? e.nickname : e.faltan?.length ? 'Falta configurar' : 'Conectar MercadoLibre';
    b.classList.toggle('conectada', !!e.conectado);
    b.dataset.conectada = e.conectado ? '1' : '';
    b.dataset.nickname = e.nickname || '';
    pintarAvisoCuenta(e.conectado ? 'ok' : e.faltan?.length ? 'faltan' : 'conectar');
  } catch (err) {
    b.dataset.faltan = err.faltan ? err.faltan.join(', ') : '';
    b.textContent = err.faltan ? 'Falta configurar' : clave() ? 'Sin conexión' : 'Falta la clave';
    b.classList.remove('conectada');
    b.dataset.conectada = '';
    b.dataset.nickname = '';
    pintarAvisoCuenta(err.faltan ? 'faltan' : clave() ? 'sin-conexion' : 'clave');
  }
  pintarConfig();
}

/* En el inicio, un aviso con la salida cuando la cuenta no está lista para publicar. */
const AVISOS_CUENTA = {
  conectar: 'Todavía no conectaste tu cuenta de MercadoLibre: sin eso no podés publicar.',
  faltan: 'Al Worker le faltan secretos, así que todavía no se puede conectar la cuenta.',
  clave: 'Falta cargar la clave de la app para empezar.'
};
function pintarAvisoCuenta(tipo) {
  estado.cuenta = tipo;
  $('aviso-cuenta').hidden = !(tipo in AVISOS_CUENTA);
  $('aviso-cuenta-texto').textContent = AVISOS_CUENTA[tipo] || '';
}
$('aviso-cuenta-abrir').addEventListener('click', abrirConfig);

/* Sin señal: aviso arriba y Armar/Publicar frenados (lo editado se guarda al volver). */
let sinRed = !navigator.onLine;
function actualizarRed(sin = sinRed) {
  sinRed = sin;
  $('aviso-red').hidden = !sin;
  $('publicar').disabled = sin;
  $('analizar').disabled = sin || !estado.fotos.length;
  pintarCola();
}
addEventListener('offline', () => actualizarRed(true));
addEventListener('online', () => {
  actualizarRed(false);
  refrescarCuenta();
  if (!$('historial').hidden) cargarHistorial();
  if (sinGuardar) guardar();
});

/* Instalar la app (el navegador avisa cuando se puede). */
let instalador = null;
/** Todo el historial con sus registros completos (fotos incluidas), para el archivo de respaldo. */
async function armarRespaldo() {
  const { registros } = await api('/api/registros');
  const completos = [];
  for (const r of registros) {
    try { completos.push(await api(`/api/registros/${r.id}`)); } catch { completos.push(r); }
  }
  return { app: 'VendeloYa', exportado: new Date().toISOString(), registros: completos };
}
$('exportar-historial').addEventListener('click', async () => {
  const b = $('exportar-historial');
  b.disabled = true;
  b.textContent = 'Armando el archivo…';
  try {
    const datos = await armarRespaldo();
    const url = URL.createObjectURL(new Blob([JSON.stringify(datos)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `vendeloya-historial-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast(`Listo: ${datos.registros.length} registro${datos.registros.length === 1 ? '' : 's'} en el archivo.`);
  } catch (e) {
    toast(`No se pudo armar el respaldo: ${e.message}`);
  }
  b.disabled = false;
  b.textContent = 'Descargar mi historial (JSON)';
});

/* ---------- tema ---------- */

/** auto (como el sistema), claro u oscuro; se recuerda por dispositivo. */
function aplicarTema(tema) {
  const t = ['claro', 'oscuro'].includes(tema) ? tema : 'auto';
  if (t === 'auto') delete document.documentElement.dataset.tema;
  else document.documentElement.dataset.tema = t;
  local('vendeloya.tema', t === 'auto' ? null : t);
  for (const b of document.querySelectorAll('.filtro.tema')) b.classList.toggle('activo', b.dataset.tema === t);
}
for (const b of document.querySelectorAll('.filtro.tema')) b.addEventListener('click', () => aplicarTema(b.dataset.tema));
aplicarTema(local('vendeloya.tema'));

addEventListener('beforeinstallprompt', e => { e.preventDefault(); instalador = e; $('instalar-app').hidden = false; });
addEventListener('appinstalled', () => { instalador = null; $('instalar-app').hidden = true; toast('App instalada.'); });
$('instalar-app').addEventListener('click', async () => {
  const ev = instalador;
  if (!ev) return;
  instalador = null;
  $('instalar-app').hidden = true;
  ev.prompt();
  await ev.userChoice?.catch(() => {});
});

/* ---------- configuración ---------- */

function pintarConfig() {
  const b = $('cuenta');
  const conectada = !!b.dataset.conectada;
  $('config-cuenta').textContent = b.dataset.faltan
    ? `Al Worker le faltan secretos: ${b.dataset.faltan}. Se cargan con tools/cargar-secretos.ps1.`
    : !clave() && !DEMO ? 'Primero cargá la clave de la app, acá abajo.'
    : conectada ? `Conectada como ${b.dataset.nickname}.` : 'No hay ninguna cuenta conectada.';
  $('conectar-ml').textContent = conectada ? 'Volver a conectar' : 'Conectar MercadoLibre';
  $('conectar-ml').disabled = !!b.dataset.faltan || (!clave() && !DEMO);
  $('desconectar-ml').hidden = !conectada;
  $('cerrar-sesion').hidden = !clave();
}

function abrirConfig() {
  pintarConfig();
  $('cierre').value = cierre();
  $('config').showModal();
}
$('abrir-config').addEventListener('click', abrirConfig);
$('cuenta').addEventListener('click', abrirConfig);
$('cerrar-config').addEventListener('click', () => $('config').close());

$('conectar-ml').addEventListener('click', () => {
  if (DEMO) return;
  /* Un formulario POST en vez de ?k= en la URL: así la clave no queda en el
     historial del navegador ni en los logs del Worker. */
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = `${window.VENDELOYA.worker}/oauth/start`;
  form.target = '_blank';
  form.rel = 'noopener';
  const k = document.createElement('input');
  k.type = 'hidden'; k.name = 'k'; k.value = clave();
  form.appendChild(k);
  document.body.appendChild(form);
  form.submit();
  form.remove();
});

$('desconectar-ml').addEventListener('click', async () => {
  if (!confirm('¿Desconectar tu cuenta de MercadoLibre? Para volver a publicar vas a tener que conectarla de nuevo.')) return;
  try {
    await api('/api/desconectar', {});
    toast('Cuenta de MercadoLibre desconectada.');
  } catch (e) { toast(`No se pudo desconectar: ${e.message}`); }
  refrescarCuenta();
});

$('cerrar-sesion').addEventListener('click', () => {
  local('vendeloya.clave', null);
  local('vendeloya.actual', null);
  toast('Sesión cerrada en este dispositivo.');
  volverAlInicio();
  refrescarCuenta();
});
// Al volver de la pestaña de MercadoLibre (o de otra app), se mira si quedó conectada.
// Al irse (otra pestaña, otra app, cerrar), lo que estaba por guardarse se guarda ya.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { guardarAlSalir(); return; }
  refrescarCuenta();
  if (!$('historial').hidden) cargarHistorial();
});

/* Mi cierre: un texto que se repite al final de las descripciones (retiro, horarios, no envíos…). */
const cierre = () => local('vendeloya.cierre').trim();

function pintarCierre() {
  $('agregar-cierre').hidden = !cierre();
}
$('guardar-cierre').addEventListener('click', () => {
  local('vendeloya.cierre', $('cierre').value.trim() || null);
  pintarCierre();
  toast($('cierre').value.trim() ? 'Cierre guardado.' : 'Cierre borrado.');
});
$('agregar-cierre').addEventListener('click', () => {
  const texto = cierre();
  const d = $('descripcion');
  if (!texto) return;
  if (d.value.includes(texto)) { toast('Ese cierre ya está en la descripción.'); return; }
  d.value = `${d.value.trimEnd()}\n\n${texto}`.trimStart();
  d.dispatchEvent(new Event('input', { bubbles: true }));
});

$('guardar-clave').addEventListener('click', () => {
  local('vendeloya.clave', $('clave').value.trim());
  $('clave').value = '';
  toast('Clave guardada.');
  refrescarCuenta();
  cargarHistorial();
});

/* ---------- fotos ---------- */

function escalar(fuente, lado, calidad) {
  return new Promise((ok, mal) => {
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, lado / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * escala);
      cv.height = Math.round(img.height * escala);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      ok({ dataUrl: cv.toDataURL('image/jpeg', calidad), chica: Math.max(img.width, img.height) < LADO_MINIMO });
    };
    img.onerror = () => mal(new Error('No se pudo leer la foto.'));
    img.src = fuente;
  });
}

async function agregarFotos(archivos) {
  let chicas = 0, malas = 0, sobran = 0;
  $('aviso-inicio').hidden = true;
  for (const a of archivos) {
    if (estado.fotos.length >= MAX_FOTOS) { sobran++; continue; }
    const url = URL.createObjectURL(a);
    try {
      const { dataUrl, chica } = await escalar(url, LADO_FOTO, 0.85);
      estado.fotos.push({ dataUrl });
      if (chica) chicas++;
    } catch { malas++; }
    URL.revokeObjectURL(url);
  }
  const notas = [];
  if (malas) notas.push(malas === 1 ? 'Una foto no se pudo leer.' : `${malas} fotos no se pudieron leer.`);
  if (sobran) notas.push(`Entran hasta ${MAX_FOTOS} fotos: ${sobran === 1 ? 'una quedó' : `${sobran} quedaron`} afuera.`);
  if (chicas) notas.push('Alguna foto es chica (menos de 500 px): MercadoLibre la va a mostrar con baja calidad.');
  if (notas.length) avisos($('aviso-inicio'), malas ? 'error' : '', notas.join(' '));
  dibujarFotos();
}

/** Gira la foto 90° a la derecha (las del celu a veces llegan acostadas). */
function girar(dataUrl) {
  return new Promise((ok, mal) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = img.height;
      cv.height = img.width;
      const c = cv.getContext('2d');
      c.translate(cv.width, 0);
      c.rotate(Math.PI / 2);
      c.drawImage(img, 0, 0);
      ok(cv.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => mal(new Error('No se pudo rotar la foto.'));
    img.src = dataUrl;
  });
}

async function rotarFoto(i) {
  const f = estado.fotos[i];
  try {
    f.dataUrl = await girar(f.dataUrl);
    delete f.id; // ya no es la que subió MercadoLibre
  } catch (e) { toast(e.message); }
  dibujarFotos();
}

/** La primera foto es la portada de la publicación. */
function hacerPortada(i) {
  estado.fotos.unshift(...estado.fotos.splice(i, 1));
}

function botonFoto(texto, etiqueta, clase, alHacer) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = clase;
  b.textContent = texto;
  b.title = etiqueta;
  b.setAttribute('aria-label', etiqueta);
  b.onclick = alHacer;
  return b;
}

/** Mueve una foto de lugar (el primero es la portada). */
function moverFoto(de, a) {
  if (de === a || !estado.fotos[de] || a < 0 || a >= estado.fotos.length) return;
  estado.fotos.splice(a, 0, ...estado.fotos.splice(de, 1));
}

let fotoArrastrada = null;

function dibujarFotos() {
  $('miniaturas').replaceChildren(...estado.fotos.map((f, i) => {
    const d = document.createElement('div');
    d.className = 'miniatura';
    // En la compu se reordenan arrastrando; en el celu, con la ★.
    d.draggable = true;
    d.addEventListener('dragstart', e => {
      fotoArrastrada = i;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(i));
      d.classList.add('moviendo');
    });
    d.addEventListener('dragend', () => { fotoArrastrada = null; d.classList.remove('moviendo'); });
    d.addEventListener('dragover', e => {
      if (fotoArrastrada === null) return;
      e.preventDefault();
      d.classList.add('destino');
    });
    d.addEventListener('dragleave', () => d.classList.remove('destino'));
    d.addEventListener('drop', e => {
      if (fotoArrastrada === null) return;
      e.preventDefault();
      e.stopPropagation();
      moverFoto(fotoArrastrada, i);
      fotoArrastrada = null;
      dibujarFotos();
    });
    const img = document.createElement('img');
    img.draggable = false;
    img.src = f.dataUrl;
    img.alt = `Foto ${i + 1}`;
    d.append(img,
      botonFoto('×', `Sacar foto ${i + 1}`, 'sacar', () => { estado.fotos.splice(i, 1); dibujarFotos(); }),
      botonFoto('⟳', `Rotar foto ${i + 1}`, 'rotar', () => rotarFoto(i)),
      botonFoto('✎', `Editar foto ${i + 1} (recortar, ajustar)`, 'editar', () => abrirEditor(i)));
    if (i === 0) {
      const s = document.createElement('span');
      s.className = 'es-portada';
      s.textContent = 'Portada';
      d.append(s);
    } else {
      d.append(botonFoto('★', `Usar la foto ${i + 1} de portada`, 'portada', () => { hacerPortada(i); dibujarFotos(); }));
    }
    return d;
  }));
  $('analizar').disabled = sinRed || !estado.fotos.length;
  pintarCola();
  $('zona-fotos').hidden = estado.fotos.length >= MAX_FOTOS;
  $('zona-fotos').querySelector('strong').textContent = estado.fotos.length ? 'Agregar más fotos' : 'Elegí o arrastrá tus fotos';
  $('zona-fotos').querySelector('span').textContent = estado.fotos.length
    ? `${estado.fotos.length} de ${MAX_FOTOS}` : 'JPG o PNG · hasta 6';
}

for (const id of ['camara', 'galeria']) {
  $(id).addEventListener('change', e => { agregarFotos([...e.target.files]); e.target.value = ''; });
}

/* En la compu: arrastrar y soltar fotos sobre la tarjeta. */
$('paso-fotos').addEventListener('dragover', e => {
  if (![...(e.dataTransfer?.items || [])].some(i => i.kind === 'file')) return;
  e.preventDefault();
  $('zona-fotos').classList.add('arrastrando');
});
$('paso-fotos').addEventListener('dragleave', e => {
  if (!$('paso-fotos').contains(e.relatedTarget)) $('zona-fotos').classList.remove('arrastrando');
});
$('paso-fotos').addEventListener('drop', e => {
  e.preventDefault();
  $('zona-fotos').classList.remove('arrastrando');
  const imagenes = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'));
  if (imagenes.length) agregarFotos(imagenes);
});

/* Arrastrar sobre cualquier parte de la página (inicio o revisión): un velo dice "Soltá acá". */
const traeArchivos = e => [...(e.dataTransfer?.items || [])].some(i => i.kind === 'file');
const sePuedenSoltar = () => (!$('paso-fotos').hidden || !$('paso-revision').hidden) && !document.querySelector('dialog[open]');
document.addEventListener('dragover', e => {
  if (!traeArchivos(e) || !sePuedenSoltar()) return;
  e.preventDefault();
  $('velo-arrastre').hidden = false;
});
document.addEventListener('dragleave', e => {
  if (e.relatedTarget === null) $('velo-arrastre').hidden = true;   // salió de la ventana
});
document.addEventListener('drop', e => {
  $('velo-arrastre').hidden = true;
  if (e.defaultPrevented || !sePuedenSoltar()) return;   // la tarjeta de fotos ya lo tomó
  e.preventDefault();
  const imagenes = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'));
  if (!imagenes.length) return;
  agregarFotos(imagenes).then(() => { if (!$('paso-revision').hidden) fotosCambiaron(); });
});

/* En la compu: pegar con Ctrl+V una foto copiada (una captura, una imagen de otra página). */
document.addEventListener('paste', e => {
  if ($('paso-fotos').hidden) return;
  const imagenes = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
  if (!imagenes.length) return;
  e.preventDefault();
  agregarFotos(imagenes);
});

/* ---------- análisis ---------- */

/** Si falla, las fotos quedan como estaban y el aviso ofrece reintentar. */
async function analizar() {
  $('aviso-inicio').hidden = true;
  esperar('Mirando las fotos y armando la publicación…');
  let r;
  try {
    r = await api('/api/analizar', { fotos: estado.fotos.map(f => f.dataUrl) });
  } catch (e) {
    avisos($('aviso-inicio'), 'error', `No se pudo armar la publicación: ${e.message}`, [], { texto: 'Reintentar', alHacer: analizar });
    return;
  } finally {
    esperar('');
  }
  estado.analisis = r;
  estado.registroId = nuevoId();
  estado.estadoReg = 'borrador';
  mostrarRevision(r);
  local('vendeloya.actual', estado.registroId);
  // Primer guardado: con las fotos y la miniatura. Los siguientes van sin fotos.
  await guardar({ fotos: estado.fotos, ...(await miniatura()), analisis: r });
}
$('analizar').addEventListener('click', analizar);

/* ---------- cola de varios productos ---------- */

/* Se arma un grupo de fotos por producto, se suma a la cola y se arman de a uno (para no
   saturar a Claude ni a MercadoLibre). Cada producto listo queda como un borrador normal
   en el historial; la cola vive solo en esta pestaña y se usa para revisarlos en fila.
   estado: pendiente → armando → lista | error. */
const MAX_COLA = 10;
const cola = [];
let colaCorriendo = false;
let colaNumero = 0;

const sigueEnCola = () => cola.find(c => c.estado === 'lista' && !c.visto && c.id !== estado.registroId);

function pintarCola() {
  const n = cola.length;
  const listas = cola.filter(c => c.estado === 'lista').length;
  const faltan = cola.filter(c => c.estado === 'pendiente').length;
  const fallaron = cola.filter(c => c.estado === 'error').length;
  $('cola-sumar').disabled = sinRed || !estado.fotos.length || n >= MAX_COLA;
  $('cola-armar').disabled = sinRed || colaCorriendo || !(faltan || fallaron);
  $('cola-armar').textContent = colaCorriendo ? 'Armando…' : faltan ? (n > 1 ? `Armar ${faltan === 1 ? 'el que falta' : `los ${faltan}`}` : 'Armar') : fallaron ? 'Reintentar los que fallaron' : 'Armar todos';
  $('cola-vaciar').hidden = !n || colaCorriendo;
  $('lote-resumen').textContent = n ? `${listas} de ${n} listos` : 'cola vacía';
  const porPerder = colaPorPerder(cola);
  $('cola-aviso').hidden = !porPerder;
  $('cola-aviso').textContent = `${porPerder === 1 ? 'Falta armar 1 producto' : `Faltan armar ${porPerder} productos`}: si cerrás o recargás la pestaña, se pierde${porPerder === 1 ? '' : 'n'} (lo ya armado queda como borrador).`;

  $('cola-lista').replaceChildren(...cola.map(c => {
    const li = document.createElement('li');
    li.dataset.estado = c.estado;
    const img = document.createElement('img');
    img.src = c.thumb;
    img.alt = '';
    const texto = document.createElement('div');
    texto.className = 'cola-texto';
    const t = document.createElement('strong');
    t.textContent = c.titulo || `Producto ${c.numero}`;
    const s = document.createElement('small');
    s.textContent = { pendiente: `${c.fotos.length} ${c.fotos.length === 1 ? 'foto' : 'fotos'} · esperando`, armando: 'armando la publicación',
      lista: c.visto ? 'lista · ya la abriste' : 'lista para revisar', error: c.error || 'no se pudo armar' }[c.estado];
    texto.append(t, s);
    li.append(img, texto);
    if (c.estado === 'lista') li.append(botonFoto('Revisar', `Revisar ${c.titulo || `producto ${c.numero}`}`, 'boton secundario', () => abrirDeCola(c)));
    else if (c.estado !== 'armando') li.append(botonFoto('✕', `Sacar el producto ${c.numero} de la cola`, 'enlace', () => sacarDeCola(c)));
    return li;
  }));

  const sig = sigueEnCola();
  const pendientesDeRevisar = cola.filter(c => c.estado === 'lista' && !c.visto && c.id !== estado.registroId).length;
  $('cola-siguiente').hidden = !sig;
  $('cola-siguiente').textContent = `Siguiente de la cola (${pendientesDeRevisar}) ›`;
}

async function sumarAColaYa() {
  if (!estado.fotos.length || cola.length >= MAX_COLA) return;
  const fotos = estado.fotos.map(f => ({ dataUrl: f.dataUrl }));
  const thumb = await escalar(fotos[0].dataUrl, LADO_THUMB, 0.7).then(m => m.dataUrl).catch(() => '');
  cola.push({ numero: ++colaNumero, fotos, thumb, estado: 'pendiente' });
  estado.fotos = [];
  $('aviso-inicio').hidden = true;
  dibujarFotos();
  $('lote').open = true;
}
/* Un doble toque en "Sumar" (o un toque mientras se escala la miniatura) no duplica el producto: ni doble gasto de Claude. */
const sumarACola = unaALaVez(sumarAColaYa);

function sacarDeCola(c) {
  const i = cola.indexOf(c);
  if (i < 0 || c.estado === 'armando') return;
  cola.splice(i, 1);
  pintarCola();
  toast('Sacado de la cola.', { accion: 'Deshacer', alAccion: () => { cola.splice(Math.min(i, cola.length), 0, c); pintarCola(); } });
}

function vaciarCola() {
  if (colaCorriendo || !cola.length) return;
  const copia = cola.splice(0);
  pintarCola();
  toast('Cola vaciada. Lo que ya estaba listo sigue como borrador en el historial.', { accion: 'Deshacer', alAccion: () => { cola.push(...copia); pintarCola(); } });
}

/** Arma la publicación de un producto de la cola y la deja guardada como borrador. */
async function armarDeCola(c) {
  c.estado = 'armando';
  c.error = '';
  pintarCola();
  try {
    const r = await api('/api/analizar', { fotos: c.fotos.map(f => f.dataUrl) });
    const id = nuevoId();
    await api(`/api/registros/${id}`, { fotos: c.fotos, thumb: c.thumb, analisis: r, estado: 'borrador' }, 'PUT');
    Object.assign(c, { estado: 'lista', id, titulo: r.propuesta?.titulo || '' });
  } catch (e) {
    Object.assign(c, { estado: 'error', error: `No se pudo armar: ${e.message}` });
  }
  pintarCola();
}

/** De a uno, en orden. Lo que se sume mientras corre entra en la misma vuelta. */
async function correrCola() {
  if (colaCorriendo) return;
  colaCorriendo = true;
  for (const c of cola) if (c.estado === 'error') c.estado = 'pendiente';
  pintarCola();
  try {
    for (let c = cola.find(x => x.estado === 'pendiente'); c; c = cola.find(x => x.estado === 'pendiente')) await armarDeCola(c);
  } finally {
    colaCorriendo = false;
    pintarCola();
  }
  const listas = cola.filter(c => c.estado === 'lista').length;
  const fallaron = cola.filter(c => c.estado === 'error').length;
  toast(fallaron ? `${listas} listos, ${fallaron} con error: revisalos en la cola.` : `Listos los ${listas} de la cola.`);
}

async function abrirDeCola(c) {
  if (await abrirRegistro(c.id)) c.visto = true;
  pintarCola();
}

$('cola-sumar').addEventListener('click', sumarACola);
$('cola-armar').addEventListener('click', correrCola);
$('cola-vaciar').addEventListener('click', vaciarCola);
$('cola-siguiente').addEventListener('click', () => { const c = sigueEnCola(); if (c) abrirDeCola(c); });

/** La miniatura del historial sale de la portada. */
const miniatura = () => escalar(estado.fotos[0].dataUrl, LADO_THUMB, 0.7).then(m => ({ thumb: m.dataUrl })).catch(() => ({}));

function opcion(valor, texto, elegida) {
  const o = document.createElement('option');
  o.value = valor;
  o.textContent = texto;
  if (elegida) o.selected = true;
  return o;
}

/**
 * Llena la revisión. `guardada` es lo que se había editado (al retomar un
 * borrador); sin eso, se usa lo que propuso la IA.
 */
function mostrarRevision(r, guardada) {
  const p = guardada || r.propuesta;
  $('titulo').value = p.titulo || '';
  $('condicion').value = p.condicion || 'usado';
  $('precio').value = miles(p.precio);
  $('descripcion').value = p.descripcion || '';
  $('nota').value = p.nota || '';
  $('grupo-nota').querySelector('small').textContent = p.nota ? 'tiene una nota' : 'no se publica';
  $('garantia').value = p.garantia || '';
  $('envio').value = p.envio ?? 'retiro';
  $('cantidad').value = p.cantidad || 1;
  $('costo').value = montoTexto(p.costo);
  $('costo-envio').value = montoTexto(p.costoEnvio);
  avisarMontos();
  $('comision-manual').value = p.comisionManual || '';
  for (const [k, id] of Object.entries(CAMPOS_PAQUETE)) $(id).value = p.paquete?.[k] ?? '';
  $('envio-gratis').checked = !!p.envioGratis;
  $('retiro-tambien').checked = !!p.retiroTambien;

  const categoria = guardada?.categoriaDatos || r.categoria;
  const categorias = r.categorias.some(c => c.id === categoria.id)
    ? r.categorias : [{ id: categoria.id, nombre: categoria.nombre }, ...r.categorias];
  $('categoria').replaceChildren(...categorias.map(c => opcion(c.id, c.nombre, c.id === categoria.id)));
  dibujarCategoria(categoria, guardada?.atributos || r.atributos, p.tipoPublicacion);

  dibujarPrecio(r.precio);
  dibujarIA(r.identificacion);

  dibujarFotosRevision();

  $('resultado-revision').hidden = true;
  marcarGuardado('');
  for (const g of document.querySelectorAll('.grupo')) g.open = false;
  resumirVenta();
  actualizarChecklist();
  marcarPropuesta();
  marcarProlijar();
  marcarChips();
  marcarMedidas();
  pintarCierre();
  pintarCola();
  pantalla('revision');
}

/* ---------- título prolijo ---------- */

/** Saca emojis, espacios dobles y signos repetidos; si está todo en mayúsculas, lo pasa a Título Normal. */
function prolijar(texto) {
  let s = String(texto).replace(/[\p{Extended_Pictographic}️‍]/gu, '')
    .replace(/([!?¡¿.,*\-_~])\1+/g, '$1')
    .replace(/\s+/g, ' ').trim();
  const letras = s.replace(/[^\p{L}]/gu, '');
  if (letras.length > 3 && letras === letras.toUpperCase()) {
    s = s.toLowerCase().replace(/(^|[\s(/-])(\p{L})/gu, (_, antes, letra) => antes + letra.toUpperCase());
  }
  return s;
}
function marcarProlijar() {
  const t = $('titulo').value;
  $('prolijar').hidden = !t.trim() || prolijar(t) === t.trim();
}

/* ---------- marca y modelo que faltan en el título ---------- */

// "Black+Decker", "Black & Decker" y "black and decker" son lo mismo.
const compacto = t => sinAcentos(t).replace(/[+&]/g, ' ').replace(/\b(and|y)\b/g, ' ').replace(/[^a-z0-9ñ]/g, '');
const SIN_MARCA = /^(gen[eé]rica?|sin marca|no|ninguna?|n\/a|-)$/i;

/** Lo que la IA vio (marca, modelo) y no está en el título: un toque lo agrega al final. */
function marcarChips() {
  const caja = $('titulo-chips');
  const id = estado.analisis?.identificacion || {};
  const titulo = compacto($('titulo').value);
  const faltan = [...new Set([id.marca, id.modelo].map(v => String(v || '').trim())
    .filter(v => v.length > 1 && !SIN_MARCA.test(v) && !titulo.includes(compacto(v))))];
  caja.hidden = !faltan.length;
  caja.replaceChildren(...faltan.map(v => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'filtro chip-titulo';
    b.textContent = `+ ${v}`;
    b.title = 'Agregar al título';
    b.onclick = () => {
      const max = estado.categoria?.maxTitulo || 60;
      const nuevo = `${$('titulo').value.trim()} ${v}`.trim();
      if (nuevo.length > max) { toast(`No entra: el título tiene un máximo de ${max} caracteres.`); return; }
      $('titulo').value = nuevo;
      $('titulo').dispatchEvent(new Event('input', { bubbles: true }));
    };
    return b;
  }));
}

/* ---------- medidas en la descripción ---------- */

const MEDIDAS = [['HEIGHT', 'alto'], ['WIDTH', 'ancho'], ['LENGTH', 'largo'], ['DEPTH', 'profundidad'], ['DIAMETER', 'diámetro'], ['WEIGHT', 'peso']];

/** Las medidas cargadas en los datos, en una línea para la descripción ('' si no hay). */
function lineaMedidas() {
  const valores = new Map([...$('paso-revision').querySelectorAll('[data-id]')].map(c => [c.dataset.id, c.value.trim()]));
  const partes = [];
  for (const [id, nombre] of MEDIDAS) {
    const a = estado.atributos.find(x => x.id === id || x.id.endsWith(`_${id}`));
    const v = a && valores.get(a.id);
    if (v) partes.push(`${nombre} ${conUnidad(a, v)}`);
  }
  return partes.length ? `Medidas: ${partes.join(', ')}.` : '';
}
function marcarMedidas() {
  $('agregar-medidas').hidden = !lineaMedidas() || /\bmedidas:/i.test($('descripcion').value);
}
$('agregar-medidas').addEventListener('click', () => {
  const d = $('descripcion');
  d.value = `${d.value.trimEnd()}\n\n${lineaMedidas()}`.trim();
  d.dispatchEvent(new Event('input', { bubbles: true }));
});
$('prolijar').addEventListener('click', () => {
  $('titulo').value = prolijar($('titulo').value);
  $('titulo').dispatchEvent(new Event('input', { bubbles: true }));
  $('titulo').focus();
});

/* Foto grande arriba; las miniaturas la cambian (solo si hay más de una) y el "+" suma otra. */
function dibujarFotosRevision(vista = 0) {
  const minis = (estado.fotos.length > 1 ? estado.fotos : []).map((f, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mini';
    b.setAttribute('aria-label', `Ver foto ${i + 1}`);
    const img = document.createElement('img');
    img.src = f.dataUrl;
    img.alt = '';
    b.append(img);
    b.onclick = () => elegirFoto(i);
    return b;
  });
  if (estado.fotos.length < MAX_FOTOS) {
    const mas = document.createElement('button');
    mas.type = 'button';
    mas.className = 'mini mas';
    mas.textContent = '+';
    mas.title = 'Agregar otra foto';
    mas.setAttribute('aria-label', 'Agregar otra foto');
    mas.onclick = () => $('galeria-rev').click();
    minis.push(mas);
  }
  $('fotos-revision').replaceChildren(...minis);
  const cuenta = document.createElement('span');
  cuenta.className = 'fotos-cuenta';
  cuenta.textContent = `${estado.fotos.length}/${MAX_FOTOS}`;
  cuenta.title = 'Fotos de la publicación';
  $('fotos-revision').append(cuenta);
  elegirFoto(Math.max(0, Math.min(vista, estado.fotos.length - 1)));
}

/**
 * Las fotos cambiaron de orden, se editaron, se sacaron o se sumaron: se redibuja
 * donde se estén viendo y, en la revisión, se guarda (con la miniatura si cambió la portada).
 */
async function fotosCambiaron({ portada = false } = {}) {
  dibujarFotos();
  if ($('paso-revision').hidden) return;
  dibujarFotosRevision(estado.fotoVista || 0);
  tocado();
  guardar({ fotos: estado.fotos, ...(portada && estado.fotos.length ? await miniatura() : {}) });
}

$('editar-foto').addEventListener('click', () => abrirEditor(estado.fotoVista || 0));
$('galeria-rev').addEventListener('change', async e => {
  const archivos = [...e.target.files];
  e.target.value = '';
  await agregarFotos(archivos);
  if (!$('aviso-inicio').hidden) toast($('aviso-inicio').textContent);
  fotosCambiaron();
});

function elegirFoto(i) {
  estado.fotoVista = i;
  $('foto-grande').src = estado.fotos[i]?.dataUrl || '';
  for (const [j, b] of [...$('fotos-revision').children].entries()) b.classList.toggle('activa', j === i);
  $('usar-portada').hidden = !(i > 0);
}

/* La que se está mirando pasa a ser la portada (primera foto de la publicación). */
$('usar-portada').addEventListener('click', async () => {
  hacerPortada(estado.fotoVista);
  dibujarFotosRevision();
  tocado();
  toast('Listo, esa es la portada ahora.');
  await guardar({ fotos: estado.fotos, ...(await miniatura()) });
});

/* Si se editó el título o la descripción, se puede volver a lo que propuso la IA. */
function marcarPropuesta() {
  const p = estado.analisis?.propuesta || {};
  for (const b of document.querySelectorAll('.volver-ia')) b.hidden = $(b.dataset.campo).value === (p[b.dataset.campo] || '');
}
for (const b of document.querySelectorAll('.volver-ia')) {
  b.addEventListener('click', e => {
    e.preventDefault();
    const el = $(b.dataset.campo);
    el.value = estado.analisis?.propuesta?.[b.dataset.campo] || '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
  });
}

/** Lo que se ve con el grupo "Envío y venta" cerrado. */
function resumirVenta() {
  const envio = { retiro: 'Retiro en persona', me2: 'Mercado Envíos' }[$('envio').value] || 'Envío de la cuenta';
  const tipo = $('tipo').selectedOptions[0]?.textContent || '';
  $('resumen-venta').textContent = `${envio} · ${$('cantidad').value || 1} u. · ${tipo}`;
  pintarPaquete();
}

/* ---------- envío: peso y medidas del paquete ---------- */


const CAMPOS_PAQUETE = { pesoG: 'paq-peso', largoCm: 'paq-largo', anchoCm: 'paq-ancho', altoCm: 'paq-alto' };
const leerPaqueteApp = () => Object.fromEntries(Object.entries(CAMPOS_PAQUETE).map(([k, id]) => [k, $(id).value.trim()]));
const validacionPaquete = () => validarPaquete(leerPaqueteApp());
const paqueteCompleto = () => validacionPaquete().ok;

/** Las medidas del producto que ya están cargadas en los datos, convertidas a g y cm. */
function medidasDelProducto() {
  const valores = new Map([...$('paso-revision').querySelectorAll('[data-id]')].map(c => [c.dataset.id, c.value.trim()]));
  const dato = id => { const a = estado.atributos.find(x => x.id === id); return a && valores.get(id) ? conUnidad(a, valores.get(id)) : ''; };
  return {
    pesoG: aGramos(dato('WEIGHT')),
    altoCm: aCentimetros(dato('HEIGHT')),
    anchoCm: aCentimetros(dato('WIDTH')),
    largoCm: aCentimetros(dato('LENGTH') || dato('DEPTH'))
  };
}

function pintarPaquete() {
  const envio = $('envio').value;
  $('bloque-paquete').hidden = envio === 'retiro';
  $('paq-opciones').hidden = envio !== 'me2';
  const m = medidasDelProducto();
  $('paq-copiar').hidden = envio === 'retiro' || !Object.entries(m).some(([k, v]) => v && !$(CAMPOS_PAQUETE[k]).value.trim());
  // Se avisa apenas escribió algo que no pasa la cordura (no antes: vacío es "todavía no cargó").
  const escribio = Object.values(leerPaqueteApp()).some(v => v !== '');
  const v = validacionPaquete();
  $('paq-error').hidden = envio === 'retiro' || !escribio || v.ok;
  $('paq-error').textContent = v.errores.join(' ');
}
$('paq-copiar').addEventListener('click', () => {
  const m = medidasDelProducto();
  for (const [k, id] of Object.entries(CAMPOS_PAQUETE)) if (m[k] && !$(id).value.trim()) $(id).value = String(m[k]);
  $('paq-peso').dispatchEvent(new Event('input', { bubbles: true }));
});

/* ---------- precio destacado ---------- */

function dibujarPrecio(pr) {
  estado.rango = pr;
  $('precio-fuente').textContent = pr.fuente === 'mercadolibre'
    ? `Mediana de ${pr.muestras} publicaciones parecidas en MercadoLibre.`
    : 'Estimado por la IA a partir de las fotos. Conviene comparar con publicaciones parecidas.';
  const botones = { min: `Mínimo ${pesos(pr.min)}`, sugerido: `Sugerido ${pesos(pr.valor)}`, max: `Máximo ${pesos(pr.max)}` };
  for (const b of document.querySelectorAll('.rango-btn')) b.textContent = botones[b.dataset.precio];
  $('precio-rango').hidden = !(pr.min > 0 && pr.max > pr.min);
  dibujarParecidos(pr.parecidos || []);
  marcarPrecio();
}

/** Hasta 5 publicaciones parecidas (las más cercanas al sugerido) para comparar a ojo. */
function dibujarParecidos(lista) {
  $('parecidos').hidden = !lista.length;
  $('parecidos-n').textContent = lista.length ? String(lista.length) : '';
  $('parecidos-lista').replaceChildren(...lista.map(p => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = p.permalink;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = p.titulo;
    const precio = document.createElement('strong');
    precio.textContent = pesos(p.precio);
    li.append(a, precio);
    return li;
  }));
}

/** Ubica el precio actual en la barra de mínimo a máximo y marca el botón que coincide. */
function marcarPrecio() {
  const pr = estado.rango;
  if (!pr || !(pr.max > pr.min)) return;
  const v = precioActual();
  const pct = Math.max(0, Math.min(100, ((v - pr.min) / (pr.max - pr.min)) * 100));
  $('rango-marca').style.left = `${pct}%`;
  $('rango-relleno').style.width = `${pct}%`;
  const valores = { min: pr.min, sugerido: pr.valor, max: pr.max };
  for (const b of document.querySelectorAll('.rango-btn')) b.classList.toggle('activo', valores[b.dataset.precio] === v);
  // En palabras: dónde cae frente a lo que se pide en MercadoLibre.
  const donde = v < pr.min ? 'bajo' : v > pr.max ? 'alto' : 'rango';
  const pos = $('precio-posicion');
  pos.hidden = !v;
  pos.dataset.donde = donde;
  pos.textContent = {
    bajo: 'Por debajo de lo que se pide: se vende rápido, pero quizá regalado.',
    rango: 'Dentro de lo que se pide por cosas parecidas.',
    alto: 'Por encima de lo que se pide: puede tardar en venderse.'
  }[donde];
}

for (const b of document.querySelectorAll('.rango-btn')) {
  b.addEventListener('click', () => {
    const pr = estado.rango;
    $('precio').value = miles({ min: pr.min, sugerido: pr.valor, max: pr.max }[b.dataset.precio]);
    $('precio').dispatchEvent(new Event('input', { bubbles: true }));
  });
}
/* −5 %, +5 % y Redondear: ajustes rápidos sobre lo que ya está escrito. */
function redondear(v) {
  const paso = v >= 100000 ? 1000 : v >= 10000 ? 500 : v >= 1000 ? 100 : 10;
  return Math.max(paso, Math.round(v / paso) * paso);
}
for (const b of document.querySelectorAll('.ajuste-btn')) {
  b.addEventListener('click', () => {
    const v = precioActual();
    if (!v) return;
    const a = b.dataset.ajuste;
    const nuevo = a === 'redondear' ? redondear(v) : Math.round(v * (1 + Number(a) / 100));
    $('precio').value = miles(nuevo);
    $('precio').dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/* El precio se ve con puntos de miles ("380.000") pero por dentro es un número. */
const precioActual = () => Number(String($('precio').value).replace(/\D/g, '')) || 0;
const miles = n => (Number(n) > 0 ? Math.round(Number(n)).toLocaleString('es-AR') : '');

$('precio').addEventListener('input', () => {
  const el = $('precio');
  const desdeElFinal = el.value.length - (el.selectionStart ?? el.value.length);
  el.value = miles(precioActual());
  // El cursor queda a la misma distancia del final, así no salta al tipear en el medio.
  const pos = Math.max(0, el.value.length - desdeElFinal);
  try { el.setSelectionRange(pos, pos); } catch {}
  marcarPrecio();
});
/* ---------- costos y ganancia ---------- */

/* >>> compartido
   Funciones puras: son las mismas de worker/logica.js. La app no importa del Worker, así que viven
   las dos, y `node test.mjs` carga este bloque tal cual y les corre los mismos casos a ambas.
   Nada de DOM ni de estado acá adentro. */
const positivo = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };

function calcularGanancia({ precio, comision, envio, costo }) {
  const p = positivo(precio);
  if (!p) return null;
  const c = Math.min(positivo(comision), p);
  const e = positivo(envio);
  const k = positivo(costo);
  const neto = p - c - e;
  return { precio: p, comision: c, envio: e, costo: k, neto, ganancia: neto - k,
    margen: Math.round(((neto - k) / p) * 1000) / 10, comisionPct: Math.round((c / p) * 1000) / 10 };
}

/** El precio más bajo (a la centena, o al millar arriba de $50.000) con el que la ganancia no es negativa. Siempre redondea hacia arriba. */
function precioDeEquilibrio({ costo, envio, pct, fijo }) {
  const k = positivo(costo) + positivo(envio) + positivo(fijo);
  const f = positivo(pct) / 100;
  if (!k || f >= 1) return 0;
  const v = k / (1 - f);
  const paso = v >= 50000 ? 1000 : 100;
  return Math.ceil(v / paso - 1e-9) * paso;
}

/* Topes de cordura para detectar errores de tipeo (1500 vs 1.5 vs 1e9). NO son reglas de MercadoLibre. */
const MAX_PESO_G = 100000;   // 100 kg
const MAX_MEDIDA_CM = 300;
const MAX_MONTO = 1e9;

/**
 * Un número escrito a la argentina: coma decimal y punto de miles ("1.250,50", "99,90", "1.500"), o punto
 * decimal ("1234.56"). Cualquier otra cosa (letras, notación científica, hexa, signo +, separadores
 * mezclados) es NaN: nunca se adivina. "1.500" es mil quinientos; "1.5", uno coma cinco.
 */
function parsearNumero(texto) {
  const t = String(texto ?? '').trim();
  let m;
  if ((m = /^(-?)(\d{1,3}(?:\.\d{3})+)(?:,(\d+))?$/.exec(t))) return Number(`${m[1]}${m[2].replace(/\./g, '')}${m[3] ? `.${m[3]}` : ''}`);
  if ((m = /^(-?)(\d+)(?:,(\d+))?$/.exec(t))) return Number(`${m[1]}${m[2]}${m[3] ? `.${m[3]}` : ''}`);
  if ((m = /^(-?)(\d+\.\d+)$/.exec(t))) return Number(m[1] + m[2]);
  return NaN;
}

/** Un monto en pesos escrito a mano. Vacío = 0 sin error; negativo, ilegible o enorme = error (valor 0). */
function parsearMonto(texto) {
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
function validarPaquete(paquete) {
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
function aCentimetros(texto) {
  const m = /^\s*([\d.,]+)\s*(mm|cm|m|"|in|pulgadas?)?\s*$/i.exec(String(texto ?? ''));
  const n = m ? parsearNumero(m[1]) : NaN;
  if (!(n > 0)) return null;
  const u = (m[2] || 'cm').toLowerCase();
  const cm = u === 'mm' ? n / 10 : u === 'm' ? n * 100 : /^(in|"|pulgada)/.test(u) ? n * 2.54 : n;
  return Math.max(1, Math.round(cm));
}

/** "800 g", "1,5 kg", "2 lb" o "800" (sin unidad = g) → gramos enteros; null si no se entiende. */
function aGramos(texto) {
  const m = /^\s*([\d.,]+)\s*(mg|g|kg|lb|oz)?\s*$/i.exec(String(texto ?? ''));
  const n = m ? parsearNumero(m[1]) : NaN;
  if (!(n > 0)) return null;
  const u = (m[2] || 'g').toLowerCase();
  const g = u === 'mg' ? n / 1000 : u === 'kg' ? n * 1000 : u === 'lb' ? n * 453.592 : u === 'oz' ? n * 28.3495 : n;
  return Math.max(1, Math.round(g));
}

/**
 * Cambiar de registro sin perder lo editado: corta el autoguardado, guarda lo pendiente (si no se
 * puede, NO cambia y devuelve false), limpia el estado de guardado del registro viejo y recién
 * ahí abre el nuevo. Devuelve lo que devuelve `abrir` (true si quedó abierto).
 */
async function cambiarDeRegistro({ hayPendiente, cancelarAutoguardado, guardar, limpiar, abrir }) {
  cancelarAutoguardado();
  if (hayPendiente() && !(await guardar())) return false;
  limpiar();
  return abrir();
}

/**
 * La comisión de MercadoLibre para este precio y tipo de publicación. Nunca asume $0 por falta de dato.
 *  - fuente 'ml': la informó MercadoLibre (exacta si se consultó ese mismo precio; si no, por porcentaje + fijo).
 *  - fuente 'manual': la cargó Nico a mano, en %.
 *  - fuente 'ninguna': no hay dato confiable. motivo: 'sin-tipo' (MercadoLibre contestó pero no ese tipo),
 *    'sin-dato' (no contestó) o 'actualizando' (todavía se está consultando para este precio).
 */
function resolverComision({ tipos, disponible, tipoId, precio, precioConsultado, manualPct }) {
  const texto = String(manualPct ?? '').trim().replace(',', '.');
  const manual = texto === '' ? NaN : Number(texto);
  const hayManual = Number.isFinite(manual) && manual >= 0 && manual < 100;
  const t = disponible ? (tipos || []).find(x => x.id === tipoId) : null;
  if (t) {
    if (precioConsultado === precio) return { fuente: 'ml', monto: t.comision, pct: t.pct, fijo: t.fijo };
    if (t.pct != null && t.fijo != null) return { fuente: 'ml', monto: precio * t.pct / 100 + t.fijo, pct: t.pct, fijo: t.fijo };
    return { fuente: 'ninguna', motivo: 'actualizando' };
  }
  if (hayManual) return { fuente: 'manual', monto: precio * manual / 100, pct: manual, fijo: 0 };
  return { fuente: 'ninguna', motivo: disponible === null ? 'actualizando' : disponible ? 'sin-tipo' : 'sin-dato' };
}
/** Envuelve una función async: mientras corre, las llamadas repetidas (doble toque) se ignoran. Si falla, suelta el candado. */
function unaALaVez(fn) {
  let corriendo = false;
  return async (...args) => {
    if (corriendo) return undefined;
    corriendo = true;
    try { return await fn(...args); } finally { corriendo = false; }
  };
}

/** Cuántos productos de la cola se perderían al cerrar o recargar la pestaña: todo lo que todavía no quedó como borrador guardado. */
function colaPorPerder(cola) {
  return (cola || []).filter(c => c.estado !== 'lista').length;
}
/* <<< compartido */

/* Lo que cobra MercadoLibre por tipo de publicación, para el precio y la categoría de la última consulta. */
const comisiones = { clave: '', precio: 0, tipos: [], disponible: null, motivo: '' };
let comisionesTimer;

/** Pide la comisión al Worker (con una pausa, para no consultar en cada tecla). */
function pedirComisiones() {
  clearTimeout(comisionesTimer);
  comisionesTimer = setTimeout(async () => {
    const precio = precioActual();
    const categoria = $('categoria').value;
    if (!precio || !categoria) return;
    const clave = `${categoria}|${precio}`;
    if (comisiones.clave === clave) return;
    try {
      const r = await api(`/api/comision?categoria=${encodeURIComponent(categoria)}&precio=${precio}`);
      Object.assign(comisiones, { clave, precio, tipos: r.tipos || [], disponible: !!r.disponible, motivo: r.motivo || '' });
    } catch (e) {
      Object.assign(comisiones, { clave: '', precio: 0, tipos: [], disponible: false, motivo: e.message });
    }
    pintarGanancia();
  }, 600);
}

function pintarGanancia() {
  if ($('paso-revision').hidden && !estado.analisis) return;
  const precio = precioActual();
  const retiro = $('envio').value === 'retiro';
  const costo = valorDinero('costo');
  const envio = retiro ? 0 : valorDinero('costo-envio');
  $('campo-costo-envio').hidden = retiro;
  const tipoNombre = $('tipo').selectedOptions[0]?.textContent || 'este tipo de publicación';
  const com = resolverComision({ tipos: comisiones.tipos, disponible: comisiones.disponible, tipoId: $('tipo').value,
    precio, precioConsultado: comisiones.precio, manualPct: $('comision-manual').value });
  // La comisión nunca se asume en $0: si MercadoLibre no la informó, se pide a mano.
  $('campo-comision-manual').hidden = !(com.fuente === 'manual' || (com.fuente === 'ninguna' && com.motivo !== 'actualizando'));
  $('ganancia-fuente').textContent = com.fuente === 'ml'
    ? `Comisión que informa MercadoLibre${com.pct != null ? ` (${com.pct} %${com.fijo ? ` + ${pesos(com.fijo)}` : ''})` : ''}.`
    : com.fuente === 'manual' ? 'Comisión cargada a mano: es una estimación tuya, no la de MercadoLibre.'
    : com.motivo === 'sin-tipo' ? `MercadoLibre no informó la comisión de «${tipoNombre}» para esta categoría. Cargala a mano para ver cuánto te queda.`
    : com.motivo === 'sin-dato' ? `No pude traer la comisión (${comisiones.motivo || 'sin datos'}). Cargala a mano para ver cuánto te queda.`
    : 'Consultando la comisión…';
  const g = precio && com.fuente !== 'ninguna' ? calcularGanancia({ precio, comision: com.monto, envio, costo }) : null;
  const caja = $('ganancia');
  caja.hidden = !g;
  $('ganancia-equilibrio').hidden = true;
  if (!g) { $('resumen-ganancia').textContent = com.fuente === 'ninguna' && com.motivo !== 'actualizando' ? 'falta la comisión' : costo ? 'calculando…' : 'cargá lo que te costó'; return; }
  $('g-precio').textContent = pesos(g.precio);
  $('g-comision-t').textContent = `Comisión${com.pct != null ? ` (${com.pct} %)` : ''}`;
  $('g-comision').textContent = `− ${pesos(g.comision)}`;
  $('g-envio-fila').hidden = !g.envio;
  $('g-envio').textContent = `− ${pesos(g.envio)}`;
  $('g-costo').textContent = g.costo ? `− ${pesos(g.costo)}` : '—';
  const total = caja.querySelector('.total dt');
  total.textContent = g.costo ? `Te queda (${g.margen} %)` : 'Te acreditan';
  $('g-ganancia').textContent = pesos(g.costo ? g.ganancia : g.neto);
  caja.dataset.signo = !g.costo ? '' : g.ganancia > 0 ? 'mas' : g.ganancia < 0 ? 'menos' : '';
  $('resumen-ganancia').textContent = g.costo ? `te quedan ${pesos(g.ganancia)}` : `te acreditan ${pesos(g.neto)}`;
  if (g.costo && g.ganancia < 0) {
    const eq = precioDeEquilibrio({ costo: g.costo, envio: g.envio, pct: com.pct, fijo: com.fijo });
    $('ganancia-equilibrio').hidden = !eq;
    $('ganancia-equilibrio').textContent = `Con este precio perdés plata. Para no perder tendrías que cobrar al menos ${pesos(eq)}.`;
  }
}

/* Los montos se tipean a la argentina ("12.500", "99,90", "1.250,50"). Si el texto no se entiende o es
   negativo se avisa debajo del campo y vale 0: no se adivina. */
function montoDe(id) { return parsearMonto($(id).value); }
const valorDinero = id => montoDe(id).valor;
/** Un monto para mostrar: entero con puntos de miles; con centavos solo si los tiene. */
const montoTexto = v => (Number(v) > 0 ? Number(v).toLocaleString('es-AR', { maximumFractionDigits: 2 }) : '');
function avisarMontos() {
  const errores = ['costo', 'costo-envio'].map(id => montoDe(id).error).filter(Boolean);
  $('costo-error').hidden = !errores.length;
  $('costo-error').textContent = errores[0] || '';
}
for (const id of ['costo', 'costo-envio']) {
  $(id).addEventListener('input', () => {
    // Solo se agrupan los miles mientras es un entero pelado; con coma o puntos ya escritos se respeta lo tipeado.
    if (/^\d+$/.test($(id).value.trim())) $(id).value = miles($(id).value.trim());
    avisarMontos();
  });
}

/* ---------- lo que vio la IA (columna derecha) ---------- */

const CONFIANZA = { alta: { pct: 90, txt: 'Alta' }, media: { pct: 60, txt: 'Media' }, baja: { pct: 30, txt: 'Baja' } };

function dibujarIA(id) {
  $('ia-producto').textContent = id.producto || '';
  const c = CONFIANZA[id.confianza] || CONFIANZA.media;
  $('confianza-valor').textContent = c.txt;
  $('confianza-relleno').style.width = `${c.pct}%`;
  $('confianza-relleno').className = `nivel-${id.confianza || 'media'}`;
  $('ia-estado').textContent = id.estado_detalle || '';
  const consejos = id.advertencias || [];
  $('ia-consejos').replaceChildren(...consejos.map(t => { const li = document.createElement('li'); li.textContent = t; return li; }));
  $('ia-consejos-titulo').hidden = !consejos.length;
}

/*
 * MercadoLibre rechaza un número suelto en los datos con unidad ("Alto 200":
 * "The provided unit is not valid"). Si el valor es solo un número, se le agrega
 * la unidad más razonable de las que acepta el atributo (cm, kg, W…).
 */
const UNIDADES_PREFERIDAS = ['cm', 'kg', 'W', 'V', 'L', 'ml', 'g', 'mm', 'm'];

function conUnidad(a, texto) {
  const t = String(texto ?? '').trim();
  if (a.tipo !== 'number_unit' || !a.unidades?.length || !/^\d+([.,]\d+)?$/.test(t)) return t;
  const unidad = UNIDADES_PREFERIDAS.find(u => a.unidades.includes(u)) || a.unidades[0];
  return `${t.replace(',', '.')} ${unidad}`;
}

function campoAtributo(a) {
  const l = document.createElement('label');
  l.className = `campo${a.requerido ? ' requerido' : ''}`;
  const n = document.createElement('span');
  n.className = 'nombre';
  n.textContent = a.nombre;
  let control;
  if (a.opciones.length) {
    control = document.createElement('select');
    control.append(opcion('', '—', !a.valor));
    const enLista = a.opciones.some(o => o.nombre === a.valor);
    if (a.valor && !enLista) control.append(opcion(a.valor, a.valor, true));
    control.append(...a.opciones.map(o => opcion(o.nombre, o.nombre, o.nombre === a.valor)));
  } else {
    control = document.createElement('input');
    control.type = 'text';
    control.value = a.valor || '';
    if (a.unidades.length) control.placeholder = `Ej.: 10 ${a.unidades[0]}`;
  }
  control.dataset.id = a.id;
  // Al salir del campo, un número suelto queda con su unidad ("200" → "200 cm").
  if (a.tipo === 'number_unit') control.addEventListener('change', () => { control.value = conUnidad(a, control.value); });
  l.append(n, control);
  return l;
}

/** A la vista solo lo obligatorio; lo opcional, plegado en "Más datos". */
/*
 * Lo mismo que aplicarDefaults del Worker, para los borradores analizados antes
 * del 22/10/2026: ahí el código de barras venía como obligatorio y los
 * impuestos vacíos. Si ya vienen bien, no cambia nada.
 */
const POR_DEFECTO = { MODEL: 'NA', VALUE_ADDED_TAX: 'Exento', IMPORT_DUTY: '0 %' };

function normalizarAtributos(atributos) {
  return atributos.map(a => {
    if (a.id === 'GTIN') return { ...a, requerido: false, nombre: 'Código de barras (solo si tiene)' };
    const defecto = POR_DEFECTO[a.id];
    if (!defecto || String(a.valor ?? '').trim()) return a;
    const enLista = !a.opciones?.length || a.opciones.some(o => o.nombre === defecto);
    return enLista ? { ...a, valor: defecto } : a;
  });
}

function dibujarCategoria(categoria, atributosCrudos, tipoElegido) {
  const atributos = normalizarAtributos(atributosCrudos);
  estado.atributos = atributos;
  estado.categoria = categoria;
  actualizarContador();

  const tipos = categoria.tiposPublicacion?.length ? categoria.tiposPublicacion : [{ id: 'gold_special', nombre: 'Clásica' }];
  const elegido = tipos.some(t => t.id === tipoElegido) ? tipoElegido : tipos[0].id;
  $('tipo').replaceChildren(...tipos.map(t => opcion(t.id, t.nombre, t.id === elegido)));

  // A la vista solo lo obligatorio que quedó vacío; el resto, en "Más datos".
  const faltan = atributos.filter(a => a.requerido && !String(a.valor ?? '').trim());
  const listos = atributos.filter(a => a.requerido && String(a.valor ?? '').trim());
  const opcionales = atributos.filter(a => !a.requerido);
  $('atributos').replaceChildren(...faltan.map(campoAtributo));
  $('atributos-listos').replaceChildren(...listos.map(campoAtributo));
  $('atributos-opcionales').replaceChildren(...opcionales.map(campoAtributo));
  $('bloque-requeridos').hidden = !faltan.length;
  $('bloque-listos').hidden = !listos.length;
  $('bloque-opcionales').hidden = !opcionales.length;
  $('resumen-listos').textContent = `${listos.length} ✓`;
  $('resumen-opcionales').textContent = `${opcionales.filter(a => String(a.valor ?? '').trim()).length} de ${opcionales.length}`;
  resumirVenta();
  actualizarChecklist();
  pedirComisiones();
  pintarGanancia();
}

$('categoria').addEventListener('change', async () => {
  esperar('Trayendo la ficha de esa categoría…');
  try {
    const r = await api('/api/categoria', { categoria: $('categoria').value, identificacion: estado.analisis.identificacion });
    dibujarCategoria(r.categoria, r.atributos, $('tipo').value);
    programarGuardado();
  } catch (e) {
    toast(`No se pudo cambiar la categoría: ${e.message}`);
    $('categoria').value = estado.categoria.id;
  } finally {
    esperar('');
  }
});

function actualizarContador() {
  const max = estado.categoria?.maxTitulo || 60;
  const n = $('titulo').value.trim().length;
  $('contador').textContent = `${n}/${max}`;
  $('contador').classList.toggle('pasado', n > max);
  $('contador').classList.toggle('cerca', n <= max && n >= max - 5);
}
$('titulo').addEventListener('input', actualizarContador);

/* ---------- listo para publicar ---------- */

/**
 * Lo que la app puede saber antes de preguntarle a MercadoLibre: fotos, título,
 * categoría, precio y los datos obligatorios. Devuelve los pendientes, cada uno
 * con el elemento al que hay que ir a completarlo.
 */
function pendientes() {
  const max = estado.categoria?.maxTitulo || 60;
  const titulo = $('titulo').value.trim();
  const faltan = [...$('paso-revision').querySelectorAll('.campo.requerido [data-id]')].filter(c => !c.value.trim());
  const items = [
    { ok: estado.fotos.length > 0, texto: `${estado.fotos.length || 'Sin'} foto${estado.fotos.length === 1 ? '' : 's'}` },
    { ok: !!titulo && titulo.length <= max, texto: titulo.length > max ? `Título largo (${titulo.length}/${max})` : 'Título', el: $('titulo') },
    { ok: !!$('categoria').value, texto: 'Categoría', el: $('categoria') },
    { ok: precioActual() > 0, texto: precioActual() > 0 ? `Precio $ ${miles(precioActual())}` : 'Precio', el: $('precio') },
    { ok: !faltan.length, texto: faltan.length ? `Falta${faltan.length > 1 ? 'n' : ''} ${faltan.length} dato${faltan.length > 1 ? 's' : ''} obligatorio${faltan.length > 1 ? 's' : ''}` : 'Datos obligatorios', el: faltan[0] }
  ];
  // Mercado Envíos calcula el costo con el peso y las medidas: sin ellos no se puede publicar así.
  if ($('envio').value === 'me2') { const v = validacionPaquete(); items.push({ ok: v.ok, texto: v.ok ? 'Peso y medidas del paquete' : `Paquete: ${v.errores[0]}`, el: $('paq-peso') }); }
  // MercadoLibre rechaza los datos de contacto: se avisa antes y frena el Publicar.
  for (const [id, donde] of [['titulo', 'del título'], ['descripcion', 'de la descripción']]) {
    const que = contacto($(id).value);
    if (que) items.push({ ok: false, texto: `Sacá ${que} ${donde}`, el: $(id) });
  }
  // Las palabras de promoción en el título no frenan, pero MercadoLibre las desaconseja.
  const promo = PROMO.exec(titulo);
  if (promo) items.push({ ok: true, aviso: true, texto: `"${promo[0]}" en el título no suma`, el: $('titulo') });
  // Una descripción de una línea vende menos: se avisa, pero no frena.
  const largo = $('descripcion').value.trim().length;
  if (largo < DESCRIPCION_MINIMA) items.push({ ok: true, aviso: true, texto: `Descripción corta (${largo})`, el: $('descripcion') });
  // Con menos de tres fotos se vende menos: aviso, no frena.
  if (estado.fotos.length > 0 && estado.fotos.length < 3) items.push({ ok: true, aviso: true, texto: `Mejor 3 fotos o más (tenés ${estado.fotos.length})` });
  // Una publicada muy parecida que sigue en venta: por si es la misma cosa dos veces.
  const repetida = publicadaParecida(titulo);
  if (repetida) items.push({ ok: true, aviso: true, texto: `Ya tenés publicada una muy parecida: ${repetida}` });
  return { items, pendientes: items.filter(i => !i.ok) };
}

/** Una publicada que sigue en venta, con casi las mismas palabras en el título, que no sea este registro. */
function publicadaParecida(titulo) {
  const palabras = t => new Set(sinAcentos(t).replace(/[^a-z0-9ñ ]/g, ' ').split(/\s+/).filter(p => p.length > 2));
  const mias = palabras(titulo);
  if (mias.size < 2) return '';
  for (const r of historialVista.registros) {
    if (r.estado !== 'publicada' || r.id === estado.registroId || vendidaSegunML(r)) continue;
    const otras = palabras(r.titulo);
    let comunes = 0;
    for (const p of mias) if (otras.has(p)) comunes++;
    if (comunes / Math.max(mias.size, otras.size) >= 0.7) return r.titulo;
  }
  return '';
}

const DESCRIPCION_MINIMA = 80;
const PROMO = /env[ií]o gratis|oferta|imperdible|liquido|liquidaci[oó]n|mejor precio|promo/i;
const CONTACTO = [
  [/[\w.+-]+@[\w-]+\.[a-z]{2,}/i, 'el mail'],
  [/\bhttps?:\/\/|\bwww\.|\b[\w-]+\.(com|net|org|ar)\b/i, 'el link'],
  [/whats?app|\bwsp\b|\bwpp\b/i, 'el WhatsApp']
];

/** Qué dato de contacto hay en el texto ('' si ninguno). */
function contacto(texto) {
  for (const [re, que] of CONTACTO) if (re.test(texto)) return que;
  // Un teléfono: de 8 a 13 dígitos. Si son 12 o 13 seguidos sin separar, es un código de barras.
  const tel = (texto.match(/\+?\d[\d\s()-]{6,}\d/g) || []).some(m => {
    const n = m.replace(/\D/g, '').length;
    return n >= 8 && n <= 13 && (n < 12 || /[\s()+-]/.test(m));
  });
  return tel ? 'el teléfono' : '';
}

function actualizarChecklist() {
  if ($('paso-revision').hidden && !estado.analisis) return;
  const { items, pendientes: faltan } = pendientes();
  $('contador-desc').textContent = `${$('descripcion').value.trim().length} caracteres`;
  $('checklist').replaceChildren(...items.map(i => {
    const li = document.createElement('li');
    li.className = !i.ok ? 'pendiente' : i.aviso ? 'aviso' : 'ok';
    li.textContent = i.texto;
    return li;
  }));
  const n = faltan.length;
  $('publicar-texto').textContent = n ? `Completá ${n === 1 ? 'lo que falta' : `${n} cosas`}` : 'Publicar';
  $('publicar').classList.toggle('incompleto', n > 0);
}

/* Cualquier cambio se autoguarda (y obliga a que MercadoLibre lo revise de nuevo al publicar). */
function tocado(e) {
  actualizarChecklist();
  marcarPropuesta();
  marcarProlijar();
  marcarChips();
  marcarMedidas();
  if (e?.target?.id === 'nota') $('grupo-nota').querySelector('small').textContent = e.target.value.trim() ? 'tiene una nota' : 'no se publica';
  if (e?.target?.id === 'categoria') return; // la categoría guarda cuando llega su ficha
  if (estado.estadoReg === 'revisada') estado.estadoReg = 'borrador';
  if (['envio', 'cantidad', 'tipo'].includes(e?.target?.id)) resumirVenta();
  if (String(e?.target?.id || '').startsWith('paq-')) pintarPaquete();
  pintarGanancia();
  if (['precio', 'tipo'].includes(e?.target?.id)) pedirComisiones();
  $('resultado-revision').hidden = true;
  programarGuardado();
}
$('paso-revision').addEventListener('input', tocado);
$('paso-revision').addEventListener('change', tocado);

/* ---------- guardado ---------- */

let guardadoTimer;
let sinGuardar = false;    // hay cambios que todavía no llegaron al Worker
let extraPendiente = {};   // fotos, miniatura… de un guardado que falló: van en el próximo

function marcarGuardado(texto) {
  const el = $('guardado');
  el.replaceChildren(texto);
  if (texto === 'No se pudo guardar') el.append(' · ', botonFoto('Reintentar', 'Reintentar el guardado', 'enlace', () => guardar()));
}

function programarGuardado() {
  if (!estado.registroId) return;
  clearTimeout(guardadoTimer);
  sinGuardar = true;
  marcarGuardado('Sin guardar…');
  guardadoTimer = setTimeout(() => guardar(), ESPERA_GUARDADO);
}

/** Guarda lo editado (y lo que venga en `extra`) en el registro actual. */
async function guardar(extra = {}, { alSalir = false } = {}) {
  if (!estado.registroId) return true;
  clearTimeout(guardadoTimer);
  extraPendiente = { ...extraPendiente, ...extra };
  sinGuardar = true;
  marcarGuardado('Guardando…');
  // keepalive tiene un tope de 64 KB: con fotos no se usa.
  const keepalive = alSalir && !extraPendiente.fotos;
  try {
    await api(`/api/registros/${estado.registroId}`, { publicacion: leerPublicacion(), estado: estado.estadoReg, ...extraPendiente }, 'PUT', { keepalive });
    extraPendiente = {};
    sinGuardar = false;
    marcarGuardado('Guardado ✓');
    return true;
  } catch (e) {
    marcarGuardado('No se pudo guardar');
    console.warn('guardar:', e.message);
    return false;
  }
}

function guardarAlSalir() {
  if (sinGuardar) guardar({}, { alSalir: true });
}
addEventListener('pagehide', guardarAlSalir);
// Si el último guardado falló, el navegador pregunta antes de cerrar.
addEventListener('beforeunload', e => {
  if (sinGuardar && $('guardado').textContent.startsWith('No se pudo')) e.preventDefault();
  // La cola vive solo en esta pestaña: lo que no se armó todavía se perdería.
  if (colaPorPerder(cola)) e.preventDefault();
});

/* ---------- historial ---------- */

const ESTADOS = {
  borrador: 'Borrador', revisada: 'Revisada', publicada: 'Publicada',
  // lo que dice MercadoLibre de una publicada, cuando llega el seguimiento
  activa: 'Activa', pausada: 'Pausada', vendida: 'Vendida', finalizada: 'Finalizada', en_revision: 'En revisión'
};
const ocultos = new Set(); // borrados con "Deshacer" pendiente

async function cargarHistorial({ forzar = false } = {}) {
  if (!clave() && !DEMO) { dibujarHistorial([]); return; }
  $('refrescar-historial').classList.add('girando');
  try {
    const { registros } = await api('/api/registros');
    dibujarHistorial(registros);
    await cargarSeguimiento(registros, forzar);
  } catch (e) {
    $('historial-vacio').textContent = `No se pudo traer el historial: ${e.message}`;
    $('historial-vacio').hidden = false;
  } finally {
    $('refrescar-historial').classList.remove('girando');
  }
}

/** "actualizado hace N min" junto al botón; se refresca solo cada minuto. */
function pintarActualizado() {
  const c = historialVista.consultado;
  const el = $('historial-actualizado');
  if (!c) { el.textContent = ''; return; }
  const min = Math.round((Date.now() - new Date(c)) / 60000);
  el.textContent = min < 1 ? 'recién actualizado' : min < 60 ? `actualizado hace ${min} min` : `actualizado ${fecha(c)}`;
}
setInterval(pintarActualizado, 60000);

/** Estado real, visitas y preguntas de lo publicado. Si falla, el historial queda como estaba. */
async function cargarSeguimiento(registros, forzar) {
  if (!registros.some(r => r.estado === 'publicada')) { historialVista.seguimiento = {}; return; }
  try {
    const s = await api(`/api/seguimiento${forzar ? '?forzar=1' : ''}`);
    historialVista.seguimiento = s.registros || {};
    historialVista.consultado = s.consultado || new Date().toISOString();
    pintarActualizado();
    dibujarHistorial(historialVista.registros);
  } catch (e) {
    console.warn('seguimiento', e.message);
  }
}

/* Filtro por estado y búsqueda por título: aparecen recién cuando la lista se alarga. */
const MIN_FILTROS = 5;
const historialVista = { registros: [], filtro: '', busqueda: '', seguimiento: {}, consultado: null };
const sinAcentos = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// "Vendidas" sale del seguimiento (lo que dice MercadoLibre); "Publicadas" son las que siguen en venta.
const vendidaSegunML = r => r.estado === 'publicada' && ['vendida', 'finalizada'].includes(historialVista.seguimiento[r.id]?.estado);
const enFiltro = (r, f) => !f || (f === 'vendida' ? vendidaSegunML(r)
  : f === 'publicada' ? r.estado === 'publicada' && !vendidaSegunML(r)
  : r.estado !== 'publicada');

for (const b of document.querySelectorAll('#historial-filtros .filtro')) {
  b.addEventListener('click', () => { historialVista.filtro = b.dataset.filtro; dibujarHistorial(historialVista.registros); });
}
$('historial-buscar').addEventListener('input', e => { historialVista.busqueda = e.target.value; dibujarHistorial(historialVista.registros); });

function dibujarHistorial(registros) {
  historialVista.registros = registros;
  const todos = registros.filter(r => !ocultos.has(r.id));
  const conFiltros = todos.length >= MIN_FILTROS;
  $('historial-filtros').hidden = !conFiltros;
  const { filtro, busqueda } = conFiltros ? historialVista : { filtro: '', busqueda: '' };
  for (const b of document.querySelectorAll('#historial-filtros .filtro')) {
    b.classList.toggle('activo', b.dataset.filtro === filtro);
    b.querySelector('small').textContent = todos.filter(r => enFiltro(r, b.dataset.filtro)).length;
  }
  const buscado = sinAcentos(busqueda.trim());
  const visibles = todos.filter(r => enFiltro(r, filtro) && sinAcentos(r.titulo).includes(buscado));
  pintarTotales(todos);
  $('historial-vacio').hidden = visibles.length > 0;
  $('historial-vacio').textContent = todos.length
    ? 'No hay nada con ese filtro.'
    : 'Todavía no analizaste nada. Lo que armes queda guardado acá, aunque cierres la app.';
  $('historial-lista').replaceChildren(...visibles.map(r => {
    const li = document.createElement('li');
    li.className = 'item';
    const seg = r.estado === 'publicada' ? historialVista.seguimiento[r.id] : null;
    const abrir = document.createElement('button');
    abrir.className = 'item-abrir';
    abrir.type = 'button';
    // Una publicada abre su panel (precio, estado, preguntas); lo demás abre el borrador.
    abrir.onclick = () => (r.estado === 'publicada' ? abrirPublicacion(r) : abrirRegistro(r.id));

    const img = document.createElement('img');
    img.alt = '';
    if (r.thumb) img.src = r.thumb;
    const texto = document.createElement('div');
    texto.className = 'item-texto';
    const t = document.createElement('strong');
    t.textContent = r.titulo;
    const sub = document.createElement('span');
    sub.textContent = `${pesos(seg?.precio || r.precio)} · ${fecha(r.actualizado || r.creado)}`;
    const estadoChip = seg && ESTADOS[seg.estado] ? seg.estado : r.estado;
    const chip = document.createElement('span');
    chip.className = `estado estado-${estadoChip}`;
    chip.textContent = ESTADOS[estadoChip] || estadoChip;
    texto.append(t, sub);
    if (seg) {
      const partes = [];
      if (seg.visitas != null) partes.push(`${seg.visitas} ${seg.visitas === 1 ? 'visita' : 'visitas'}`);
      if (seg.vendidas) partes.push(`${seg.vendidas} ${seg.vendidas === 1 ? 'vendida' : 'vendidas'}`);
      const linea = document.createElement('span');
      linea.className = 'item-seguimiento';
      linea.textContent = partes.join(' · ');
      if (seg.preguntas) {
        const q = document.createElement('b');
        q.className = 'pregunta';
        q.textContent = `${seg.preguntas} sin responder`;
        q.title = seg.preguntas === 1 ? 'Una pregunta sin responder en MercadoLibre' : `${seg.preguntas} preguntas sin responder en MercadoLibre`;
        linea.append(partes.length ? ' · ' : '', q);
      }
      if (linea.textContent) texto.append(linea);
    }
    abrir.append(img, texto, chip);

    const borrar = document.createElement('button');
    borrar.type = 'button';
    borrar.className = 'item-borrar';
    borrar.textContent = '×';
    borrar.title = r.estado === 'publicada' ? 'Sacar del historial (no la despublica)' : 'Borrar borrador';
    borrar.setAttribute('aria-label', `${borrar.title}: ${r.titulo}`);
    borrar.onclick = () => borrarRegistro(r, historialVista.registros);

    const igual = document.createElement('button');
    igual.type = 'button';
    igual.className = 'item-igual';
    igual.textContent = '⧉';
    igual.title = 'Hacer otra igual (borrador nuevo con las mismas fotos y datos)';
    igual.setAttribute('aria-label', `Hacer otra igual: ${r.titulo}`);
    igual.onclick = () => hacerOtraIgual(r.id);

    li.append(abrir, igual, borrar);
    return li;
  }));
}

/** Arriba del historial, lo que dice el seguimiento, sumado. Aparece recién cuando llegó. */
function pintarTotales(registros) {
  const seg = historialVista.seguimiento;
  const pubs = registros.filter(r => r.estado === 'publicada' && seg[r.id]);
  $('historial-totales').hidden = !pubs.length;
  if (!pubs.length) return;
  const t = { activas: 0, vendidas: 0, plata: 0, visitas: 0, preguntas: 0 };
  for (const r of pubs) {
    const s = seg[r.id];
    if (s.estado === 'activa' || s.estado === 'en_revision') t.activas++;
    if (s.estado === 'vendida') { t.vendidas++; t.plata += (s.precio || r.precio || 0) * (s.vendidas || 1); }
    t.visitas += s.visitas || 0;
    t.preguntas += s.preguntas || 0;
  }
  $('total-activas').textContent = t.activas;
  $('total-vendidas').textContent = t.vendidas;
  $('total-plata').textContent = pesos(t.plata);
  $('total-visitas').textContent = t.visitas;
  $('total-preguntas').textContent = t.preguntas;
  $('total-preguntas-caja').classList.toggle('alerta', t.preguntas > 0);
}

/** Borrado chico: desaparece ya, y se borra de verdad si no se toca "Deshacer". */
function borrarRegistro(r, registros) {
  ocultos.add(r.id);
  dibujarHistorial(registros);
  if (local('vendeloya.actual') === r.id) local('vendeloya.actual', null);
  toast(r.estado === 'publicada' ? 'Sacada del historial (sigue publicada).' : 'Borrador borrado.', {
    accion: 'Deshacer',
    alAccion: () => { ocultos.delete(r.id); dibujarHistorial(registros); },
    alVencer: async () => {
      try { await api(`/api/registros/${r.id}`, null, 'DELETE'); }
      catch (e) { toast(`No se pudo borrar: ${e.message}`); ocultos.delete(r.id); cargarHistorial(); }
    }
  });
}

async function abrirRegistro(id, { silencioso = false } = {}) {
  // Lo editado en el registro que está abierto se guarda ANTES de cambiar: si no, el autoguardado
  // (1,2 s después) grabaría la pantalla del siguiente registro y la edición se perdería.
  const abierto = estado.registroId && estado.registroId !== id && !$('paso-revision').hidden;
  const cambio = await cambiarDeRegistro({
    hayPendiente: () => abierto && sinGuardar,
    cancelarAutoguardado: () => clearTimeout(guardadoTimer),
    guardar: () => guardar(),
    limpiar: () => { sinGuardar = false; extraPendiente = {}; },
    abrir: () => abrirRegistroYa(id, { silencioso })
  });
  if (cambio === false && !silencioso) toast('No se pudo guardar lo que editaste: no cambio de publicación para no perderlo. Reintentá el guardado.');
  return cambio;
}

/** Abre el registro (sin guardar nada antes: eso lo hace abrirRegistro). true si quedó abierto. */
async function abrirRegistroYa(id, { silencioso = false } = {}) {
  if (!silencioso) esperar('Abriendo…');
  try {
    const reg = await api(`/api/registros/${id}`);
    if (!reg.analisis) throw new Error('El registro no tiene análisis.');
    estado.registroId = reg.id;
    estado.fotos = reg.fotos || [];
    estado.analisis = reg.analisis;
    estado.estadoReg = reg.estado === 'publicada' ? 'publicada' : 'borrador';
    if (reg.estado === 'publicada') { mostrarListo(reg.ml || {}, null); return true; }
    mostrarRevision(reg.analisis, reg.publicacion);
    marcarGuardado('Guardado ✓');
    local('vendeloya.actual', reg.id);
    return true;
  } catch (e) {
    local('vendeloya.actual', null);
    if (!silencioso) toast(`No se pudo abrir: ${e.message}`);
    return false;
  } finally {
    esperar('');
  }
}

/**
 * Un borrador nuevo con las fotos y los datos de otro (para publicar algo parecido,
 * o volver a publicar). No arrastra los ids de foto de MercadoLibre ni el link.
 */
async function hacerOtraIgual(id, { precio = 0 } = {}) {
  esperar('Copiando…');
  try {
    const reg = await api(`/api/registros/${id}`);
    if (!reg.analisis) throw new Error('Ese registro no tiene análisis.');
    const nuevo = nuevoId();
    // `precio`: el último que tuvo en MercadoLibre (al republicar una cerrada); si no viene, el del borrador.
    const publicacion = precio > 0 && reg.publicacion ? { ...reg.publicacion, precio: Math.round(precio) } : reg.publicacion;
    await api(`/api/registros/${nuevo}`, {
      fotos: (reg.fotos || []).map(f => ({ dataUrl: f.dataUrl })),
      thumb: reg.thumb,
      analisis: reg.analisis,
      publicacion,
      estado: 'borrador'
    }, 'PUT');
    await abrirRegistro(nuevo);
    toast('Listo: es un borrador nuevo, el original no se toca.');
  } catch (e) {
    toast(`No se pudo copiar: ${e.message}`);
  } finally {
    esperar('');
  }
}
$('otra-igual').addEventListener('click', () => hacerOtraIgual(estado.registroId));

$('refrescar-historial').addEventListener('click', () => cargarHistorial({ forzar: true }));

function volverAlInicio() {
  clearTimeout(guardadoTimer);
  if (estado.registroId && sinGuardar) guardar();
  sinGuardar = false;
  extraPendiente = {};
  $('aviso-inicio').hidden = true;
  estado.fotos = [];
  estado.analisis = null;
  estado.atributos = [];
  estado.registroId = null;
  local('vendeloya.actual', null);
  dibujarFotos();
  pantalla('inicio');
  cargarHistorial();
}
$('volver').addEventListener('click', volverAlInicio);
$('otra').addEventListener('click', volverAlInicio);
$('listo-historial').addEventListener('click', () => {
  volverAlInicio();
  $('historial').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ---------- una publicación: precio, estado y preguntas ---------- */

const pub = { reg: null, seg: null, preguntas: [] };

async function abrirPublicacion(r) {
  pub.reg = r;
  pub.seg = historialVista.seguimiento[r.id] || null;
  $('pub-titulo').textContent = r.titulo;
  $('pub-ver').href = r.permalink || '#';
  $('pub-ver').hidden = !r.permalink;
  $('pub-copiar').hidden = !r.permalink;
  $('pub-precio').value = miles(pub.seg?.precio || r.precio);
  pintarPublicacion();
  $('pub').showModal();
  await cargarPreguntasDe(r.id);
}

function pintarPublicacion() {
  const s = pub.seg;
  const est = s?.estado || 'publicada';
  $('pub-resumen').textContent = [
    ESTADOS[est] || est,
    s?.visitas != null ? `${s.visitas} ${s.visitas === 1 ? 'visita' : 'visitas'}` : '',
    s?.vendidas ? `${s.vendidas} ${s.vendidas === 1 ? 'vendida' : 'vendidas'}` : ''
  ].filter(Boolean).join(' · ');
  const cerrada = est === 'vendida' || est === 'finalizada';
  $('pub-pausar').hidden = !(est === 'activa' || est === 'publicada' || est === 'en_revision');
  $('pub-reactivar').hidden = est !== 'pausada';
  $('pub-vendida').hidden = cerrada;
  $('pub-cerrada').hidden = !cerrada;
  $('pub-republicar-caja').hidden = !cerrada;
  $('pub-precio').disabled = cerrada;
  $('pub-precio-guardar').disabled = cerrada;
}

/** Precio, pausar, reactivar o vendida: va a MercadoLibre y se refleja en el historial sin recargar. */
async function accionPublicacion(accion, precio) {
  const r = pub.reg;
  const mlId = pub.seg?.mlId || r.mlId;
  if (!mlId) { toast('Esta publicación no tiene id de MercadoLibre guardado. Tocá Actualizar y probá de nuevo.'); return; }
  const botones = $('pub').querySelectorAll('button');
  botones.forEach(b => { b.disabled = true; });
  try {
    const res = await api(`/api/publicaciones/${mlId}`, { accion, precio });
    pub.seg = { ...(pub.seg || {}), mlId, estado: res.estado, precio: res.precio ?? pub.seg?.precio ?? null };
    historialVista.seguimiento[r.id] = pub.seg;
    pintarPublicacion();
    dibujarHistorial(historialVista.registros);
    toast({ precio: 'Precio cambiado.', pausar: 'Publicación pausada.', reactivar: 'Publicación activa de nuevo.', vendida: 'Marcada como vendida: la publicación quedó cerrada.' }[accion]);
  } catch (e) {
    toast(e.message);
  } finally {
    botones.forEach(b => { b.disabled = false; });
    pintarPublicacion();
  }
}

async function cargarPreguntasDe(registroId) {
  $('pub-preguntas').replaceChildren();
  $('pub-preguntas-vacio').hidden = true;
  $('pub-preguntas-cargando').hidden = false;
  try {
    const { preguntas } = await api('/api/preguntas');
    pub.preguntas = preguntas.filter(q => q.registroId === registroId);
  } catch (e) {
    pub.preguntas = [];
    toast(`No se pudieron traer las preguntas: ${e.message}`);
  }
  $('pub-preguntas-cargando').hidden = true;
  dibujarPreguntas();
}

function dibujarPreguntas() {
  const lista = pub.preguntas;
  $('pub-preguntas-vacio').hidden = lista.length > 0;
  $('pub-preguntas').replaceChildren(...lista.map(q => {
    const li = document.createElement('li');
    const texto = document.createElement('p');
    texto.className = 'pregunta-texto';
    texto.textContent = q.texto;
    const cuando = document.createElement('small');
    cuando.textContent = fecha(q.fecha);
    const ta = document.createElement('textarea');
    ta.rows = 3;
    ta.placeholder = 'Tu respuesta (sin links ni teléfonos: MercadoLibre los rechaza)';
    ta.setAttribute('aria-label', `Respuesta a: ${q.texto}`);
    const fila = document.createElement('div');
    fila.className = 'fila';
    const sugerir = document.createElement('button');
    sugerir.type = 'button';
    sugerir.className = 'boton secundario';
    sugerir.textContent = '✨ Sugerir respuesta';
    sugerir.onclick = async () => {
      sugerir.disabled = true;
      sugerir.textContent = 'Pensando…';
      try {
        const r = await api(`/api/preguntas/${q.id}/borrador`, { registroId: q.registroId, pregunta: q.texto });
        ta.value = r.texto;
        ta.focus();
      } catch (e) { toast(e.message); }
      sugerir.disabled = false;
      sugerir.textContent = '✨ Sugerir respuesta';
    };
    const enviar = document.createElement('button');
    enviar.type = 'button';
    enviar.className = 'boton principal';
    enviar.textContent = 'Enviar';
    enviar.onclick = async () => {
      const t = ta.value.trim();
      if (!t) { ta.focus(); return; }
      enviar.disabled = true;
      try {
        await api(`/api/preguntas/${q.id}/responder`, { texto: t });
        pub.preguntas = pub.preguntas.filter(x => x.id !== q.id);
        if (pub.seg) { pub.seg.preguntas = Math.max(0, (pub.seg.preguntas || 0) - 1); dibujarHistorial(historialVista.registros); }
        dibujarPreguntas();
        toast('Respuesta enviada.');
      } catch (e) {
        toast(e.message);
        enviar.disabled = false;
      }
    };
    fila.append(sugerir, enviar);
    li.append(texto, cuando, ta, fila);
    return li;
  }));
}

$('pub-cerrar').addEventListener('click', () => $('pub').close());
/* Republicar una vendida o finalizada: un borrador nuevo con sus fotos y datos, y el último precio de MercadoLibre. */
$('pub-republicar').addEventListener('click', async () => {
  const r = pub.reg;
  if (!r) return;
  $('pub').close();
  await hacerOtraIgual(r.id, { precio: pub.seg?.precio || r.precio });
});
$('pub-copiar').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(pub.reg?.permalink || ''); toast('Link copiado.'); }
  catch { toast('No se pudo copiar. Mantené apretado el link para copiarlo.'); }
});
$('pub-whatsapp').addEventListener('click', async () => {
  const r = pub.reg;
  const texto = `Vendo: ${r.titulo} · ${pesos(pub.seg?.precio || r.precio)}\n${r.permalink || ''}`.trim();
  if (navigator.share) {
    try { await navigator.share({ text: texto }); return; } catch { /* canceló: va por WhatsApp web */ }
  }
  open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
});
$('pub-precio').addEventListener('input', e => { e.target.value = miles(String(e.target.value).replace(/\D/g, '')); });
$('pub-precio-guardar').addEventListener('click', () => {
  const v = Number(String($('pub-precio').value).replace(/\D/g, ''));
  if (!v) { $('pub-precio').focus(); return; }
  accionPublicacion('precio', v);
});
$('pub-pausar').addEventListener('click', () => accionPublicacion('pausar'));
$('pub-reactivar').addEventListener('click', () => accionPublicacion('reactivar'));
/* Vendida cierra la publicación para siempre: se confirma tocando dos veces seguidas. */
let vendidaArmada = 0;
$('pub-vendida').addEventListener('click', () => {
  if (Date.now() - vendidaArmada < 6000) {
    vendidaArmada = 0;
    $('pub-vendida').textContent = 'Marcar vendida';
    accionPublicacion('vendida');
    return;
  }
  vendidaArmada = Date.now();
  $('pub-vendida').textContent = '¿Seguro? Tocá otra vez para cerrarla';
  setTimeout(() => { if (vendidaArmada) { vendidaArmada = 0; $('pub-vendida').textContent = 'Marcar vendida'; } }, 6000);
});

/* ---------- revisar y publicar ---------- */

function leerPublicacion() {
  const valores = new Map([...$('paso-revision').querySelectorAll('[data-id]')].map(c => [c.dataset.id, c.value.trim()]));
  const garantia = $('garantia').value;
  return {
    titulo: $('titulo').value.trim(),
    categoria: $('categoria').value,
    condicion: $('condicion').value,
    precio: precioActual(),
    cantidad: Number($('cantidad').value) || 1,
    tipoPublicacion: $('tipo').value,
    garantia,
    garantiaTiempo: garantia === 'Garantía del vendedor' ? '30 días' : '',
    envio: $('envio').value,
    descripcion: $('descripcion').value,
    nota: $('nota').value.trim(), // privada: el Worker solo arma el ítem con los campos que conoce
    costo: valorDinero('costo'),             // privados también: costo del producto y envío a cargo
    costoEnvio: valorDinero('costo-envio'),
    comisionManual: $('comision-manual').value.trim(),
    paquete: leerPaqueteApp(),               // peso (g) y medidas (cm) del paquete, para el envío
    envioGratis: $('envio-gratis').checked,
    retiroTambien: $('retiro-tambien').checked,
    maxTitulo: estado.categoria?.maxTitulo || 60,
    pideGtin: !!estado.categoria?.pideGtin,
    categoriaDatos: estado.categoria,
    atributos: estado.atributos.map(a => ({ ...a, valor: conUnidad(a, valores.get(a.id) || '') }))
  };
}

const fotosParaEnviar = () => estado.fotos.map(f => (f.id ? { id: f.id } : { dataUrl: f.dataUrl }));

/** Las fotos que ya subió MercadoLibre no se vuelven a subir (y se guardan con su id). */
function guardarIdsDeFotos(ids = []) {
  let nuevas = false;
  ids.forEach((id, i) => { if (estado.fotos[i] && estado.fotos[i].id !== id) { estado.fotos[i].id = id; nuevas = true; } });
  return nuevas;
}

/**
 * Un solo botón: primero lo revisa MercadoLibre (validador, no publica). Si
 * está bien, se pide confirmar; si no, se muestra qué corregir y se abren los
 * grupos de datos para encontrarlo rápido.
 */
$('publicar').addEventListener('click', async () => {
  // Si falta algo que la app ya sabe, se va directo a completarlo: no hace falta preguntarle a MercadoLibre.
  const { pendientes: faltan } = pendientes();
  const destino = faltan.find(i => i.el)?.el;
  if (faltan.length && destino) {
    destino.closest('details')?.setAttribute('open', '');
    destino.scrollIntoView({ behavior: 'smooth', block: 'center' });
    destino.focus({ preventScroll: true });
    destino.closest('.campo')?.classList.add('resaltar');
    setTimeout(() => destino.closest('.campo')?.classList.remove('resaltar'), 1600);
    return;
  }
  esperar('MercadoLibre está revisando la publicación…');
  let r;
  try {
    r = await api('/api/revisar', { publicacion: leerPublicacion(), fotos: fotosParaEnviar() });
    const fotosNuevas = guardarIdsDeFotos(r.fotos);
    estado.estadoReg = r.ok ? 'revisada' : 'borrador';
    guardar(fotosNuevas ? { fotos: estado.fotos } : {});
  } catch (e) {
    avisos($('resultado-revision'), 'error', e.message);
    return;
  } finally {
    esperar('');
  }
  const notas = (r.avisos || []).map(a => `Aviso: ${a}`);
  if (!r.ok) {
    avisos($('resultado-revision'), 'error', 'Antes de publicar, corregí esto:', [...(r.errores || []), ...notas]);
    if (r.errores?.some(t => /atributo|attribute|falta/i.test(t))) for (const g of document.querySelectorAll('.grupo')) g.open = true;
    return;
  }
  $('resultado-revision').hidden = true;
  const p = leerPublicacion();
  $('confirmar-texto').textContent = `"${p.titulo}" a ${pesos(p.precio)}, ${p.cantidad} unidad${p.cantidad > 1 ? 'es' : ''}, ${$('tipo').selectedOptions[0]?.textContent || ''}${p.envio === 'retiro' ? ', retiro en persona' : ''}.`;
  $('confirmar-avisos').replaceChildren(...notas.map(t => { const li = document.createElement('li'); li.textContent = t; return li; }));
  $('confirmar').showModal();
});
$('confirmar-no').addEventListener('click', () => $('confirmar').close());

function mostrarListo(ml, aviso) {
  $('listo-texto').textContent = `Quedó publicada${ml.id ? ` (${ml.id})` : ''}.${aviso ? ' ' + aviso : ''}`;
  const portada = estado.fotos[0]?.dataUrl || '';
  $('listo-foto').src = portada;
  $('listo-foto').hidden = !portada;
  $('listo-precio').textContent = precioActual() ? pesos(precioActual()) : '';
  $('listo-link').href = ml.permalink || '#';
  $('listo-link').hidden = !ml.permalink;
  $('listo-compartir').hidden = !ml.permalink;
  $('compartir').hidden = !navigator.share;
  estado.publicada = { titulo: $('titulo').value.trim(), link: ml.permalink };
  local('vendeloya.actual', null);
  pantalla('listo');
}

/* Para pasar el link por WhatsApp o redes: en el celu, el menú de compartir; en la compu, copiarlo. */
$('compartir').addEventListener('click', () => {
  const { titulo, link } = estado.publicada || {};
  navigator.share({ title: titulo, text: titulo, url: link }).catch(() => {});
});
$('copiar-link').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(estado.publicada?.link || '');
    toast('Link copiado.');
  } catch { toast('No se pudo copiar el link.'); }
});

/* Ctrl+Enter (Cmd+Enter en Mac) publica desde cualquier campo de la revisión: es el mismo botón. */
/* Atajos: Esc vuelve al inicio, "/" busca en el historial, Ctrl+S guarda ya, Ctrl+Enter publica. */
document.addEventListener('keydown', e => {
  const dialogo = document.querySelector('dialog[open]');
  const escribiendo = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
  if (e.key === 'Escape' && !dialogo && (!$('paso-revision').hidden || !$('paso-listo').hidden)) {
    e.preventDefault();
    volverAlInicio();
    return;
  }
  if (e.key === '/' && !dialogo && !escribiendo && !$('historial').hidden && !$('historial-filtros').hidden) {
    e.preventDefault();
    $('historial-buscar').focus();
    return;
  }
  if ((e.key === 's' || e.key === 'S') && (e.ctrlKey || e.metaKey) && !dialogo && !$('paso-revision').hidden) {
    e.preventDefault();
    clearTimeout(guardadoTimer);
    guardar().then(() => toast('Borrador guardado.'));
    return;
  }
  if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
  if ($('paso-revision').hidden || dialogo || !$('espera').hidden) return;
  e.preventDefault();
  $('publicar').click();
});

$('confirmar-si').addEventListener('click', async () => {
  $('confirmar').close();
  esperar('Publicando…');
  try {
    const r = await api('/api/publicar', { publicacion: leerPublicacion(), fotos: fotosParaEnviar() });
    estado.estadoReg = 'publicada';
    await guardar({ ml: { id: r.id, permalink: r.permalink } });
    mostrarListo(r, r.avisoDescripcion);
  } catch (e) {
    avisos($('resultado-revision'), 'error', `No se publicó: ${e.message}`);
  } finally {
    esperar('');
  }
});

/* ---------- modo demo ---------- */

/* Los registros del demo viven en sessionStorage: sobreviven a una recarga
   (para probar el "retomar") pero no se mezclan con nada real. */
function demoRegs(nuevo) {
  try {
    if (nuevo) sessionStorage.setItem('vendeloya.demo', JSON.stringify(nuevo));
    return JSON.parse(sessionStorage.getItem('vendeloya.demo') || '{}');
  } catch { return {}; }
}

/* Preguntas y acciones del demo (responder, pausar, cambiar precio): también en
   sessionStorage, para que se noten al volver. Las preguntas se inventan la primera
   vez sobre las dos primeras publicadas. */
function demoExtra(regs, nuevo) {
  try {
    if (nuevo) sessionStorage.setItem('vendeloya.demo.extra', JSON.stringify(nuevo));
    const extra = JSON.parse(sessionStorage.getItem('vendeloya.demo.extra') || 'null') || { preguntas: null, acciones: {} };
    if (!extra.preguntas) {
      const pubs = Object.values(regs).filter(r => r.estado === 'publicada');
      const hace = h => new Date(Date.now() - h * 3600e3).toISOString();
      extra.preguntas = pubs.slice(0, 2).flatMap((r, i) => i === 0
        ? [{ id: `${r.id}-q1`, registroId: r.id, mlId: r.ml?.id, texto: 'Hola, ¿cuánto mide de alto? ¿Hacés envíos a Morón?', fecha: hace(5) },
           { id: `${r.id}-q2`, registroId: r.id, mlId: r.ml?.id, texto: '¿Tiene algún detalle o rayón?', fecha: hace(26) }]
        : [{ id: `${r.id}-q1`, registroId: r.id, mlId: r.ml?.id, texto: '¿Es el precio final o se puede mejorar?', fecha: hace(2) }]);
      if (pubs.length) sessionStorage.setItem('vendeloya.demo.extra', JSON.stringify(extra));
    }
    return extra;
  } catch { return { preguntas: [], acciones: {} }; }
}

async function apiDemo(ruta, cuerpo, metodo) {
  await new Promise(r => setTimeout(r, 400));
  const nombre = metodo === 'PUT' ? 'guardar' : ruta.split('/')[2];
  if (FALLAS.has(nombre)) throw new Error('Falla simulada del demo');
  const atributos = [
    { id: 'BRAND', nombre: 'Marca', tipo: 'string', requerido: true, unidades: [], opciones: [], valor: 'Black+Decker' },
    { id: 'MODEL', nombre: 'Modelo', tipo: 'string', requerido: true, unidades: [], opciones: [], valor: '' },
    { id: 'POWER', nombre: 'Potencia', tipo: 'number_unit', requerido: false, unidades: ['W'], opciones: [], valor: '500 W' },
    { id: 'COLOR', nombre: 'Color', tipo: 'list', requerido: false, unidades: [], opciones: [{ id: '1', nombre: 'Naranja' }, { id: '2', nombre: 'Negro' }], valor: 'Naranja' },
    { id: 'WEIGHT', nombre: 'Peso', tipo: 'number_unit', requerido: false, unidades: ['kg'], opciones: [], valor: '' },
    // Como en los borradores de antes del 22/10: el GTIN llegaba como obligatorio.
    // Como el caso real de una biblioteca: un número suelto, sin unidad, que MercadoLibre rechaza.
    { id: 'HEIGHT', nombre: 'Alto', tipo: 'number_unit', requerido: true, unidades: ['in', 'millas', 'yd', 'U', 'mil', 'mm', 'cm', 'manos', 'ft', 'pulgadas', 'm', 'nm', 'µm', 'km', '"'], opciones: [], valor: '200' },
    { id: 'GTIN', nombre: 'Código universal de producto', tipo: 'string', requerido: true, unidades: [], opciones: [], valor: '' },
    { id: 'IMPORT_DUTY', nombre: 'Impuesto interno', tipo: 'list', requerido: true, unidades: [], valor: '',
      opciones: ['0 %', '5 %', '10 %'].map((nombre, i) => ({ id: String(i), nombre })) }
  ];
  const categoria = { id: 'MLA5232', nombre: 'Herramientas › Taladros › De Mano', maxTitulo: 60, pideGtin: true,
    tiposPublicacion: [{ id: 'gold_special', nombre: 'Clásica' }, { id: 'gold_pro', nombre: 'Premium' }, { id: 'free', nombre: 'Gratuita' }] };
  const desconectada = (() => { try { return sessionStorage.getItem('vendeloya.demo.sinml') === '1'; } catch { return false; } })();
  if (ruta === '/api/estado') return desconectada ? { conectado: false } : { conectado: true, nickname: 'DEMO', userProducts: true };
  if (ruta === '/api/desconectar') { try { sessionStorage.setItem('vendeloya.demo.sinml', '1'); } catch {} return { ok: true }; }
  atributos.push({ id: 'VALUE_ADDED_TAX', nombre: 'IVA', tipo: 'list', requerido: true, unidades: [], valor: 'Exento',
    opciones: ['Exento', '0 %', '10.5 %', '21 %', '27 %'].map((nombre, i) => ({ id: String(i), nombre })) });
  if (ruta === '/api/analizar') return {
    identificacion: { producto: 'Taladro percutor eléctrico', marca: 'Black+Decker', modelo: '', estado_detalle: 'Uso visible en el mandril, carcasa sana. Se ve el cable entero y el selector de velocidad funciona según la foto.',
      advertencias: ['No se ve el modelo: buscalo en la etiqueta de abajo.', 'Sacá una foto del enchufe y del cable completo.', 'Aclarar si incluye mechas o maletín.'], confianza: 'media' },
    categorias: [{ id: 'MLA5232', nombre: 'Taladros eléctricos › De Mano' }, { id: 'MLA1', nombre: 'Herramientas › Otros' }],
    categoria, atributos,
    precio: { valor: 45000, fuente: 'mercadolibre', min: 38000, max: 52000, muestras: 12, parecidos: [
      { titulo: 'Taladro Percutor Black Decker 500w Usado', precio: 44000, permalink: 'https://www.mercadolibre.com.ar', thumb: '' },
      { titulo: 'Taladro Black+decker Tm500 500w Con Maletín', precio: 47500, permalink: 'https://www.mercadolibre.com.ar', thumb: '' },
      { titulo: 'Taladro Percutor 500w Black And Decker', precio: 41000, permalink: 'https://www.mercadolibre.com.ar', thumb: '' },
      { titulo: 'Taladro Black Decker 13mm 500w', precio: 50000, permalink: 'https://www.mercadolibre.com.ar', thumb: '' },
      { titulo: 'Taladro Percutor Bd 500w Impecable', precio: 39000, permalink: 'https://www.mercadolibre.com.ar', thumb: '' }
    ] },
    userProducts: true,
    propuesta: { titulo: 'Taladro Percutor Black And Decker 500w', condicion: 'usado',
      descripcion: 'Taladro percutor Black+Decker de 500 W.\nUsado, funciona perfecto.\nIncluye solo el taladro.',
      precio: 45000, categoria: 'MLA5232', tipoPublicacion: 'gold_special', garantia: 'Sin garantía' }
  };
  if (ruta === '/api/categoria') return { categoria, atributos };
  if (ruta === '/api/revisar') {
    // Igual que MercadoLibre: un número suelto en un dato con unidad se rechaza.
    const sinUnidad = cuerpo.publicacion.atributos.filter(a => a.tipo === 'number_unit' && /^\d+([.,]\d+)?$/.test(String(a.valor || '').trim()));
    if (sinUnidad.length) return { ok: false, fotos: cuerpo.fotos.map((_, i) => `demo-${i}`),
      errores: sinUnidad.map(a => `Attribute ${a.id} with value ${a.valor} is required and was omitted. The provided unit is not valid.`) };
    const falta = cuerpo.publicacion.atributos.filter(a => a.requerido && !a.valor).map(a => a.nombre);
    return falta.length
      ? { ok: false, fotos: cuerpo.fotos.map((_, i) => `demo-${i}`), errores: [`Falta completar: ${falta.join(', ')}.`] }
      : { ok: true, fotos: cuerpo.fotos.map((_, i) => `demo-${i}`),
          avisos: cuerpo.publicacion.envio === 'retiro' ? [] : ['Este producto no entra en Mercado Envíos (por tamaño o categoría): el envío queda a acordar con el comprador.'] };
  }
  if (ruta.startsWith('/api/comision')) {
    // Demo: porcentajes inventados, solo para ver la pantalla (los reales los informa MercadoLibre).
    if (FALLAS.has('comision')) return { disponible: false, motivo: 'falla simulada del demo' };
    const precio = Number(new URLSearchParams(ruta.split('?')[1]).get('precio')) || 0;
    const t = (id, nombre, pct) => ({ id, nombre, pct, fijo: 0, comision: Math.round(precio * pct) / 100 });
    const sinPremium = FALLAS.has('comision-sin-premium');   // MercadoLibre contesta, pero sin el tipo Premium ni la Gratuita
    return { disponible: true, precio, tipos: [t('gold_special', 'Clásica', 13), ...(sinPremium ? [] : [t('gold_pro', 'Premium', 18), t('free', 'Gratuita', 0)])] };
  }
  if (ruta === '/api/publicar') return { id: 'MLA-DEMO', permalink: 'https://www.mercadolibre.com.ar', estado: 'demo' };

  const regs = demoRegs();
  const extra = demoExtra(regs);
  if (ruta.startsWith('/api/seguimiento')) {
    const pubs = Object.values(regs).filter(r => r.estado === 'publicada');
    return { consultado: new Date().toISOString(), registros: Object.fromEntries(pubs.map((r, i) => {
      const base = i % 3 === 2 ? { estado: 'vendida', vendidas: 1, disponibles: 0, visitas: 40 + i * 7 }
                               : { estado: 'activa', vendidas: 0, disponibles: 1, visitas: 12 + i * 7 };
      const a = extra.acciones[r.ml?.id] || {};
      return [r.id, { ...base, ...(a.estado ? { estado: a.estado } : {}), precio: a.precio ?? null, mlId: r.ml?.id,
        preguntas: extra.preguntas.filter(q => q.registroId === r.id).length }];
    })) };
  }
  if (ruta === '/api/preguntas') {
    return { preguntas: extra.preguntas.map(q => ({ ...q, titulo: regs[q.registroId]?.publicacion?.titulo || 'Publicación' })) };
  }
  const mp = /^\/api\/preguntas\/([^/]+)\/(borrador|responder)$/.exec(ruta);
  if (mp) {
    if (mp[2] === 'borrador') return { texto: 'Hola! Mide 180 cm de alto por 90 de ancho. Solo retiro por Caseros, no hago envíos. Cualquier otra duda, preguntame.' };
    extra.preguntas = extra.preguntas.filter(q => q.id !== mp[1]);
    demoExtra(regs, extra);
    return { ok: true };
  }
  const ma = /^\/api\/publicaciones\/(.+)$/.exec(ruta);
  if (ma) {
    const a = extra.acciones[ma[1]] || {};
    if (cuerpo.accion === 'precio') a.precio = Number(cuerpo.precio);
    else a.estado = { pausar: 'pausada', reactivar: 'activa', vendida: 'vendida' }[cuerpo.accion] || a.estado;
    extra.acciones[ma[1]] = a;
    demoExtra(regs, extra);
    return { estado: a.estado || 'activa', precio: a.precio ?? null };
  }
  if (ruta === '/api/foto/mejorar') return { foto: cuerpo.foto, cambio: 'demo' };
  if (ruta === '/api/registros') {
    const lista = Object.values(regs).sort((a, b) => (b.actualizado || '').localeCompare(a.actualizado || ''));
    return { registros: lista.map(r => ({ id: r.id, creado: r.creado, actualizado: r.actualizado, estado: r.estado || 'borrador',
      titulo: r.publicacion?.titulo || r.analisis?.propuesta?.titulo || 'Sin título',
      precio: Number(r.publicacion?.precio || r.analisis?.propuesta?.precio) || 0, thumb: r.thumb || '', permalink: r.ml?.permalink || '' })) };
  }
  const m = /^\/api\/registros\/(.+)$/.exec(ruta);
  if (m) {
    const id = m[1];
    if (metodo === 'PUT') {
      const ahora = new Date().toISOString();
      regs[id] = { ...(regs[id] || { id, creado: ahora }), ...cuerpo, actualizado: ahora };
      demoRegs(regs);
      return { ok: true };
    }
    if (metodo === 'DELETE') { delete regs[id]; demoRegs(regs); return { ok: true }; }
    if (!regs[id]) throw new Error('Ese registro ya no existe.');
    return regs[id];
  }
  throw new Error('Ruta demo desconocida');
}

/* ---------- arranque ---------- */

if (DEMO) {
  document.title = 'VendeloYa (demo)';
  // Ganchos para probar sin manos (solo en el demo).
  window.__vy = { estado, pendientes, agregarFotos, guardar, contacto, FALLAS, historialVista, api, cargarHistorial, fotosCambiaron, lineaMedidas, armarRespaldo, aplicarTema,
    hacerOtraIgual, abrirRegistro, cola, correrCola, sumarACola, pintarCola, moverFoto, prolijar, redondear, actualizarRed, cierre, conUnidad, leerPublicacion };
}
dibujarFotos();
refrescarCuenta();
cargarHistorial();
// Si había algo abierto (se recargó la página o se cerró la app), se retoma.
if (local('vendeloya.actual') && (clave() || DEMO)) abrirRegistro(local('vendeloya.actual'), { silencioso: true });
if ('serviceWorker' in navigator && !DEMO) navigator.serviceWorker.register('sw.js').catch(() => {});
