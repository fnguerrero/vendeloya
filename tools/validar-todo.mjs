// Corre de una sola vez todas las validaciones contra la cuenta REAL de MercadoLibre, pasando por el Worker
// desplegado, y deja un resumen. Es para confirmar rápido que todo anda antes de publicar de verdad.
//
// Qué hace cada paso (todos de solo lectura, salvo la foto de prueba del lote, que NO publica nada):
//   1. token        GET /users/me (renueva el token si venció)
//   2. comisión     GET /sites/MLA/listing_prices
//   3. preguntas    GET de las preguntas sin responder (no responde nada)
//   4. seguimiento  GET de estado, vendidas, stock, visitas (no cambia nada)
//   5. condicionales consulta de reglas de atributos (no escribe nada)
//   6. lote         valida 8 borradores de prueba con /items/validate; sube UNA foto de prueba y no publica
//
// La clave de la app se pide por teclado (no se imprime):
//   $env:VENDELOYA_CLAVE = [Net.NetworkCredential]::new('', (Read-Host "Clave de la app" -AsSecureString)).Password
//   node "W:\Working Folder Personal\Apps\VendeloYa\tools\validar-todo.mjs"
//   (con --sin-lote se saltea el paso 6, el único que sube una foto de prueba)
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pedir } from './_cliente.mjs';

if (!process.env.VENDELOYA_CLAVE) {
  console.error('Falta la variable VENDELOYA_CLAVE. En PowerShell:\n  $env:VENDELOYA_CLAVE = [Net.NetworkCredential]::new(\'\', (Read-Host "Clave de la app" -AsSecureString)).Password');
  process.exit(1);
}

// Antes de todo, se comprueba la clave: con una clave mala algunos pasos terminan "sin error" aunque no hayan validado nada.
const previo = await pedir('/api/estado');
if (previo.status === 401) { console.error('La clave de la app no es correcta (el Worker contestó 401). Volvé a cargarla y probá de nuevo.'); process.exit(1); }
if (previo.status !== 200) { console.error(`El Worker no contestó bien (HTTP ${previo.status}). Probá en unos minutos.`); process.exit(1); }
if (!previo.datos?.conectado) console.log('Aviso: la cuenta de MercadoLibre figura desconectada; la mayoría de los pasos van a fallar. Reconectala desde Ajustes en la app.');

const sinLote = process.argv.includes('--sin-lote');
const pasos = [
  ['token', 'validar-token.mjs'],
  ['comisión', 'validar-comision.mjs'],
  ['preguntas', 'validar-preguntas.mjs'],
  ['seguimiento', 'validar-seguimiento.mjs'],
  ['condicionales', 'probar-condicionales.mjs'],
  ...(sinLote ? [] : [['lote', 'validar-lote.mjs']])
];

const resultados = [];
for (const [nombre, archivo] of pasos) {
  console.log(`\n${'='.repeat(70)}\n${nombre.toUpperCase()}  (${archivo})\n${'='.repeat(70)}`);
  const r = spawnSync(process.execPath, [fileURLToPath(new URL(archivo, import.meta.url))], { stdio: 'inherit', env: process.env });
  resultados.push({ nombre, codigo: r.status ?? 1 });
}

console.log(`\n${'='.repeat(70)}\nRESUMEN\n${'='.repeat(70)}`);
for (const { nombre, codigo } of resultados) console.log(`${codigo === 0 ? 'sin error' : 'REVISAR  '}  ${nombre}${codigo === 0 ? '' : ` (terminó con código ${codigo}: mirá lo que imprimió arriba)`}`);
if (sinLote) console.log('(el lote de 8 rubros se salteó por --sin-lote)');
const fallaron = resultados.filter(r => r.codigo !== 0).length;
console.log(fallaron ? `\n${fallaron} paso${fallaron > 1 ? 's' : ''} para revisar. Pasame la salida completa.` : '\nNingún paso terminó con error. Igual mirá lo que imprimió cada uno; en el lote tiene que decir "8 de 8 validados".');
process.exit(fallaron ? 1 : 0);
