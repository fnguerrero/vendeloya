/* ============================================================
   app.js — la PWA de VendeloYa.

   Fotos → Analizar (el Worker llama a Claude y a MercadoLibre) →
   revisión editable → Revisar (validador de MercadoLibre, no publica)
   → Publicar (con confirmación).

   ?demo=1 corre sin Worker, con respuestas de mentira, para probar la
   pantalla sin gastar ni publicar nada.
   ============================================================ */

const $ = id => document.getElementById(id);
const DEMO = new URLSearchParams(location.search).has('demo');
const MAX_FOTOS = 6;
const LADO_FOTO = 1200;   // lo que recomienda MercadoLibre; también alcanza para Claude
const LADO_MINIMO = 500;  // debajo de esto MercadoLibre la deja chica y baja la calidad

const estado = {
  fotos: [],          // { dataUrl, id? }  el id lo da MercadoLibre al subirla
  analisis: null,     // respuesta de /api/analizar
  atributos: [],
  revisada: false     // true solo si el validador dio OK y no se tocó nada después
};

/* ---------- utilidades ---------- */

function clave() {
  try { return localStorage.getItem('vendeloya.clave') || ''; } catch { return ''; }
}

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

async function api(ruta, cuerpo) {
  if (DEMO) return apiDemo(ruta, cuerpo);
  // El estado se pide igual sin clave: así se entera de si al Worker le faltan secretos.
  if (!clave() && ruta !== '/api/estado') {
    $('ajustes').open = true;
    throw new Error('Cargá la clave de la app en Ajustes.');
  }
  const res = await fetch(window.VENDELOYA.worker + ruta, {
    method: cuerpo ? 'POST' : 'GET',
    headers: { 'x-clave': clave(), ...(cuerpo ? { 'content-type': 'application/json' } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 409) refrescarCuenta();
    throw Object.assign(new Error(datos.error || `Error ${res.status}`), { faltan: datos.faltan });
  }
  return datos;
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
  } catch (err) {
    b.dataset.faltan = err.faltan ? err.faltan.join(', ') : '';
    b.textContent = err.faltan ? 'Falta configurar' : clave() ? 'Sin conexión' : 'Falta la clave';
    b.classList.remove('conectada');
    b.dataset.conectada = '';
  }
}

$('cuenta').addEventListener('click', () => {
  if (DEMO) return;
  if ($('cuenta').dataset.faltan) {
    alert(`Al Worker le faltan estos secretos: ${$('cuenta').dataset.faltan}.\nSe cargan con tools/cargar-secretos.ps1 (está en el README).`);
    return;
  }
  if (!clave()) { $('ajustes').open = true; $('clave').focus(); return; }
  if ($('cuenta').dataset.conectada && !confirm('La cuenta ya está conectada. ¿Volver a conectarla?')) return;
  window.open(`${window.VENDELOYA.worker}/oauth/start?k=${encodeURIComponent(clave())}`, '_blank', 'noopener');
});
// Al volver de la pestaña de MercadoLibre, se mira si quedó conectada.
document.addEventListener('visibilitychange', () => { if (!document.hidden) refrescarCuenta(); });

$('guardar-clave').addEventListener('click', () => {
  try { localStorage.setItem('vendeloya.clave', $('clave').value.trim()); } catch {}
  $('clave').value = '';
  $('ajustes').open = false;
  refrescarCuenta();
});

/* ---------- fotos ---------- */

function redimensionar(archivo) {
  return new Promise((ok, mal) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const escala = Math.min(1, LADO_FOTO / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * escala);
      cv.height = Math.round(img.height * escala);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      ok({ dataUrl: cv.toDataURL('image/jpeg', 0.85), chica: Math.max(img.width, img.height) < LADO_MINIMO });
    };
    img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('No se pudo leer la foto.')); };
    img.src = url;
  });
}

async function agregarFotos(archivos) {
  let chicas = 0;
  for (const a of archivos) {
    if (estado.fotos.length >= MAX_FOTOS) break;
    try {
      const { dataUrl, chica } = await redimensionar(a);
      estado.fotos.push({ dataUrl });
      if (chica) chicas++;
    } catch (e) { alert(e.message); }
  }
  if (chicas) alert('Alguna foto es chica (menos de 500 px). MercadoLibre la va a mostrar con baja calidad.');
  tocado();
  dibujarFotos();
}

