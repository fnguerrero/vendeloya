/* Tests de logica.js, sin red: node test.mjs
   fixtures/attrs-MLA5232.json son los atributos reales de "Taladros › De Mano",
   bajados de /categories/MLA5232/attributes el 17/10/2026. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  elegirAtributos, atributoParaML, recortarTitulo, limpiarDescripcion,
  armarItem, faltantes, precioDeReferencia, redondearPrecio, erroresML
} from './logica.js';

const attrs = JSON.parse(readFileSync(new URL('./fixtures/attrs-MLA5232.json', import.meta.url)));
let n = 0;
const test = (nombre, fn) => { fn(); n++; console.log('ok', nombre); };

test('elegirAtributos: obligatorios primero, nada read_only ni manejado aparte', () => {
  const elegidos = elegirAtributos(attrs, 'usado');
  const ids = elegidos.map(a => a.id);
  assert.ok(ids.includes('BRAND') && ids.includes('MODEL'));
  assert.ok(!ids.includes('ITEM_CONDITION') && !ids.includes('EMPTY_GTIN_REASON'));
  const ro = new Set(attrs.filter(a => a.tags?.read_only).map(a => a.id));
  assert.ok(ids.every(id => !ro.has(id)));
  const primerOpcional = elegidos.findIndex(a => !a.requerido);
  assert.ok(elegidos.slice(primerOpcional).every(a => !a.requerido));
  assert.ok(elegidos.filter(a => !a.requerido).length <= 12);
});

test('atributoParaML: matchea opciones sin importar acentos ni mayúsculas', () => {
  const attr = { id: 'COLOR', opciones: [{ id: '52049', nombre: 'Negro' }, { id: '1', nombre: 'Azul eléctrico' }] };
  assert.deepEqual(atributoParaML(attr, 'negro'), { id: 'COLOR', value_id: '52049', value_name: 'Negro' });
  assert.deepEqual(atributoParaML(attr, 'AZUL ELECTRICO'), { id: 'COLOR', value_id: '1', value_name: 'Azul eléctrico' });
  assert.deepEqual(atributoParaML(attr, 'Verde'), { id: 'COLOR', value_name: 'Verde' });
  assert.equal(atributoParaML(attr, '  '), null);
});

test('recortarTitulo: respeta el máximo sin cortar palabras', () => {
  const t = 'Taladro Percutor Inalámbrico Black And Decker 20v Con Maletín Y Dos Baterías';
  const r = recortarTitulo(t, 60);
  assert.ok(r.length <= 60);
  assert.ok(t.startsWith(r));
  assert.ok(!r.endsWith(' '));
  assert.equal(recortarTitulo('  Mate   de calabaza ', 60), 'Mate de calabaza');
});

test('limpiarDescripcion: saca HTML y emojis, deja saltos de línea', () => {
  assert.equal(limpiarDescripcion('Hola <b>mundo</b> 😀\n\n\n\nChau  \n'), 'Hola mundo\n\nChau');
});

const base = {
  titulo: 'Taladro Percutor Black And Decker 500w', categoria: 'MLA5232', precio: 45250,
  condicion: 'usado', fotos: ['111-MLA1_102026'], tipoPublicacion: 'gold_special', pideGtin: true,
  atributos: [
    { id: 'BRAND', nombre: 'Marca', requerido: true, valor: 'Black+Decker', opciones: [] },
    { id: 'COLOR', nombre: 'Color', requerido: false, valor: '', opciones: [] }
  ]
};

test('armarItem: modelo viejo manda title, modelo User Products manda family_name', () => {
  const viejo = armarItem(base, { userProducts: false });
  assert.equal(viejo.title, base.titulo);
  assert.equal(viejo.family_name, undefined);
  const nuevo = armarItem(base, { userProducts: true });
  assert.equal(nuevo.family_name, base.titulo);
  assert.equal(nuevo.title, undefined);
});

test('armarItem: condición, GTIN faltante, atributos vacíos y precio entero', () => {
  const item = armarItem(base, { userProducts: true });
  assert.equal(item.condition, 'used');
  assert.equal(item.price, 45250);
  assert.equal(item.currency_id, 'ARS');
  assert.deepEqual(item.pictures, [{ id: '111-MLA1_102026' }]);
  const porId = Object.fromEntries(item.attributes.map(a => [a.id, a]));
  assert.equal(porId.ITEM_CONDITION.value_name, 'Usado');
  assert.equal(porId.EMPTY_GTIN_REASON.value_name, 'El producto no tiene código registrado');
  assert.equal(porId.COLOR, undefined);
  const conGtin = armarItem({ ...base, atributos: [...base.atributos, { id: 'GTIN', valor: '7798123456789' }] }, { userProducts: true });
  assert.ok(!conGtin.attributes.some(a => a.id === 'EMPTY_GTIN_REASON'));
});

test('armarItem: garantía', () => {
  assert.equal(armarItem(base, { userProducts: true }).sale_terms, undefined);
  const sin = armarItem({ ...base, garantia: 'Sin garantía', garantiaTiempo: '30 días' }, { userProducts: true });
  assert.deepEqual(sin.sale_terms, [{ id: 'WARRANTY_TYPE', value_name: 'Sin garantía' }]);
  const con = armarItem({ ...base, garantia: 'Garantía del vendedor', garantiaTiempo: '30 días' }, { userProducts: true });
  assert.equal(con.sale_terms.length, 2);
});

test('faltantes: detecta lo obligatorio vacío', () => {
  assert.deepEqual(faltantes(base), []);
  const f = faltantes({ ...base, precio: 0, fotos: [], atributos: [{ id: 'MODEL', nombre: 'Modelo', requerido: true, valor: '' }] });
  assert.deepEqual(f, ['el precio', 'al menos una foto', 'Modelo']);
});

test('precioDeReferencia: mediana redondeada, ignora basura, pide al menos 3', () => {
  assert.equal(precioDeReferencia([{ price: 10 }, { price: 20 }]), null);
  const r = precioDeReferencia([{ price: 1 }, { price: 40000 }, { price: 42000 }, { price: 45000 }, { price: 900000 }, { price: null }]);
  assert.equal(r.sugerido, 42000);
  assert.equal(r.muestras, 5);
});

test('redondearPrecio', () => {
  assert.equal(redondearPrecio(12345), 12300);
  assert.equal(redondearPrecio(87654), 88000);
  assert.equal(redondearPrecio(20), 100);
  assert.equal(redondearPrecio(-5), 0);
});

test('erroresML: errores antes que avisos, con código', () => {
  const r = erroresML({ message: 'Validation error', cause: [
    { type: 'warning', code: 'item.title.length', message: 'Title too long' },
    { type: 'error', code: 'item.price.invalid', message: 'Price is invalid' }
  ] });
  assert.deepEqual(r, ['Price is invalid [item.price.invalid]', '(aviso) Title too long [item.title.length]']);
  assert.deepEqual(erroresML({ message: 'forbidden' }), ['forbidden']);
});

console.log(`\n${n} tests en verde`);
