/* respaldo.js — qué se importa de un archivo de respaldo del historial (el JSON que baja
   "Descargar mi historial"). Sin red ni DOM, para poder probarlo con node (test.mjs).
   Regla: nunca pisa un registro que ya existe; solo se cargan los campos que el Worker guarda. */
(function (raiz) {
  const ID_VALIDO = /^[a-zA-Z0-9-]{8,64}$/;
  const CAMPOS = ['fotos', 'thumb', 'analisis', 'publicacion', 'estado', 'ml'];
  const MAX_REGISTROS = 200;   // lo mismo que guarda el Worker en el historial

  /**
   * @param archivo   lo que salió de JSON.parse del archivo
   * @param idsExistentes  ids que ya están en el historial (Set o array)
   * @returns {{ ok:boolean, error?:string, importar:{id:string,cambios:object}[], yaExistian:string[], invalidos:{n:number,motivo:string}[] }}
   */
  function planImportacion(archivo, idsExistentes) {
    const vacio = { importar: [], yaExistian: [], invalidos: [] };
    if (!archivo || typeof archivo !== 'object' || archivo.app !== 'VendeloYa') {
      return { ok: false, error: 'Ese archivo no es un respaldo de VendeloYa.', ...vacio };
    }
    if (!Array.isArray(archivo.registros)) return { ok: false, error: 'El respaldo no trae registros.', ...vacio };
    if (archivo.registros.length > MAX_REGISTROS) {
      return { ok: false, error: `El respaldo trae ${archivo.registros.length} registros; el máximo es ${MAX_REGISTROS}.`, ...vacio };
    }
    const existentes = new Set(idsExistentes || []);
    const vistos = new Set();
    const plan = { ok: true, ...vacio };
    archivo.registros.forEach((r, i) => {
      const n = i + 1;
      if (!r || typeof r !== 'object' || Array.isArray(r)) { plan.invalidos.push({ n, motivo: 'no es un registro' }); return; }
      if (typeof r.id !== 'string' || !ID_VALIDO.test(r.id)) { plan.invalidos.push({ n, motivo: 'id inválido' }); return; }
      if (vistos.has(r.id)) { plan.invalidos.push({ n, motivo: 'id repetido en el archivo' }); return; }
      vistos.add(r.id);
      if (existentes.has(r.id)) { plan.yaExistian.push(r.id); return; }
      if ('fotos' in r && !Array.isArray(r.fotos)) { plan.invalidos.push({ n, motivo: 'fotos con formato inválido' }); return; }
      const cambios = {};
      for (const c of CAMPOS) if (c in r) cambios[c] = r[c];
      if (!Object.keys(cambios).length) { plan.invalidos.push({ n, motivo: 'registro vacío' }); return; }
      plan.importar.push({ id: r.id, cambios });
    });
    return plan;
  }

  /** Frase para el aviso en pantalla. */
  function resumenImportacion(plan, hechos) {
    const plural = (k, a, b) => `${k} ${k === 1 ? a : b}`;
    const partes = [`${plural(hechos, 'registro cargado', 'registros cargados')}`];
    if (plan.yaExistian.length) partes.push(`${plural(plan.yaExistian.length, 'ya estaba', 'ya estaban')} (no se pisan)`);
    if (plan.invalidos.length) partes.push(`${plural(plan.invalidos.length, 'inválido descartado', 'inválidos descartados')}`);
    return partes.join(' · ');
  }

  const api = { planImportacion, resumenImportacion };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Respaldo = api;
})(typeof window !== 'undefined' ? window : globalThis);