function dibujarFotos() {
  const cont = $('miniaturas');
  cont.replaceChildren(...estado.fotos.map((f, i) => {
    const d = document.createElement('div');
    d.className = 'miniatura';
    const img = document.createElement('img');
    img.src = f.dataUrl;
    img.alt = `Foto ${i + 1}`;
    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '×';
    x.setAttribute('aria-label', `Sacar foto ${i + 1}`);
    x.onclick = () => { estado.fotos.splice(i, 1); tocado(); dibujarFotos(); };
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
    mostrarRevision(r);
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

function mostrarRevision(r) {
  const p = r.propuesta;
  $('titulo').value = p.titulo;
  $('condicion').value = p.condicion;
  $('precio').value = p.precio;
  $('descripcion').value = p.descripcion;
  $('garantia').value = p.garantia;
  $('cantidad').value = 1;

  $('categoria').replaceChildren(...r.categorias.map(c => opcion(c.id, c.nombre, c.id === r.categoria.id)));
  dibujarCategoria(r.categoria, r.atributos, p.tipoPublicacion);

  const pr = r.precio;
  $('precio-fuente').textContent = pr.fuente === 'mercadolibre'
    ? `Mediana de ${pr.muestras} publicaciones parecidas (entre ${pesos(pr.min)} y ${pesos(pr.max)}).`
    : `Estimado por la IA, entre ${pesos(pr.min)} y ${pesos(pr.max)}. No hubo datos de MercadoLibre (${pr.motivo || 'sin búsqueda'}): conviene chequearlo.`;

  const id = r.identificacion;
  const lista = [`Estado: ${id.estado_detalle}`, ...id.advertencias];
  if (id.confianza !== 'alta') lista.unshift(`La IA tiene confianza ${id.confianza} en lo que identificó.`);
  avisos($('avisos-ia'), '', `Identificado: ${id.producto}`, lista);

  $('resultado-revision').hidden = true;
  $('paso-revision').hidden = false;
  $('paso-revision').scrollIntoView({ behavior: 'smooth' });
  tocado();
}

function dibujarCategoria(categoria, atributos, tipoElegido) {
  estado.atributos = atributos;
  estado.categoria = categoria;
  actualizarContador();

  const tipos = categoria.tiposPublicacion.length ? categoria.tiposPublicacion : [{ id: 'gold_special', nombre: 'Clásica' }];
  const elegido = tipos.some(t => t.id === tipoElegido) ? tipoElegido : tipos[0].id;
  $('tipo').replaceChildren(...tipos.map(t => opcion(t.id, t.nombre, t.id === elegido)));

  $('atributos').replaceChildren(...atributos.map(a => {
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
  }));
}

$('categoria').addEventListener('change', async () => {
  esperar('Trayendo la ficha de esa categoría…');
  try {
    const r = await api('/api/categoria', { categoria: $('categoria').value, identificacion: estado.analisis.identificacion });
    dibujarCategoria(r.categoria, r.atributos, $('tipo').value);
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

/* Cualquier cambio después de revisar obliga a revisar de nuevo. */
function tocado() {
  estado.revisada = false;
  $('publicar').disabled = true;
}
$('paso-revision').addEventListener('input', tocado);
$('paso-revision').addEventListener('change', tocado);

/* ---------- revisar y publicar ---------- */

function leerPublicacion() {
  const valores = new Map([...$('atributos').querySelectorAll('[data-id]')].map(c => [c.dataset.id, c.value.trim()]));
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
    descripcion: $('descripcion').value,
    maxTitulo: estado.categoria?.maxTitulo || 60,
    pideGtin: !!estado.categoria?.pideGtin,
    atributos: estado.atributos.map(a => ({ ...a, valor: valores.get(a.id) || '' }))
  };
}

const fotosParaEnviar = () => estado.fotos.map(f => (f.id ? { id: f.id } : { dataUrl: f.dataUrl }));

/** Las fotos que ya subió MercadoLibre no se vuelven a subir. */
function guardarIdsDeFotos(ids = []) {
  ids.forEach((id, i) => { if (estado.fotos[i]) estado.fotos[i].id = id; });
}

$('revisar').addEventListener('click', async () => {
  esperar('MercadoLibre está revisando la publicación…');
  try {
    const r = await api('/api/revisar', { publicacion: leerPublicacion(), fotos: fotosParaEnviar() });
    guardarIdsDeFotos(r.fotos);
    if (r.ok) {
      avisos($('resultado-revision'), 'ok', 'MercadoLibre la aceptó. No se publicó nada todavía.');
      estado.revisada = true;
      $('publicar').disabled = false;
    } else {
      avisos($('resultado-revision'), 'error', 'MercadoLibre pide corregir esto:', r.errores);
    }
  } catch (e) {
    avisos($('resultado-revision'), 'error', e.message);
  } finally {
    esperar('');
  }
});

$('publicar').addEventListener('click', () => {
  if (!estado.revisada) return;
  const p = leerPublicacion();
  $('confirmar-texto').textContent = `"${p.titulo}" a ${pesos(p.precio)}, ${p.cantidad} unidad${p.cantidad > 1 ? 'es' : ''}, ${$('tipo').selectedOptions[0]?.textContent || ''}.`;
  $('confirmar').showModal();
});
$('confirmar-no').addEventListener('click', () => $('confirmar').close());

$('confirmar-si').addEventListener('click', async () => {
  $('confirmar').close();
  esperar('Publicando…');
  try {
    const r = await api('/api/publicar', { publicacion: leerPublicacion(), fotos: fotosParaEnviar() });
    $('listo-texto').textContent = `Quedó publicada (${r.id}, estado ${r.estado}).${r.avisoDescripcion ? ' ' + r.avisoDescripcion : ''}`;
    $('listo-link').href = r.permalink;
    $('paso-fotos').hidden = true;
    $('paso-revision').hidden = true;
    $('paso-listo').hidden = false;
  } catch (e) {
    avisos($('resultado-revision'), 'error', `No se publicó: ${e.message}`);
  } finally {
    esperar('');
  }
});

function empezarDeNuevo() {
  estado.fotos = [];
  estado.analisis = null;
  estado.atributos = [];
  dibujarFotos();
  tocado();
  $('paso-revision').hidden = true;
  $('paso-listo').hidden = true;
  $('paso-fotos').hidden = false;
  scrollTo({ top: 0 });
}
$('empezar').addEventListener('click', () => { if (confirm('¿Descartar esta publicación?')) empezarDeNuevo(); });
$('otra').addEventListener('click', empezarDeNuevo);

/* ---------- modo demo ---------- */

async function apiDemo(ruta, cuerpo) {
  await new Promise(r => setTimeout(r, 600));
  const atributos = [
    { id: 'BRAND', nombre: 'Marca', tipo: 'string', requerido: true, unidades: [], opciones: [], valor: 'Black+Decker' },
    { id: 'MODEL', nombre: 'Modelo', tipo: 'string', requerido: true, unidades: [], opciones: [], valor: '' },
    { id: 'POWER', nombre: 'Potencia', tipo: 'number_unit', requerido: false, unidades: ['W'], opciones: [], valor: '500 W' },
    { id: 'COLOR', nombre: 'Color', tipo: 'list', requerido: false, unidades: [], opciones: [{ id: '1', nombre: 'Naranja' }, { id: '2', nombre: 'Negro' }], valor: 'Naranja' }
  ];
  const categoria = { id: 'MLA5232', nombre: 'Herramientas › Taladros › De Mano', maxTitulo: 60, pideGtin: true,
    tiposPublicacion: [{ id: 'gold_special', nombre: 'Clásica' }, { id: 'gold_pro', nombre: 'Premium' }, { id: 'free', nombre: 'Gratuita' }] };
  if (ruta === '/api/estado') return { conectado: true, nickname: 'DEMO (sin cuenta)', userProducts: true };
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
      : { ok: true, fotos: cuerpo.fotos.map((_, i) => `demo-${i}`) };
  }
  if (ruta === '/api/publicar') return { id: 'MLA-DEMO', permalink: 'https://www.mercadolibre.com.ar', estado: 'demo (no se publicó nada)' };
  throw new Error('Ruta demo desconocida');
}

/* ---------- arranque ---------- */

if (DEMO) document.title = 'VendeloYa (demo)';
dibujarFotos();
refrescarCuenta();
if ('serviceWorker' in navigator && !DEMO) navigator.serviceWorker.register('sw.js').catch(() => {});
