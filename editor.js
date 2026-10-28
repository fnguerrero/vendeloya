/* ============================================================
   editor.js — el editor de fotos de VendeloYa.

   Recortar (con proporciones), girar, ajustar brillo / contraste /
   saturación / nitidez y mover la foto (portada, orden, sacar).
   Todo es manual: nada se mejora solo, y la foto original queda
   guardada para poder volver a ella.

   Usa lo de app.js (estado, MAX_FOTOS, LADO_FOTO, LADO_MINIMO,
   hacerPortada, moverFoto, fotosCambiaron, toast, $).
   ============================================================ */

const AJUSTES_CERO = { brillo: 0, contraste: 0, saturacion: 0, nitidez: 0 };
const LADO_VISTA = 900;       // la vista previa se trabaja más chica, para que los controles respondan rápido
const MIN_RECORTE = 28;       // lado mínimo del recorte en la vista (px)

const editor = {
  idx: -1,
  trabajo: null,        // canvas con la foto (ya girada), en tamaño real
  vista: null,          // canvas chico para mostrar
  base: null,           // píxeles de la vista sin ajustes
  escala: 1,            // trabajo → vista
  recorte: { x: 0, y: 0, w: 1, h: 1 },   // en fracciones de la foto
  aspecto: null,        // ancho / alto, o null si es libre
  ajustes: { ...AJUSTES_CERO },
  girado: false,        // se giró la foto en esta edición
  pendiente: 0
};

/* ---------- lienzos ---------- */

const nuevoLienzo = (w, h) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};

function cargarImagen(url) {
  return new Promise((ok, mal) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => mal(new Error('No se pudo abrir la foto.'));
    img.src = url;
  });
}

/* ---------- ajustes de color (manuales) ---------- */

const hayAjustes = a => a.brillo || a.contraste || a.saturacion || a.nitidez;

/** Aplica brillo, contraste, saturación y nitidez sobre los píxeles (ImageData). */
function aplicarAjustes(datos, a) {
  const d = datos.data;
  const suma = a.brillo * 2.55;
  const c = a.contraste * 2.55;
  const factor = (259 * (c + 255)) / (255 * (259 - c));
  const sat = 1 + a.saturacion / 100;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    r = factor * (r + suma - 128) + 128;
    g = factor * (g + suma - 128) + 128;
    b = factor * (b + suma - 128) + 128;
    const gris = 0.299 * r + 0.587 * g + 0.114 * b;
    d[i] = Math.max(0, Math.min(255, gris + (r - gris) * sat));
    d[i + 1] = Math.max(0, Math.min(255, gris + (g - gris) * sat));
    d[i + 2] = Math.max(0, Math.min(255, gris + (b - gris) * sat));
  }
  if (a.nitidez > 0) afilar(datos, (a.nitidez / 100) * 1.4);
  return datos;
}

/** Máscara de nitidez: original + cantidad × (original − desenfoque 3×3). */
function afilar(datos, cantidad) {
  const { width: w, height: h, data: d } = datos;
  const copia = new Uint8ClampedArray(d);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let k = 0; k < 3; k++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += copia[((y + dy) * w + x + dx) * 4 + k];
        d[i + k] = copia[i + k] + cantidad * (copia[i + k] - s / 9);
      }
    }
  }
}

/* ---------- vista previa ---------- */

function armarVista() {
  const t = editor.trabajo;
  const caja = $('editor-escena');
  const maxW = Math.max(200, caja.clientWidth - 8);
  const maxH = Math.max(200, Math.min(innerHeight * 0.52, 620));
  editor.escala = Math.min(1, LADO_VISTA / Math.max(t.width, t.height), maxW / t.width, maxH / t.height);
  editor.vista = nuevoLienzo(t.width * editor.escala, t.height * editor.escala);
  const v = editor.vista.getContext('2d', { willReadFrequently: true });
  v.drawImage(t, 0, 0, editor.vista.width, editor.vista.height);
  editor.base = v.getImageData(0, 0, editor.vista.width, editor.vista.height);
  const lienzo = $('editor-lienzo');
  lienzo.width = editor.vista.width;
  lienzo.height = editor.vista.height;
  lienzo.style.width = `${lienzo.width}px`;
  lienzo.style.height = `${lienzo.height}px`;
  pintarVista();
  pintarRecorte();
}

