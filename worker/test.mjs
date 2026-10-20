/* Tests de logica.js, sin red: node test.mjs
   fixtures/attrs-MLA5232.json son los atributos reales de "Taladros › De Mano",
   bajados de /categories/MLA5232/attributes el 17/10/2026. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  elegirAtributos, atributoParaML, recortarTitulo, limpiarDescripcion,
  armarItem, faltantes, precioDeReferencia, redondearPrecio, erroresML, gtinValido, aplicarGtin, separarCausas, resumenRegistro, actualizarIndice
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

test('gtinValido: verifica el dígito de control', () => {
  assert.ok(gtinValido('7790895000997'));        // EAN-13 real (Coca-Cola 2,25 L Argentina)
  assert.ok(gtinValido('036000291452'));         // UPC-A del ejemplo de GS1
  assert.ok(gtinValido('96385074'));             // EAN-8 de ejemplo
  assert.ok(gtinValido('779 0895 000997'));      // con espacios, como se lee en la etiqueta
  assert.ok(!gtinValido('7790895000998'));       // un dígito mal leído
  assert.ok(!gtinValido('12345'));
  assert.ok(!gtinValido(''));
});

test('aplicarGtin: solo códigos válidos, nunca inventados', () => {
  const attrs = [{ id: 'BRAND', valor: 'X' }, { id: 'GTIN', valor: '' }];
  assert.equal(aplicarGtin(attrs, '7790895000997')[1].valor, '7790895000997');
  assert.equal(aplicarGtin(attrs, '7790895000998')[1].valor, '');
  const inventado = [{ id: 'GTIN', valor: '1234567890123' }];
  assert.equal(aplicarGtin(inventado, '')[0].valor, '');
  const bueno = [{ id: 'GTIN', valor: '036000291452' }];
  assert.equal(aplicarGtin(bueno, '')[0].valor, '036000291452');
  assert.deepEqual(aplicarGtin(attrs, '')[0], { id: 'BRAND', valor: 'X' });
});

test('separarCausas: los avisos no bloquean, los errores sí', () => {
  // La respuesta real del 20/10/2026 para un vajillero: 400 con solo avisos de envío.
  const soloAvisos = { message: 'Validation error', error: 'validation_error', status: 400, cause: [
    { type: 'warning', code: 'shipping.lost_me1_by_user', message: 'User has not mode me1' },
    { type: 'warning', code: 'shipping.lost_me2_by_catalog', message: 'Catalog has not mode me2' }
  ] };
  const r = separarCausas(soloAvisos);
  assert.deepEqual(r.errores, []);
  assert.equal(r.avisos.length, 2);
  assert.match(r.avisos[1], /Mercado Envíos/);
  const conError = separarCausas({ cause: [...soloAvisos.cause, { type: 'error', code: 'item.price.invalid', message: 'Price is invalid' }] });
  assert.deepEqual(conError.errores, ['Price is invalid [item.price.invalid]']);
  assert.deepEqual(separarCausas({ message: 'body.invalid_field_types', cause: [] }).errores, ['body.invalid_field_types']);
});

test('armarItem: solo retiro en persona', () => {
  assert.equal(armarItem(base, { userProducts: true }).shipping, undefined);
  assert.deepEqual(armarItem({ ...base, envio: 'retiro' }, { userProducts: true }).shipping,
    { mode: 'not_specified', local_pick_up: true, free_shipping: false });
});

test('resumenRegistro: lo editado gana sobre la propuesta de la IA', () => {
  const reg = { id: 'abc12345', creado: 'c', actualizado: 'a', estado: 'publicada', thumb: 'data:x',
    analisis: { propuesta: { titulo: 'De la IA', precio: 100 } },
    publicacion: { titulo: 'Editado', precio: '250' }, ml: { permalink: 'https://x' } };
  assert.deepEqual(resumenRegistro(reg), { id: 'abc12345', creado: 'c', actualizado: 'a', titulo: 'Editado',
    precio: 250, estado: 'publicada', thumb: 'data:x', permalink: 'https://x' });
  const recien = resumenRegistro({ id: 'x', analisis: { propuesta: { titulo: 'De la IA', precio: 100 } } });
  assert.equal(recien.titulo, 'De la IA');
  assert.equal(recien.estado, 'borrador');
});

test('actualizarIndice: arriba de todo, sin duplicados y con tope', () => {
  const idx = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(actualizarIndice(idx, { id: 'b', t: 1 }).map(r => r.id), ['b', 'a', 'c']);
  assert.deepEqual(actualizarIndice(idx, { id: 'd' }, 3).map(r => r.id), ['d', 'a', 'b']);
});

console.log(`\n${n} tests en verde`);
