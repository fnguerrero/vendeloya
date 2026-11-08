// Graba respuestas REALES de las lecturas públicas de MercadoLibre (sin token, sin cuenta) para
// que los tests de contrato corran contra la forma verdadera y no contra datos inventados.
//   node "W:\Working Folder Personal\Apps\VendeloYa\tools\grabar-fixtures.mjs"
// Escribe worker\fixtures\contrato-ml.json. Solo GET públicos.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ML = 'https://api.mercadolibre.com';
const BUSQUEDAS = ['taladro percutor', 'zapatillas running hombre', 'mesa ratona de madera', 'cochecito de bebé', 'auriculares bluetooth', 'bicicleta rodado 29', 'libro usado novela', 'heladera no frost'];

async function leer(ruta) {
  const r = await fetch(ML + ruta, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${ruta} → ${r.status}`);
  return r.json();
}

const casos = [];
for (const q of BUSQUEDAS) {
  const discovery = await leer(`/sites/MLA/domain_discovery/search?limit=3&q=${encodeURIComponent(q)}`);
  if (!discovery.length) { console.log('sin categoría para', q); continue; }
  const id = discovery[0].category_id;
  const [categoria, atributos] = await Promise.all([leer(`/categories/${id}`), leer(`/categories/${id}/attributes`)]);
  casos.push({ busqueda: q, discovery, categoria, atributos });
  console.log(q, '→', id, `${atributos.length} atributos`);
}

const salida = join(dirname(fileURLToPath(import.meta.url)), '..', 'worker', 'fixtures', 'contrato-ml.json');
mkdirSync(dirname(salida), { recursive: true });
writeFileSync(salida, JSON.stringify({ grabado: new Date().toISOString(), casos }));
console.log('Escrito', salida);