function pintarVista() {
  const lienzo = $('editor-lienzo');
  const ctx = lienzo.getContext('2d', { willReadFrequently: true });
  const copia = new ImageData(new Uint8ClampedArray(editor.base.data), editor.base.width, editor.base.height);
  ctx.putImageData(hayAjustes(editor.ajustes) ? aplicarAjustes(copia, editor.ajustes) : copia, 0, 0);
}

function pedirVista() {
  if (editor.pendiente) return;
  editor.pendiente = requestAnimationFrame(() => { editor.pendiente = 0; pintarVista(); });
}

/* ---------- recorte ---------- */

const vistaAncho = () => $('editor-lienzo').width;
const vistaAlto = () => $('editor-lienzo').height;

function pintarRecorte() {
  const r = editor.recorte;
  const el = $('editor-recorte');
  const W = vistaAncho(), H = vistaAlto();
  Object.assign(el.style, { left: `${r.x * W}px`, top: `${r.y * H}px`, width: `${r.w * W}px`, height: `${r.h * H}px` });
  // Lo que queda de recorte, en píxeles reales, para saber si la foto queda chica.
  const px = [Math.round(r.w * editor.trabajo.width), Math.round(r.h * editor.trabajo.height)];
  $('editor-medidas').textContent = `${px[0]} × ${px[1]} px`;
  $('editor-medidas').classList.toggle('chica', Math.max(...px) < LADO_MINIMO);
}

function recorteCompleto() {
  editor.recorte = { x: 0, y: 0, w: 1, h: 1 };
}

/** El rectángulo más grande con esa proporción, centrado en la foto. */
function recorteConAspecto(aspecto) {
  const W = editor.trabajo.width, H = editor.trabajo.height;
  let w = W, h = W / aspecto;
  if (h > H) { h = H; w = H * aspecto; }
  editor.recorte = { x: (W - w) / 2 / W, y: (H - h) / 2 / H, w: w / W, h: h / H };
}

function elegirAspecto(valor) {
  editor.aspecto = valor ? Number(valor) : null;
  for (const b of document.querySelectorAll('#editor [data-aspecto]')) b.classList.toggle('activo', b.dataset.aspecto === (valor || ''));
  if (editor.aspecto) recorteConAspecto(editor.aspecto);
  pintarRecorte();
}

