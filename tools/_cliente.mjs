// Ayudas comunes de los scripts tools/validar-*.mjs: llaman al Worker desplegado con la clave de la
// app (VENDELOYA_CLAVE, que se escribe por teclado con Read-Host). Nunca imprimen la clave ni tokens.
export const API = 'https://vendeloya.fnguerrero.workers.dev';
const ORIGEN = 'https://vendeloya-app.fnguerrero.workers.dev';

export function exigirClave() {
  const clave = process.env.VENDELOYA_CLAVE;
  if (!clave) {
    console.error('Falta la variable VENDELOYA_CLAVE. En PowerShell:  $env:VENDELOYA_CLAVE = Read-Host "Clave de la app"');
    process.exit(1);
  }
  return clave;
}

export async function pedir(ruta, { metodo = 'GET', cuerpo } = {}) {
  const clave = exigirClave();
  const r = await fetch(API + ruta, {
    method: metodo,
    headers: { origin: ORIGEN, 'x-clave': clave, ...(cuerpo ? { 'content-type': 'application/json' } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });
  const texto = await r.text();
  let datos = null;
  try { datos = JSON.parse(texto); } catch { datos = { _noJson: texto.slice(0, 120) }; }
  return { status: r.status, datos };
}

/** La forma de un dato sin sus valores (strings → "string"), para mostrar evidencia sin datos personales. */
export function forma(v, profundidad = 0) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return v.length ? [forma(v[0], profundidad + 1), `… ${v.length} en total`] : [];
  if (typeof v === 'object') {
    if (profundidad > 4) return '{…}';
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, forma(x, profundidad + 1)]));
  }
  return typeof v;
}
