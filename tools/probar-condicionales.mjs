// Sonda de SOLO LECTURA para los atributos condicionales de MercadoLibre. Llama a /api/condicionales del Worker
// desplegado, que a su vez hace POST /categories/{id}/attributes/conditional (una consulta de reglas: no crea,
// no cambia ni publica nada). Sirve para confirmar, una vez, cómo contesta ML de verdad:
//   - estado 200 y `requeridos` con ids  -> el endpoint existe y la app ya avisa lo que pasa a ser obligatorio;
//   - estado 404/405                    -> ML no lo ofrece: la función se apaga sola y la app sigue como siempre;
//   - otro estado                       -> se reintenta la próxima vez.
//
//   $env:VENDELOYA_CLAVE = Read-Host "Clave de la app"
//   node "W:\Working Folder Personal\Apps\VendeloYa\tools\probar-condicionales.mjs"            (taladro, MLA5232)
//   node "W:\Working Folder Personal\Apps\VendeloYa\tools\probar-condicionales.mjs" MLA109027   (otra categoría)
import { pedir } from './_cliente.mjs';

const categoria = process.argv[2] || 'MLA5232';
const atributos = [
  { id: 'BRAND', valor: 'Black+Decker', opciones: [] },
  { id: 'ITEM_CONDITION', valor: 'Usado', opciones: [] }
];
const r = await pedir('/api/condicionales', { metodo: 'POST', cuerpo: { categoria, atributos } });
const d = r.datos || {};
console.log(`Categoría ${categoria} -> HTTP ${r.status}`);
if (r.status !== 200) { console.log('Error del Worker:', d.error || JSON.stringify(d).slice(0, 200)); process.exit(1); }
console.log(`disponible: ${d.disponible}${d.estado ? ` (ML contestó ${d.estado})` : ''}`);
console.log(`atributos que pasan a ser obligatorios: ${(d.requeridos || []).join(', ') || 'ninguno'}`);
