// Lote de validaciones contra MercadoLibre REAL: arma un borrador de prueba por cada rubro grabado
// en worker/fixtures/contrato-ml.json (8 rubros, mitad con retiro y mitad con Mercado Envíos y
// peso y medidas) y los pasa por /api/revisar, que llama a POST /items/validate. NO publica nada.
//
// Única escritura en la cuenta: UNA foto de prueba (un PNG generado acá) que /api/revisar sube a
// MercadoLibre una vez (POST /pictures/items/upload) y se reutiliza en los 8 borradores. Sin foto
// no hay validación posible. No toca publicaciones existentes, no responde preguntas, no cambia
// precios, y no llama a /api/publicar.
//
//   $env:VENDELOYA_CLAVE = Read-Host "Clave de la app"
//   node "W:\Working Folder Personal\Apps\VendeloYa\tools\validar-lote.mjs"
//   (con --seco solo muestra los borradores que armaría, sin llamar a nada)
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { elegirAtributos, faltantes, armarItem } from '../worker/logica.js';
import { pedir } from './_cliente.mjs';

const seco = process.argv.includes('--seco');
const contrato = JSON.parse(readFileSync(new URL('../worker/fixtures/contrato-ml.json', import.meta.url)));

/* ---- una foto de prueba válida (PNG 800x800 con degradé y cuadrícula), sin dependencias ---- */
function crc32(buf) {
  let c, crc = ~0;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return ~crc >>> 0;
}
function chunk(tipo, datos) {
  const t = Buffer.from(tipo), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(datos.length); crc.writeUInt32BE(crc32(Buffer.concat([t, datos])));
  return Buffer.concat([len, t, datos, crc]);
}
function pngDePrueba(lado = 800) {
  const filas = Buffer.alloc((lado * 3 + 1) * lado);
  for (let y = 0; y < lado; y++) {
    const o = y * (lado * 3 + 1);
    for (let x = 0; x < lado; x++) {
      const cuadro = ((x >> 6) + (y >> 6)) & 1;
      filas[o + 1 + x * 3] = cuadro ? 235 : (x * 255 / lado) | 0;
      filas[o + 2 + x * 3] = cuadro ? 235 : (y * 255 / lado) | 0;
      filas[o + 3 + x * 3] = cuadro ? 235 : 160;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(lado, 0); ihdr.writeUInt32BE(lado, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(filas)), chunk('IEND', Buffer.alloc(0))]);
}

/* ---- un valor plausible para cada atributo, según su tipo ---- */
function valorDePrueba(a) {
  if (a.opciones.length) return a.opciones[0].nombre;
  if (a.id === 'GTIN') return '';   // sin código: el Worker agrega EMPTY_GTIN_REASON
  if (a.id === 'UNITS_PER_PACK') return '1';   // una unidad por publicación; ML corrige cualquier otro número a 1
  if (a.tipo === 'number_unit') return `10 ${a.unidades[0] || ''}`.trim();
  if (a.tipo === 'number') return '10';
  if (a.tipo === 'boolean') return 'Sí';
  return 'Prueba';
}

const casos = contrato.casos.map((c, i) => {
  const cat = c.categoria;
  const atributos = elegirAtributos(c.atributos, 'usado').map(a => ({ ...a, requerido: a.requerido && a.id !== 'GTIN', valor: valorDePrueba(a) }));
  const conEnvio = i % 2 === 1;
  return {
    rubro: c.busqueda, categoria: cat.id, envio: conEnvio ? 'me2' : 'retiro',
    publicacion: {
      titulo: `Prueba de validación ${cat.name}`.slice(0, cat.settings?.max_title_length || 60), maxTitulo: cat.settings?.max_title_length || 60,
      categoria: cat.id, precio: Math.max(15000, (cat.settings?.minimum_price || 0) * 2), condicion: 'usado', cantidad: 1,
      tipoPublicacion: 'gold_special', garantia: 'Sin garantía', envio: conEnvio ? 'me2' : 'retiro',
      paquete: conEnvio ? { pesoG: '1500', largoCm: '40', anchoCm: '30', altoCm: '15' } : undefined,
      descripcion: 'Borrador de prueba, no se publica.', pideGtin: c.atributos.some(a => a.id === 'EMPTY_GTIN_REASON'), atributos
    }
  };
});

console.log(`${casos.length} borradores de prueba (${casos.filter(c => c.envio === 'me2').length} con Mercado Envíos y paquete).`);
if (seco) {
  for (const c of casos) {
    const pub = { ...c.publicacion, fotos: ['foto-de-prueba'] };
    const item = armarItem(pub, { userProducts: true });
    console.log(`- ${c.rubro} [${c.categoria}] envío ${c.envio}, ${c.publicacion.atributos.length} atributos | faltan: ${faltantes(pub).length} | shipping: ${item.shipping.mode}`);
  }
  process.exit(0);
}

let fotos = [{ dataUrl: `data:image/png;base64,${pngDePrueba().toString('base64')}` }];
const resultados = [];
for (const c of casos) {
  const r = await pedir('/api/revisar', { metodo: 'POST', cuerpo: { publicacion: c.publicacion, fotos } });
  if (r.status === 200 && r.datos.fotos?.length) fotos = r.datos.fotos.map(id => ({ id }));   // reutiliza la foto ya subida
  resultados.push({ ...c, status: r.status, datos: r.datos });
  const d = r.datos || {};
  console.log(`\n[${c.rubro}] ${c.categoria} envío ${c.envio} -> HTTP ${r.status} | ${r.status === 200 ? (d.ok ? 'VALIDADO' : 'RECHAZADO') : 'ERROR'}`);
  if (r.status !== 200) console.log('  ', d.error, d.detalle ? JSON.stringify(d.detalle).slice(0, 300) : '');
  for (const e of d.errores || []) console.log('   error:', String(e).slice(0, 220));
  for (const a of d.avisos || []) console.log('   aviso:', String(a).slice(0, 220));
}
const ok = resultados.filter(x => x.datos?.ok).length;
const me2 = resultados.filter(x => x.envio === 'me2');
console.log(`\nResumen: ${ok} de ${resultados.length} validados | con Mercado Envíos: ${me2.filter(x => x.datos?.ok).length} de ${me2.length}.`);
