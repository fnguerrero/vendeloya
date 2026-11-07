// Valida contra MercadoLibre REAL (solo lectura) la comisión de /sites/MLA/listing_prices,
// pasando por el Worker desplegado (que es quien tiene el token de MercadoLibre).
// No publica ni modifica nada. La clave de la app va en la variable de entorno VENDELOYA_CLAVE
// (no se imprime). Uso:
//   $env:VENDELOYA_CLAVE = '<la APP_SECRET>'
//   node "W:\Working Folder Personal\Apps\VendeloYa\tools\validar-comision.mjs" [categoria] [precio]
const API = 'https://vendeloya.fnguerrero.workers.dev';
const ORIGEN = 'https://vendeloya-app.fnguerrero.workers.dev';
const clave = process.env.VENDELOYA_CLAVE;
if (!clave) { console.error('Falta la variable VENDELOYA_CLAVE.'); process.exit(1); }
const categoria = process.argv[2] || 'MLA5232';
const precio = process.argv[3] || '45000';

async function pedir(ruta) {
  const r = await fetch(API + ruta, { headers: { origin: ORIGEN, 'x-clave': clave } });
  return { status: r.status, cuerpo: await r.json().catch(() => null) };
}

const est = await pedir('/api/estado');
console.log('GET /api/estado ->', est.status, 'conectado:', est.cuerpo?.conectado);
const com = await pedir(`/api/comision?categoria=${categoria}&precio=${precio}`);
console.log(`GET /api/comision (${categoria}, $${precio}) ->`, com.status);
console.log(JSON.stringify(com.cuerpo, null, 2));