/** Arrastrar el recorte entero o una de sus esquinas (mouse y dedo, con Pointer Events). */
function iniciarArrastre(e) {
  const asa = e.target.closest('[data-asa]')?.dataset.asa;
  const W = vistaAncho(), H = vistaAlto();
  const r0 = editor.recorte;
  const caja = { x: r0.x * W, y: r0.y * H, w: r0.w * W, h: r0.h * H };
  const inicio = { x: e.clientX, y: e.clientY };
  const escena = $('editor-lienzo').getBoundingClientRect();
  e.preventDefault();
  try { $('editor-recorte').setPointerCapture(e.pointerId); } catch { /* sin captura, el arrastre sigue por el elemento */ }

  const mover = ev => {
    const dx = ev.clientX - inicio.x, dy = ev.clientY - inicio.y;
    let x = caja.x, y = caja.y, w = caja.w, h = caja.h;
    if (!asa) {
      x = Math.max(0, Math.min(W - w, caja.x + dx));
      y = Math.max(0, Math.min(H - h, caja.y + dy));
    } else {
      // La esquina opuesta queda fija; el puntero decide la nueva.
      const fijoX = asa.includes('w') ? caja.x + caja.w : caja.x;
      const fijoY = asa.includes('n') ? caja.y + caja.h : caja.y;
      const px = Math.max(0, Math.min(W, ev.clientX - escena.left));
      const py = Math.max(0, Math.min(H, ev.clientY - escena.top));
      const sentidoX = px >= fijoX ? 1 : -1, sentidoY = py >= fijoY ? 1 : -1;
      const espacioX = sentidoX > 0 ? W - fijoX : fijoX;
      const espacioY = sentidoY > 0 ? H - fijoY : fijoY;
      w = Math.max(MIN_RECORTE, Math.min(Math.abs(px - fijoX), espacioX));
      h = Math.max(MIN_RECORTE, Math.min(Math.abs(py - fijoY), espacioY));
      if (editor.aspecto) {
        w = Math.min(w, h * editor.aspecto, espacioY * editor.aspecto);
        w = Math.max(w, MIN_RECORTE);
        h = w / editor.aspecto;
      }
      x = sentidoX > 0 ? fijoX : fijoX - w;
      y = sentidoY > 0 ? fijoY : fijoY - h;
    }
    editor.recorte = { x: x / W, y: y / H, w: w / W, h: h / H };
    pintarRecorte();
  };
  const soltar = () => {
    $('editor-recorte').removeEventListener('pointermove', mover);
    $('editor-recorte').removeEventListener('pointerup', soltar);
    $('editor-recorte').removeEventListener('pointercancel', soltar);
  };
  $('editor-recorte').addEventListener('pointermove', mover);
  $('editor-recorte').addEventListener('pointerup', soltar);
  $('editor-recorte').addEventListener('pointercancel', soltar);
}
$('editor-recorte').addEventListener('pointerdown', iniciarArrastre);

/* ---------- girar y restablecer ---------- */

function girarTrabajo(sentido) {
  const t = editor.trabajo;
  const g = nuevoLienzo(t.height, t.width);
  const c = g.getContext('2d');
  if (sentido > 0) { c.translate(g.width, 0); c.rotate(Math.PI / 2); } else { c.translate(0, g.height); c.rotate(-Math.PI / 2); }
  c.drawImage(t, 0, 0);
  editor.trabajo = g;
  recorteCompleto();
  editor.aspecto = null;
  elegirAspecto('');
  armarVista();
}

async function cargarTrabajo(url) {
  const img = await cargarImagen(url);
  const t = nuevoLienzo(img.naturalWidth, img.naturalHeight);
  t.getContext('2d').drawImage(img, 0, 0);
  editor.trabajo = t;
}

function pintarAjustes() {
  for (const [clave, valor] of Object.entries(editor.ajustes)) {
    $(`aj-${clave}`).value = valor;
    $(`aj-${clave}`).nextElementSibling.textContent = valor;
  }
}

async function restablecer() {
  const f = estado.fotos[editor.idx];
  editor.ajustes = { ...AJUSTES_CERO };
  pintarAjustes();
  await cargarTrabajo(f.dataUrl);
  recorteCompleto();
  elegirAspecto('');
  armarVista();
}

/* ---------- abrir y aplicar ---------- */

async function abrirEditor(i) {
  const f = estado.fotos[i];
  if (!f) return;
  editor.idx = i;
  editor.girado = false;
  $('editor').showModal();
  try {
    await restablecer();
  } catch (e) {
    $('editor').close();
    toast(e.message);
    return;
  }
  pintarOrden();
}

/** Lo que dicen los botones de orden y de "volver a la original". */
function pintarOrden() {
  const i = editor.idx, n = estado.fotos.length;
  const enRevision = !$('paso-revision').hidden;
  $('editor-titulo').textContent = `Foto ${i + 1} de ${n}${i === 0 ? ' · portada' : ''}`;
  $('editor-antes').disabled = i === 0;
  $('editor-despues').disabled = i === n - 1;
  $('editor-portada').disabled = i === 0;
  $('editor-sacar').disabled = enRevision && n <= 1;
  $('editor-original').hidden = !estado.fotos[i]?.original;
}

