// Valida contra la cuenta REAL las preguntas sin responder (GET /my/received_questions/search) y,
// con --borrador, el borrador de respuesta de la IA para la primera. NO responde nada: no se hace
// ningún POST a /answers. No imprime textos de preguntas ni de borradores, solo forma y largos.
//   $env:VENDELOYA_CLAVE = Read-Host "Clave de la app"
//   node "W:\Working Folder Personal\Apps\VendeloYa\tools\validar-preguntas.mjs" [--borrador]
import { pedir, forma } from './_cliente.mjs';

const r = await pedir('/api/preguntas');
console.log('GET /api/preguntas ->', r.status);
if (r.status !== 200) { console.log(JSON.stringify(r.datos)); process.exit(1); }
const ps = r.datos.preguntas || [];
console.log('preguntas sin responder:', ps.length);
console.log('forma de una pregunta:', JSON.stringify(ps[0] ? forma(ps[0]) : '(ninguna)'));
if (process.argv.includes('--borrador')) {
  if (!ps.length) { console.log('No hay preguntas: no hay borrador para probar.'); process.exit(0); }
  const p = ps[0];
  const b = await pedir(`/api/preguntas/${p.id}/borrador`, { metodo: 'POST', cuerpo: { registroId: p.registroId, pregunta: p.texto, titulo: p.titulo } });
  console.log('POST /api/preguntas/<id>/borrador ->', b.status, b.status === 200 ? `| borrador de ${String(b.datos.texto || '').length} caracteres` : JSON.stringify(b.datos));
}
