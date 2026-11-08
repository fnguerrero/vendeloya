// Valida el refresco del token de MercadoLibre contra la cuenta REAL, solo lectura.
// Llama a /api/estado (que hace GET /users/me; si el token venció, el Worker lo renueva solo) tres
// veces a la vez y muestra cuándo vence el token y cuándo se renovó por última vez. No imprime tokens.
// Para que cuente como prueba del refresco hay que correrlo con el token vencido (dura ~6 h):
//   $env:VENDELOYA_CLAVE = Read-Host "Clave de la app"
//   node "W:\Working Folder Personal\Apps\VendeloYa\tools\validar-token.mjs"
import { pedir } from './_cliente.mjs';

const tandas = await Promise.all([pedir('/api/estado'), pedir('/api/estado'), pedir('/api/estado')]);
for (const [i, r] of tandas.entries()) {
  const t = r.datos?.token;
  console.log(`#${i + 1} GET /api/estado -> ${r.status} conectado: ${r.datos?.conectado}`,
    t ? `| token vence en ${t.venceEnMin} min | último refresco: ${t.ultimoRefresco ?? 'nunca (todavía no hizo falta)'}` : '| sin datos de token (¿Worker sin desplegar?)');
}
const ok = tandas.every(r => r.status === 200 && r.datos?.conectado);
console.log(ok ? 'OK: las 3 llamadas simultáneas respondieron 200.' : 'FALLÓ: alguna llamada no dio 200 conectado.');
