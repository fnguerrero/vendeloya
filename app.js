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

function avisos(el, tipo, titulo, lista = []) {
  el.className = `avisos ${tipo}`;
  el.replaceChildren();
  const p = document.createElement('p');
  p.textContent = titulo;
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
  return d.toDateString() === hoy.toDateString()
    ? `hoy ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
};

const nuevoId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

async function api(ruta, cuerpo, metodo) {
  if (DEMO) return apiDemo(ruta, cuerpo, metodo);
  // El estado se pide igual sin clave: así se entera de si al Worker le faltan secretos.
  if (!clave() && ruta !== '/api/estado') {
    abrirConfig();
    throw new Error('Cargá la clave de la app en Ajustes.');
  }
  const res = await fetch(window.VENDELOYA.worker + ruta, {
    method: metodo || (cuerpo ? 'POST' : 'GET'),
    headers: { 'x-clave': clave(), ...(cuerpo ? { 'content-type': 'application/json' } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
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
  } catch (err) {
    b.dataset.faltan = err.faltan ? err.faltan.join(', ') : '';
    b.textContent = err.faltan ? 'Falta configurar' : clave() ? 'Sin conexión' : 'Falta la clave';
    b.classList.remove('conectada');
    b.dataset.conectada = '';
    b.dataset.nickname = '';
  }
  pintarConfig();
}

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
  $('config').showModal();
}
$('abrir-config').addEventListener('click', abrirConfig);
$('cuenta').addEventListener('click', abrirConfig);
$('cerrar-config').addEventListener('click', () => $('config').close());

$('conectar-ml').addEventListener('click', () => {
  if (DEMO) return;
  window.open(`${window.VENDELOYA.worker}/oauth/start?k=${encodeURIComponent(clave())}`, '_blank', 'noopener');
});

$('desconectar-ml').addEventListener('click', async () => {
  if (!confirm('¿Desconectar tu cuenta de MercadoLibre? Para volver a publicar vas a tener que conectarla de nuevo.')) return;
  try {
    await api('/api/desconectar', {});
    toast('Cuenta de MercadoLibre desconectada.');
  } catch (e) { alert(e.message); }
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
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  refrescarCuenta();
  if (!$('historial').hidden) cargarHistorial();
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
  let chicas = 0;
  for (const a of archivos) {
    if (estado.fotos.length >= MAX_FOTOS) break;
    const url = URL.createObjectURL(a);
    try {
      const { dataUrl, chica } = await escalar(url, LADO_FOTO, 0.85);
      estado.fotos.push({ dataUrl });
      if (chica) chicas++;
    } catch (e) { alert(e.message); }
    URL.revokeObjectURL(url);
  }
  if (chicas) alert('Alguna foto es chica (menos de 500 px). MercadoLibre la va a mostrar con baja calidad.');
  dibujarFotos();
}

function dibujarFotos() {
  $('miniaturas').replaceChildren(...estado.fotos.map((f, i) => {
    const d = document.createElement('div');
    d.className = 'miniatura';
    const img = document.createElement('img');
    img.src = f.dataUrl;
    img.alt = `Foto ${i + 1}`;
    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '×';
    x.setAttribute('aria-label', `Sacar foto ${i + 1}`);
    x.onclick = () => { estado.fotos.splice(i, 1); dibujarFotos(); };
    d.append(img, x);
    return d;
  }));
  $('analizar').disabled = !estado.fotos.length;
}

for (const id of ['camara', 'galeria']) {
  $(id).addEventListener('change', e => { agregarFotos([...e.target.files]); e.target.value = ''; });
}

/* ---------- análisis ---------- */

$('analizar').addEventListener('click', async () => {
  esperar('Mirando las fotos y armando la publicación…');
  try {
    const r = await api('/api/analizar', { fotos: estado.fotos.map(f => f.dataUrl) });
    estado.analisis = r;
    estado.registroId = nuevoId();
    estado.estadoReg = 'borrador';
    mostrarRevision(r);
    local('vendeloya.actual', estado.registroId);
    // Primer guardado: con las fotos y la miniatura. Los siguientes van sin fotos.
    const { dataUrl: thumb } = await escalar(estado.fotos[0].dataUrl, LADO_THUMB, 0.7);
    await guardar({ fotos: estado.fotos, thumb, analisis: r });
  } catch (e) {
    alert(e.message);
  } finally {
    esperar('');
  }
});

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
  $('precio').value = p.precio || '';
  $('descripcion').value = p.descripcion || '';
  $('garantia').value = p.garantia || '';
  $('envio').value = p.envio ?? 'retiro';
  $('cantidad').value = p.cantidad || 1;

  const categoria = guardada?.categoriaDatos || r.categoria;
  const categorias = r.categorias.some(c => c.id === categoria.id)
    ? r.categorias : [{ id: categoria.id, nombre: categoria.nombre }, ...r.categorias];
  $('categoria').replaceChildren(...categorias.map(c => opcion(c.id, c.nombre, c.id === categoria.id)));
  dibujarCategoria(categoria, guardada?.atributos || r.atributos, p.tipoPublicacion);

  dibujarPrecio(r.precio);
  dibujarIA(r.identificacion);

  $('fotos-revision').replaceChildren(...estado.fotos.map((f, i) => {
    const img = document.createElement('img');
    img.src = f.dataUrl;
    img.alt = `Foto ${i + 1}`;
    return img;
  }));

  $('resultado-revision').hidden = true;
  $('guardado').textContent = '';
  for (const g of document.querySelectorAll('.grupo')) g.open = false;
  resumirVenta();
  pantalla('revision');
}

/** Lo que se ve con el grupo "Envío y venta" cerrado. */
function resumirVenta() {
  const envio = $('envio').value === 'retiro' ? 'Retiro en persona' : 'Envío de la cuenta';
  const tipo = $('tipo').selectedOptions[0]?.textContent || '';
  $('resumen-venta').textContent = `${envio} · ${$('cantidad').value || 1} u. · ${tipo}`;
}

/* ---------- precio destacado ---------- */

function dibujarPrecio(pr) {
  estado.rango = pr;
  $('precio-fuente').textContent = pr.fuente === 'mercadolibre'
    ? `Mediana de ${pr.muestras} publicaciones parecidas en MercadoLibre.`
    : 'Estimado por la IA a partir de las fotos. Conviene comparar con publicaciones parecidas.';
  const botones = { min: `Mínimo ${pesos(pr.min)}`, sugerido: `Sugerido ${pesos(pr.valor)}`, max: `Máximo ${pesos(pr.max)}` };
  for (const b of document.querySelectorAll('.rango-btn')) b.textContent = botones[b.dataset.precio];
  $('precio-rango').hidden = !(pr.min > 0 && pr.max > pr.min);
  marcarPrecio();
}

/** Ubica el precio actual en la barra de mínimo a máximo y marca el botón que coincide. */
function marcarPrecio() {
  const pr = estado.rango;
  if (!pr || !(pr.max > pr.min)) return;
  const v = Number($('precio').value) || 0;
  const pct = Math.max(0, Math.min(100, ((v - pr.min) / (pr.max - pr.min)) * 100));
  $('rango-marca').style.left = `${pct}%`;
  $('rango-relleno').style.width = `${pct}%`;
  const valores = { min: pr.min, sugerido: pr.valor, max: pr.max };
  for (const b of document.querySelectorAll('.rango-btn')) b.classList.toggle('activo', valores[b.dataset.precio] === v);
}

for (const b of document.querySelectorAll('.rango-btn')) {
  b.addEventListener('click', () => {
    const pr = estado.rango;
    $('precio').value = { min: pr.min, sugerido: pr.valor, max: pr.max }[b.dataset.precio];
    $('precio').dispatchEvent(new Event('input', { bubbles: true }));
  });
}
$('precio').addEventListener('input', marcarPrecio);

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
  l.append(n, control);
  return l;
}

/** A la vista solo lo obligatorio; lo opcional, plegado en "Más datos". */
function dibujarCategoria(categoria, atributos, tipoElegido) {
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
}

$('categoria').addEventListener('change', async () => {
  esperar('Trayendo la ficha de esa categoría…');
  try {
    const r = await api('/api/categoria', { categoria: $('categoria').value, identificacion: estado.analisis.identificacion });
    dibujarCategoria(r.categoria, r.atributos, $('tipo').value);
    programarGuardado();
  } catch (e) {
    alert(e.message);
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
}
$('titulo').addEventListener('input', actualizarContador);

/* Cualquier cambio se autoguarda (y obliga a que MercadoLibre lo revise de nuevo al publicar). */
function tocado(e) {
  if (e?.target?.id === 'categoria') return; // la categoría guarda cuando llega su ficha
  if (estado.estadoReg === 'revisada') estado.estadoReg = 'borrador';
  if (['envio', 'cantidad', 'tipo'].includes(e?.target?.id)) resumirVenta();
  $('resultado-revision').hidden = true;
  programarGuardado();
}
$('paso-revision').addEventListener('input', tocado);
$('paso-revision').addEventListener('change', tocado);

/* ---------- guardado ---------- */

let guardadoTimer;

function programarGuardado() {
  if (!estado.registroId) return;
  clearTimeout(guardadoTimer);
  $('guardado').textContent = 'Sin guardar…';
  guardadoTimer = setTimeout(() => guardar(), ESPERA_GUARDADO);
}

/** Guarda lo editado (y lo que venga en `extra`) en el registro actual. */
async function guardar(extra = {}) {
  if (!estado.registroId) return;
  clearTimeout(guardadoTimer);
  $('guardado').textContent = 'Guardando…';
  try {
    await api(`/api/registros/${estado.registroId}`, { publicacion: leerPublicacion(), estado: estado.estadoReg, ...extra }, 'PUT');
    $('guardado').textContent = 'Guardado ✓';
  } catch (e) {
    $('guardado').textContent = 'No se pudo guardar';
    console.warn('guardar:', e.message);
  }
}

/* ---------- historial ---------- */

const ESTADOS = { borrador: 'Borrador', revisada: 'Revisada', publicada: 'Publicada' };
const ocultos = new Set(); // borrados con "Deshacer" pendiente

async function cargarHistorial() {
  if (!clave() && !DEMO) { dibujarHistorial([]); return; }
  try {
    const { registros } = await api('/api/registros');
    dibujarHistorial(registros);
  } catch (e) {
    $('historial-vacio').textContent = `No se pudo traer el historial: ${e.message}`;
    $('historial-vacio').hidden = false;
  }
}

function dibujarHistorial(registros) {
  const visibles = registros.filter(r => !ocultos.has(r.id));
  $('historial-vacio').hidden = visibles.length > 0;
  $('historial-vacio').textContent = 'Todavía no analizaste nada. Lo que armes queda guardado acá, aunque cierres la app.';
  $('historial-lista').replaceChildren(...visibles.map(r => {
    const li = document.createElement('li');
    li.className = 'item';
    const abrir = document.createElement(r.estado === 'publicada' && r.permalink ? 'a' : 'button');
    abrir.className = 'item-abrir';
    if (abrir.tagName === 'A') { abrir.href = r.permalink; abrir.target = '_blank'; abrir.rel = 'noopener'; }
    else { abrir.type = 'button'; abrir.onclick = () => abrirRegistro(r.id); }

    const img = document.createElement('img');
    img.alt = '';
    if (r.thumb) img.src = r.thumb;
    const texto = document.createElement('div');
    texto.className = 'item-texto';
    const t = document.createElement('strong');
    t.textContent = r.titulo;
    const sub = document.createElement('span');
    sub.textContent = `${pesos(r.precio)} · ${fecha(r.actualizado || r.creado)}`;
    const chip = document.createElement('span');
    chip.className = `estado estado-${r.estado}`;
    chip.textContent = ESTADOS[r.estado] || r.estado;
    texto.append(t, sub);
    abrir.append(img, texto, chip);

    const borrar = document.createElement('button');
    borrar.type = 'button';
    borrar.className = 'item-borrar';
    borrar.textContent = '×';
    borrar.title = r.estado === 'publicada' ? 'Sacar del historial (no la despublica)' : 'Borrar borrador';
    borrar.setAttribute('aria-label', `${borrar.title}: ${r.titulo}`);
    borrar.onclick = () => borrarRegistro(r, registros);

    li.append(abrir, borrar);
    return li;
  }));
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
  if (!silencioso) esperar('Abriendo…');
  try {
    const reg = await api(`/api/registros/${id}`);
    if (!reg.analisis) throw new Error('El registro no tiene análisis.');
    estado.registroId = reg.id;
    estado.fotos = reg.fotos || [];
    estado.analisis = reg.analisis;
    estado.estadoReg = reg.estado === 'publicada' ? 'publicada' : 'borrador';
    if (reg.estado === 'publicada') { mostrarListo(reg.ml || {}, null); return; }
    mostrarRevision(reg.analisis, reg.publicacion);
    $('guardado').textContent = 'Guardado ✓';
    local('vendeloya.actual', reg.id);
  } catch (e) {
    local('vendeloya.actual', null);
    if (!silencioso) alert(e.message);
  } finally {
    esperar('');
  }
}

$('refrescar-historial').addEventListener('click', cargarHistorial);

function volverAlInicio() {
  clearTimeout(guardadoTimer);
  if (estado.registroId && $('guardado').textContent === 'Sin guardar…') guardar();
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

/* ---------- revisar y publicar ---------- */

function leerPublicacion() {
  const valores = new Map([...$('paso-revision').querySelectorAll('[data-id]')].map(c => [c.dataset.id, c.value.trim()]));
  const garantia = $('garantia').value;
  return {
    titulo: $('titulo').value.trim(),
    categoria: $('categoria').value,
    condicion: $('condicion').value,
    precio: Number($('precio').value),
    cantidad: Number($('cantidad').value) || 1,
    tipoPublicacion: $('tipo').value,
    garantia,
    garantiaTiempo: garantia === 'Garantía del vendedor' ? '30 días' : '',
    envio: $('envio').value,
    descripcion: $('descripcion').value,
    maxTitulo: estado.categoria?.maxTitulo || 60,
    pideGtin: !!estado.categoria?.pideGtin,
    categoriaDatos: estado.categoria,
    atributos: estado.atributos.map(a => ({ ...a, valor: valores.get(a.id) || '' }))
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
  $('listo-link').href = ml.permalink || '#';
  $('listo-link').hidden = !ml.permalink;
  local('vendeloya.actual', null);
  pantalla('listo');
}

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

async function apiDemo(ruta, cuerpo, metodo) {
  await new Promise(r => setTimeout(r, 400));
  const atributos = [
    { id: 'BRAND', nombre: 'Marca', tipo: 'string', requerido: true, unidades: [], opciones: [], valor: 'Black+Decker' },
    { id: 'MODEL', nombre: 'Modelo', tipo: 'string', requerido: true, unidades: [], opciones: [], valor: '' },
    { id: 'POWER', nombre: 'Potencia', tipo: 'number_unit', requerido: false, unidades: ['W'], opciones: [], valor: '500 W' },
    { id: 'COLOR', nombre: 'Color', tipo: 'list', requerido: false, unidades: [], opciones: [{ id: '1', nombre: 'Naranja' }, { id: '2', nombre: 'Negro' }], valor: 'Naranja' },
    { id: 'WEIGHT', nombre: 'Peso', tipo: 'number_unit', requerido: false, unidades: ['kg'], opciones: [], valor: '' }
  ];
  const categoria = { id: 'MLA5232', nombre: 'Herramientas › Taladros › De Mano', maxTitulo: 60, pideGtin: true,
    tiposPublicacion: [{ id: 'gold_special', nombre: 'Clásica' }, { id: 'gold_pro', nombre: 'Premium' }, { id: 'free', nombre: 'Gratuita' }] };
  const desconectada = (() => { try { return sessionStorage.getItem('vendeloya.demo.sinml') === '1'; } catch { return false; } })();
  if (ruta === '/api/estado') return desconectada ? { conectado: false } : { conectado: true, nickname: 'DEMO', userProducts: true };
  if (ruta === '/api/desconectar') { try { sessionStorage.setItem('vendeloya.demo.sinml', '1'); } catch {} return { ok: true }; }
  atributos.push({ id: 'VALUE_ADDED_TAX', nombre: 'IVA', tipo: 'list', requerido: true, unidades: [], valor: 'Exento',
    opciones: ['Exento', '0 %', '10.5 %', '21 %', '27 %'].map((nombre, i) => ({ id: String(i), nombre })) });
  if (ruta === '/api/analizar') return {
    identificacion: { producto: 'Taladro percutor eléctrico', estado_detalle: 'Uso visible en el mandril, carcasa sana.',
      advertencias: ['No se ve el modelo: buscalo en la etiqueta de abajo.'], confianza: 'media' },
    categorias: [{ id: 'MLA5232', nombre: 'Taladros eléctricos › De Mano' }, { id: 'MLA1', nombre: 'Herramientas › Otros' }],
    categoria, atributos,
    precio: { valor: 45000, fuente: 'ia', min: 38000, max: 52000, motivo: 'modo demo' },
    userProducts: true,
    propuesta: { titulo: 'Taladro Percutor Black And Decker 500w', condicion: 'usado',
      descripcion: 'Taladro percutor Black+Decker de 500 W.\nUsado, funciona perfecto.\nIncluye solo el taladro.',
      precio: 45000, categoria: 'MLA5232', tipoPublicacion: 'gold_special', garantia: 'Sin garantía' }
  };
  if (ruta === '/api/categoria') return { categoria, atributos };
  if (ruta === '/api/revisar') {
    const falta = cuerpo.publicacion.atributos.filter(a => a.requerido && !a.valor).map(a => a.nombre);
    return falta.length
      ? { ok: false, fotos: cuerpo.fotos.map((_, i) => `demo-${i}`), errores: [`Falta completar: ${falta.join(', ')}.`] }
      : { ok: true, fotos: cuerpo.fotos.map((_, i) => `demo-${i}`),
          avisos: cuerpo.publicacion.envio === 'retiro' ? [] : ['Este producto no entra en Mercado Envíos (por tamaño o categoría): el envío queda a acordar con el comprador.'] };
  }
  if (ruta === '/api/publicar') return { id: 'MLA-DEMO', permalink: 'https://www.mercadolibre.com.ar', estado: 'demo' };

  const regs = demoRegs();
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

if (DEMO) document.title = 'VendeloYa (demo)';
dibujarFotos();
refrescarCuenta();
cargarHistorial();
// Si había algo abierto (se recargó la página o se cerró la app), se retoma.
if (local('vendeloya.actual') && (clave() || DEMO)) abrirRegistro(local('vendeloya.actual'), { silencioso: true });
if ('serviceWorker' in navigator && !DEMO) navigator.serviceWorker.register('sw.js').catch(() => {});
