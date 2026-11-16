/* Panel de una publicación (el diálogo que se abre desde el historial): precio, stock, descripción, pausar, reactivar,
   marcar vendida y a qué talles va cada cambio ("Aplicar a").
   Vive aparte de app.js para poder probar el código REAL con un DOM de mentira (worker/test.mjs): todo lo que toca
   (el DOM, la API, el estado `pub`, el historial) entra por `d`. Se carga en el navegador como `crearPanelPublicacion`
   y en los tests con require. */
(function (raiz) {
  'use strict';

  function crearPanelPublicacion(d) {
    const { pub, $, api, toast, miles, ESTADOS, historialVista, cargarSeguimiento, dibujarTalles, dibujarHistorial, cargarPreguntasDe,
      rotuloDe, opcion, idsDeAlcance, aplicarEnCadaItem, textoResultado } = d;
    const ahora = d.ahora || Date.now;
    const MS_CONFIRMAR = 6000;

    const rotuloDeItem = i => rotuloDe(i) || i.id;

    /* ---- "Marcar vendida": cierra para siempre, se confirma tocando dos veces seguidas ---- */
    let armada = null;      // cuándo se tocó la primera vez (null = sin confirmación pendiente)
    let reloj = null;
    function desarmarVendida() {
      armada = null;
      if (reloj != null) { clearTimeout(reloj); reloj = null; }
      $('pub-vendida').textContent = 'Marcar vendida';
    }
    function tocarVendida() {
      if (armada != null && ahora() - armada < MS_CONFIRMAR) {
        desarmarVendida();
        return accion('vendida');
      }
      armada = ahora();
      const n = idsDelPanel().length;
      $('pub-vendida').textContent = n > 1 ? `¿Seguro? Tocá otra vez para cerrar los ${n} talles` : '¿Seguro? Tocá otra vez para cerrarla';
      if (reloj != null) clearTimeout(reloj);
      reloj = setTimeout(desarmarVendida, MS_CONFIRMAR);
      reloj?.unref?.();
    }

    /* ---- qué ítems hay y a cuáles va un cambio ---- */

    /** Los ítems de la publicación abierta: los del registro completo o, si no cargó, los del seguimiento ([] con una sola). */
    function itemsDelPanel() {
      if (pub.items.length > 1) return pub.items;
      const talles = pub.seg?.talles || [];
      return talles.length > 1 ? talles.map(t => ({ id: t.id, talle: t.talle, color: t.color })) : [];
    }
    /** A qué ítems va lo que se cambia: lo que dice el selector "Aplicar a" (por defecto, todos los talles). */
    function idsDelPanel() {
      return idsDeAlcance(itemsDelPanel(), $('pub-alcance').value, pub.seg?.mlId || pub.reg?.mlId);
    }

    /* ---- pintar ---- */

    function pintarTalles() {
      dibujarTalles($('pub-talles'), pub.items, pub.seg?.talles || []);
      $('pub-talles-caja').hidden = pub.items.length < 2;
      const sel = $('pub-alcance');
      const elegido = sel.value;
      const opciones = [opcion(`Todos los talles (${pub.items.length})`, 'todos'), ...pub.items.filter(i => i.id).map(i => opcion(`Solo ${rotuloDeItem(i)}`, i.id))];
      sel.replaceChildren(...opciones);
      sel.value = opciones.some(o => o.value === elegido) ? elegido : 'todos';
      if (sel.value !== elegido) desarmarVendida();   // cambió a qué talles va "vendida": la confirmación ya no vale
    }

    function pintar() {
      const s = pub.seg;
      const est = s?.estado || 'publicada';
      $('pub-resumen').textContent = [
        ESTADOS[est] || est,
        s?.visitas != null ? `${s.visitas} ${s.visitas === 1 ? 'visita' : 'visitas'}` : '',
        s?.vendidas ? `${s.vendidas} ${s.vendidas === 1 ? 'vendida' : 'vendidas'}` : '',
        s?.talles?.length > 1 ? `${s.talles.length} talles` : ''
      ].filter(Boolean).join(' · ');
      const cerrada = est === 'vendida' || est === 'finalizada';
      // Con varios talles el estado de arriba es el del más vivo: si alguno quedó pausado (por ejemplo tras un "reactivar"
      // que falló en uno), "Reactivar" tiene que seguir a mano aunque el agregado diga "activa".
      const hayPausados = (s?.talles || []).some(t => t.estado === 'pausada');
      $('pub-pausar').hidden = !(est === 'activa' || est === 'publicada' || est === 'en_revision');
      $('pub-reactivar').hidden = !(est === 'pausada' || hayPausados);
      $('pub-vendida').hidden = cerrada;
      $('pub-cerrada').hidden = !cerrada;
      $('pub-republicar-caja').hidden = !cerrada;
      for (const id of ['pub-precio', 'pub-precio-guardar', 'pub-stock', 'pub-stock-guardar', 'pub-descripcion', 'pub-descripcion-guardar']) $(id).disabled = cerrada;
    }

    /* ---- abrir ---- */

    async function abrir(r) {
      pub.reg = r;
      pub.seg = historialVista.seguimiento[r.id] || null;
      $('pub-titulo').textContent = r.titulo;
      $('pub-ver').href = r.permalink || '#';
      $('pub-ver').hidden = !r.permalink;
      $('pub-copiar').hidden = !r.permalink;
      $('pub-precio').value = miles(pub.seg?.precio || r.precio);
      // El stock que se muestra es el del primer ítem, no la suma de los talles; al cambiarlo se aplica a lo que se elija en "Aplicar a".
      const primero = pub.seg?.talles?.[0] || pub.seg;
      $('pub-stock').value = primero?.disponibles ? String(primero.disponibles) : '';
      $('pub-descripcion').value = '';
      pub.ficha = null;
      pub.items = [];
      // Siempre se arranca en "Todos los talles": una elección vieja ("Solo 41") no puede seguir rigiendo con la caja oculta.
      $('pub-alcance').value = 'todos';
      desarmarVendida();
      pintarTalles();
      pintar();
      $('pub').showModal();
      cargarFicha(r.id);
      await cargarPreguntasDe(r.id);
    }

    /** Lo que el historial no trae: la descripción actual y los talles que salieron (del registro completo). Es un extra. */
    async function cargarFicha(registroId) {
      try {
        const reg = await api(`/api/registros/${encodeURIComponent(registroId)}`);
        if (pub.reg?.id !== registroId) return;   // mientras tanto abrieron otra
        pub.ficha = reg;
        $('pub-descripcion').value = reg.publicacion?.descripcion || '';
        pub.items = reg.ml?.items || [];
        pintarTalles();
      } catch { /* sin la ficha igual se puede cambiar precio, estado y stock */ }
    }

    /* ---- cambiar ---- */

    /**
     * Precio, stock, descripción, pausar, reactivar o vendida: va a MercadoLibre y se refleja en el historial sin recargar.
     * Con varios talles va a todos (o al elegido), uno por uno. Todo lo que hace falta de ESTA publicación se toma antes de
     * esperar a MercadoLibre: si mientras tanto el panel pasó a otra, nada de lo de acá se vuelca sobre la otra.
     */
    async function accion(nombre, datos = {}) {
      const r = pub.reg;
      if (pub.ocupado) { toast('Esperá a que termine el cambio anterior.'); return; }
      const mlId = pub.seg?.mlId || r.mlId;
      const seg = pub.seg;          // el seguimiento de esta publicación
      const ficha = pub.ficha;      // y su ficha (borrador)
      const ids = idsDelPanel();
      if (!ids.length) { toast('Esta publicación no tiene id de MercadoLibre guardado. Tocá Actualizar y probá de nuevo.'); return; }
      const items = itemsDelPanel();
      const rotulos = Object.fromEntries(items.map(i => [i.id, rotuloDeItem(i)]));
      const varios = ids.length > 1 || !!seg?.talles;
      const abierta = () => pub.reg === r;   // el panel sigue en esta publicación
      const botones = $('pub').querySelectorAll('button');
      pub.ocupado = true;
      botones.forEach(b => { b.disabled = true; });
      try {
        const { hechos, fallos } = await aplicarEnCadaItem(ids, rotulos, id => api(`/api/publicaciones/${id}`, { accion: nombre, ...datos }));
        if (!hechos.length) { toast(textoResultado(nombre, ids.length, fallos)); return; }
        const res = hechos[0].res;
        if (nombre === 'descripcion') {
          if (abierta()) $('pub-descripcion').value = res.descripcion ?? $('pub-descripcion').value;   // ya limpia, como quedó en MercadoLibre
          // El borrador guardado también queda con la descripción nueva (si no, "Republicar" o reabrir mostraría la vieja).
          if (ficha?.publicacion) {
            try { await api(`/api/registros/${r.id}`, { publicacion: { ...ficha.publicacion, descripcion: res.descripcion } }, 'PUT'); ficha.publicacion.descripcion = res.descripcion; }
            catch { /* ya está en MercadoLibre; solo el borrador local queda con la anterior */ }
          }
        } else if (varios) {
          // Varios talles: los totales y el estado son de todos, así que se vuelven a pedir.
          if (nombre === 'stock' && res.cantidad != null && abierta()) $('pub-stock').value = String(res.cantidad);
          await cargarSeguimiento(historialVista.registros, true);
          if (abierta()) {
            pub.seg = historialVista.seguimiento[r.id] || pub.seg;
            pintarTalles();
          }
        } else {
          const nuevo = { ...(seg || {}), mlId, estado: res.estado, precio: res.precio ?? seg?.precio ?? null,
            ...(res.cantidad != null ? { disponibles: res.cantidad } : {}) };
          historialVista.seguimiento[r.id] = nuevo;
          if (abierta()) {
            pub.seg = nuevo;
            if (nombre === 'stock' && res.cantidad != null) $('pub-stock').value = String(res.cantidad);
          }
          dibujarHistorial(historialVista.registros);
        }
        toast(textoResultado(nombre, ids.length, fallos));
      } catch (e) {
        toast(e.message);
      } finally {
        pub.ocupado = false;
        botones.forEach(b => { b.disabled = false; });
        pintar();   // pinta lo que esté abierto ahora (si pasó a otra publicación, es la de ella)
      }
    }

    /** Esc o "atrás" con un cambio en marcha: se espera, para no dejar la mitad de los talles cambiados sin que se vea. */
    function alCancelar(evento) {
      if (!pub.ocupado) return;
      evento.preventDefault();
      toast('Esperá a que termine el cambio.');
    }

    return { abrir, cargarFicha, accion, itemsDelPanel, idsDelPanel, pintarTalles, pintar, tocarVendida, desarmarVendida, alCancelar, alCambiarAlcance: desarmarVendida };
  }

  const api = { crearPanelPublicacion };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.crearPanelPublicacion = crearPanelPublicacion;
})(typeof window !== 'undefined' ? window : globalThis);
