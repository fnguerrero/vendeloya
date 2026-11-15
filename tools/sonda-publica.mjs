// Sonda SIN credenciales a los endpoints públicos de MercadoLibre (solo lectura, sin cuenta ni token ni clave de la app).
// Guarda las respuestas reales en worker/fixtures/publico-ml.json para que los tests usen datos de verdad:
//   - GET  /categories/{id}                          nombre y ruta de cada categoría de moda
//   - GET  /categories/{id}/attributes               el atributo COLOR (alimenta la lista de colores)
//   - POST /categories/{id}/attributes/conditional   qué atributos pasan a ser obligatorios (es una consulta de reglas:
//                                                    no crea, no cambia ni publica nada)
//
//   node "W:\Working Folder Personal\Apps\VendeloYa\tools\sonda-publica.mjs"
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = 'https://api.mercadolibre.com';
const MODA = ['MLA109027', 'MLA109042', 'MLA414251'];   // Zapatillas, Remeras, Botas y Botinetas
const CONSULTAS = [
  { categoria: 'MLA5232', atributos: [{ id: 'BRAND', value_name: 'Black+Decker' }] },
  { categoria: 'MLA5232', atributos: [] },
  { categoria: 'MLA109027', atributos: [{ id: 'BRAND', value_name: 'Adidas' }, { id: 'GENDER', value_name: 'Hombre' }] },
  { categoria: 'MLA109027', atributos: [{ id: 'GTIN', value_name: '7790895000997' }] }
];

async function pedir(ruta, init) {
  const r = await fetch(API + ruta, init);
  const texto = await r.text();
  let cuerpo; try { cuerpo = JSON.parse(texto); } catch { cuerpo = texto.slice(0, 300); }
  return { status: r.status, cuerpo };
}

const salida = { fecha: new Date().toISOString().slice(0, 10), sinCredenciales: true, categorias: {}, condicionales: [] };

for (const id of MODA) {
  const cat = await pedir(`/categories/${id}`);
  const attrs = await pedir(`/categories/${id}/attributes`);
  const color = Array.isArray(attrs.cuerpo) ? attrs.cuerpo.find(a => a.id === 'COLOR') : null;
  salida.categorias[id] = {
    nombre: cat.cuerpo?.name, ruta: (cat.cuerpo?.path_from_root || []).map(p => p.name),
    estadoAtributos: attrs.status, totalAtributos: Array.isArray(attrs.cuerpo) ? attrs.cuerpo.length : 0, COLOR: color || null
  };
  console.log(`${id} ${cat.cuerpo?.name}: atributos HTTP ${attrs.status}, COLOR ${color ? `sí (${(color.values || []).length} valores)` : 'NO'}`);
}

for (const c of CONSULTAS) {
  const r = await pedir(`/categories/${c.categoria}/attributes/conditional`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attributes: c.atributos })
  });
  salida.condicionales.push({ categoria: c.categoria, enviado: { attributes: c.atributos }, status: r.status, respuesta: r.cuerpo });
  console.log(`conditional ${c.categoria} (${c.atributos.map(a => a.id).join(',') || 'sin atributos'}) -> HTTP ${r.status} ${JSON.stringify(r.cuerpo).slice(0, 140)}`);
}

writeFileSync(fileURLToPath(new URL('../worker/fixtures/publico-ml.json', import.meta.url)), JSON.stringify(salida, null, 1) + '\n');
console.log('Guardado en worker/fixtures/publico-ml.json');
