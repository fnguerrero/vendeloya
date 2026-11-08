// Valida contra la cuenta REAL (solo lectura) el seguimiento de publicaciones: estado, vendidas,
// disponibles, precio, visitas y preguntas, con GET /items, /visits/items y /my/received_questions.
// Muestra la forma del dato y cuántos registros trae, sin títulos ni datos personales.
//   $env:VENDELOYA_CLAVE = Read-Host "Clave de la app"
//   node "W:\Working Folder Personal\Apps\VendeloYa\tools\validar-seguimiento.mjs"
import { pedir, forma } from './_cliente.mjs';

const r = await pedir('/api/seguimiento?forzar=1');
console.log('GET /api/seguimiento?forzar ->', r.status);
if (r.status !== 200) { console.log(JSON.stringify(r.datos)); process.exit(1); }
const regs = Object.values(r.datos.registros || {});
console.log('registros publicados con datos:', regs.length);
const estados = {};
for (const x of regs) estados[x.estado] = (estados[x.estado] || 0) + 1;
console.log('estados:', JSON.stringify(estados));
console.log('forma de un registro:', JSON.stringify(regs[0] ? forma(regs[0]) : '(ninguno)'));
const faltan = regs.filter(x => x.visitas === null).length;
console.log(`con visitas informadas: ${regs.length - faltan} de ${regs.length}`);