function exportar() {
  const t = editor.trabajo, r = editor.recorte;
  const sx = Math.round(r.x * t.width), sy = Math.round(r.y * t.height);
  const sw = Math.max(1, Math.round(r.w * t.width)), sh = Math.max(1, Math.round(r.h * t.height));
  const esc = Math.min(1, LADO_FOTO / Math.max(sw, sh));
  const salida = nuevoLienzo(sw * esc, sh * esc);
  const c = salida.getContext('2d', { willReadFrequently: true });
  c.drawImage(t, sx, sy, sw, sh, 0, 0, salida.width, salida.height);
  if (hayAjustes(editor.ajustes)) c.putImageData(aplicarAjustes(c.getImageData(0, 0, salida.width, salida.height), editor.ajustes), 0, 0);
  return salida.toDataURL('image/jpeg', 0.9);
}

/** ¿Hay algo para aplicar? (recorte, ajustes o giro respecto de lo que está en la foto). */
function huboCambios() {
  const r = editor.recorte;
  return !!(hayAjustes(editor.ajustes) || editor.girado || r.x > 0.0005 || r.y > 0.0005 || r.w < 0.999 || r.h < 0.999);
}

function aplicarEdicion() {
  const f = estado.fotos[editor.idx];
  if (!f || !huboCambios()) { $('editor').close(); return; }
  const url = exportar();
  f.original = f.original || f.dataUrl;   // la primera vez se guarda la original
  f.dataUrl = url;
  delete f.id;                            // cambió: MercadoLibre la tiene que volver a subir
  editor.girado = false;
  $('editor').close();
  fotosCambiaron({ portada: editor.idx === 0 });
  toast('Foto editada. Podés volver a la original cuando quieras.');
}

/* ---------- eventos ---------- */

$('editor-cancelar').addEventListener('click', () => $('editor').close());
$('editor-aplicar').addEventListener('click', aplicarEdicion);
$('editor-izq').addEventListener('click', () => { editor.girado = true; girarTrabajo(-1); });
$('editor-der').addEventListener('click', () => { editor.girado = true; girarTrabajo(1); });
$('editor-restablecer').addEventListener('click', () => { editor.girado = false; restablecer(); });
for (const b of document.querySelectorAll('#editor [data-aspecto]')) b.addEventListener('click', () => elegirAspecto(b.dataset.aspecto));
for (const clave of Object.keys(AJUSTES_CERO)) {
  $(`aj-${clave}`).addEventListener('input', e => {
    editor.ajustes[clave] = Number(e.target.value);
    e.target.nextElementSibling.textContent = e.target.value;
    pedirVista();
  });
}
// Doble toque en el control: vuelve a cero.
for (const clave of Object.keys(AJUSTES_CERO)) {
  $(`aj-${clave}`).addEventListener('dblclick', e => {
    e.target.value = 0;
    e.target.dispatchEvent(new Event('input'));
  });
}

$('editor-original').addEventListener('click', () => {
  const f = estado.fotos[editor.idx];
  if (!f?.original) return;
  f.dataUrl = f.original;
  delete f.original;
  delete f.id;
  $('editor').close();
  fotosCambiaron({ portada: editor.idx === 0 });
  toast('Volviste a la foto original.');
});

function moverDesdeEditor(de, a) {
  moverFoto(de, a);
  editor.idx = a;
  fotosCambiaron({ portada: de === 0 || a === 0 });
  pintarOrden();
}
$('editor-antes').addEventListener('click', () => moverDesdeEditor(editor.idx, editor.idx - 1));
$('editor-despues').addEventListener('click', () => moverDesdeEditor(editor.idx, editor.idx + 1));
$('editor-portada').addEventListener('click', () => moverDesdeEditor(editor.idx, 0));
$('editor-sacar').addEventListener('click', () => {
  estado.fotos.splice(editor.idx, 1);
  $('editor').close();
  fotosCambiaron({ portada: editor.idx === 0 });
  toast('Foto sacada.');
});

// Al girar la ventana o cambiar el tamaño, la vista se recalcula.
addEventListener('resize', () => { if ($('editor').open && editor.trabajo) armarVista(); });
