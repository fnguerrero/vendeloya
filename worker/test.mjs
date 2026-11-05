/* Tests de logica.js, sin red: node test.mjs
   fixtures/attrs-MLA5232.json son los atributos reales de "Taladros › De Mano",
   bajados de /categories/MLA5232/attributes el 17/10/2026. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  elegirAtributos, atributoParaML, recortarTitulo, limpiarDescripcion,
  armarItem, faltantes, precioDeReferencia, redondearPrecio, erroresML, gtinValido, aplicarGtin, separarCausas, resumenRegistro, actualizarIndice, aplicarDefaults,
  estadoPublicacion, armarSeguimiento, cambioPublicacion, validarRespuesta, elegirParecidos,
  leerComisiones, calcularGanancia, precioDeEquilibrio,
  leerPaquete, paqueteParaML, aCentimetros, aGramos
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
    publicacion: { titulo: 'Editado', precio: '250' }, ml: { id: 'MLA1', permalink: 'https://x' } };
  assert.deepEqual(resumenRegistro(reg), { id: 'abc12345', creado: 'c', actualizado: 'a', titulo: 'Editado',
    precio: 250, estado: 'publicada', thumb: 'data:x', permalink: 'https://x', mlId: 'MLA1' });
  const recien = resumenRegistro({ id: 'x', analisis: { propuesta: { titulo: 'De la IA', precio: 100 } } });
  assert.equal(recien.titulo, 'De la IA');
  assert.equal(recien.estado, 'borrador');
});

test('actualizarIndice: arriba de todo, sin duplicados y con tope', () => {
  const idx = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(actualizarIndice(idx, { id: 'b', t: 1 }).map(r => r.id), ['b', 'a', 'c']);
  assert.deepEqual(actualizarIndice(idx, { id: 'd' }, 3).map(r => r.id), ['d', 'a', 'b']);
});

test('aplicarDefaults: Modelo NA, IVA Exento, impuesto interno 0 % y GTIN sin asterisco', () => {
  const attrs = [
    { id: 'MODEL', nombre: 'Modelo', requerido: true, opciones: [], valor: '' },
    { id: 'VALUE_ADDED_TAX', nombre: 'IVA', requerido: true, valor: '',
      opciones: ['Exento', '0 %', '10.5 %', '21 %', '27 %'].map((nombre, i) => ({ id: String(i), nombre })) },
    { id: 'IMPORT_DUTY', nombre: 'Impuesto interno', requerido: true, valor: '',
      opciones: ['0 %', '5 %'].map((nombre, i) => ({ id: String(i), nombre })) },
    { id: 'GTIN', nombre: 'Código universal de producto', requerido: true, opciones: [], valor: '' },
    { id: 'BRAND', nombre: 'Marca', requerido: true, opciones: [], valor: '' }
  ];
  const r = Object.fromEntries(aplicarDefaults(attrs).map(a => [a.id, a]));
  assert.equal(r.MODEL.valor, 'NA');
  assert.equal(r.VALUE_ADDED_TAX.valor, 'Exento');
  assert.equal(r.IMPORT_DUTY.valor, '0 %');
  assert.equal(r.GTIN.requerido, false);
  assert.equal(r.BRAND.valor, '');
  // Lo que ya vino completo no se pisa.
  assert.equal(aplicarDefaults([{ ...attrs[0], valor: 'KR504' }])[0].valor, 'KR504');
  // Con el GTIN vacío no frena: faltantes no lo cuenta.
  assert.deepEqual(faltantes({ ...base, atributos: aplicarDefaults(attrs).filter(a => a.id !== 'BRAND') }), []);
});

test('estadoPublicacion: una usada vendida queda closed o paused sin stock', () => {
  assert.equal(estadoPublicacion({ status: 'active', sold_quantity: 0 }), 'activa');
  assert.equal(estadoPublicacion({ status: 'active', sub_status: ['under_review'] }), 'en_revision');
  assert.equal(estadoPublicacion({ status: 'paused', sold_quantity: 0 }), 'pausada');
  assert.equal(estadoPublicacion({ status: 'paused', sold_quantity: 1, sub_status: ['out_of_stock'] }), 'vendida');
  assert.equal(estadoPublicacion({ status: 'closed', sold_quantity: 1 }), 'vendida');
  assert.equal(estadoPublicacion({ status: 'closed', sold_quantity: 0 }), 'finalizada');
  assert.equal(estadoPublicacion(null), 'desconocido');
});

test('armarSeguimiento: cuenta preguntas por ítem y tolera visitas faltantes', () => {
  const items = [{ id: 'MLA1', status: 'active', sold_quantity: 0, available_quantity: 1, price: 1500 },
                 { id: 'MLA2', status: 'closed', sold_quantity: 1, available_quantity: 0, price: 800 }];
  const s = armarSeguimiento(items, { MLA1: 23 }, [{ item_id: 'MLA1' }, { item_id: 'MLA1' }, { item_id: 'MLA9' }]);
  assert.deepEqual(s.MLA1, { estado: 'activa', vendidas: 0, disponibles: 1, precio: 1500, visitas: 23, preguntas: 2 });
  assert.deepEqual(s.MLA2, { estado: 'vendida', vendidas: 1, disponibles: 0, precio: 800, visitas: null, preguntas: 0 });
  assert.deepEqual(armarSeguimiento([]), {});
});

test('cambioPublicacion: arma el PUT y rechaza lo que no entiende', () => {
  assert.deepEqual(cambioPublicacion('precio', '85000.4'), { price: 85000 });
  assert.deepEqual(cambioPublicacion('pausar'), { status: 'paused' });
  assert.deepEqual(cambioPublicacion('reactivar'), { status: 'active' });
  assert.deepEqual(cambioPublicacion('vendida'), { status: 'closed' });
  assert.throws(() => cambioPublicacion('precio', 0), /mayor a cero/);
  assert.throws(() => cambioPublicacion('borrar'), /desconocida/);
});

test('validarRespuesta: texto plano, sin links ni teléfonos, hasta 2000', () => {
  assert.equal(validarRespuesta('  Hola!   Mide 180 cm.\n\n\n\nRetiro por Caseros. '), 'Hola! Mide 180 cm.\n\nRetiro por Caseros.');
  assert.throws(() => validarRespuesta(''), /Escribí/);
  assert.throws(() => validarRespuesta('Mirá www.ejemplo.com'), /links/);
  assert.throws(() => validarRespuesta('Llamame al 11 4567 8901'), /links/);
  assert.equal(validarRespuesta('Mide 180 x 90 cm y pesa 25 kg').length, 29);
  assert.equal(validarRespuesta('a'.repeat(3000)).length, 2000);
});

test('elegirParecidos: los más cercanos al sugerido, con link y precio', () => {
  const res = [{ title: 'A', price: 100, permalink: 'a' }, { title: 'B', price: 900, permalink: 'b' }, { title: 'C', price: 500, permalink: 'c' },
               { title: 'sin link', price: 500 }, { title: 'D', price: 0, permalink: 'd' }, { title: 'E', price: 520, permalink: 'e', thumbnail: 't' }];
  const p = elegirParecidos(res, 500, 3);
  assert.deepEqual(p.map(x => x.titulo), ['C', 'E', 'A']);
  assert.deepEqual(p[1], { titulo: 'E', precio: 520, permalink: 'e', thumb: 't' });
  assert.deepEqual(elegirParecidos(undefined, 500), []);
});

/* Forma documentada de GET /sites/MLA/listing_prices (no se pudo bajar una real: da 403 sin token). */
const LISTING_PRICES = [
  { currency_id: 'ARS', listing_type_id: 'gold_special', listing_type_name: 'Clásica', sale_fee_amount: 5850, sale_fee_details: { percentage_fee: 13, fixed_fee: 0, gross_amount: 5850 } },
  { currency_id: 'ARS', listing_type_id: 'gold_pro', listing_type_name: 'Premium', sale_fee_amount: 8100, sale_fee_details: { percentage_fee: 18, fixed_fee: 0, gross_amount: 8100 } },
  { currency_id: 'ARS', listing_type_id: 'free', listing_type_name: 'Gratuita', sale_fee_amount: 0 },
  { basura: true }
];

test('leerComisiones: un elemento por tipo, con porcentaje y fijo; ignora lo que no es comisión', () => {
  const c = leerComisiones(LISTING_PRICES);
  assert.deepEqual(c.map(x => x.id), ['gold_special', 'gold_pro', 'free']);
  assert.deepEqual(c[0], { id: 'gold_special', nombre: 'Clásica', comision: 5850, pct: 13, fijo: 0 });
  assert.equal(c[2].pct, null);
  assert.deepEqual(leerComisiones(null), []);
  assert.deepEqual(leerComisiones({ message: 'error' }), []);
});

test('calcularGanancia: precio − comisión − envío − costo, con margen sobre el precio', () => {
  const g = calcularGanancia({ precio: 45000, comision: 5850, envio: 0, costo: 20000 });
  assert.equal(g.neto, 39150);
  assert.equal(g.ganancia, 19150);
  assert.equal(g.margen, 42.6);
  assert.equal(g.comisionPct, 13);
  const conEnvio = calcularGanancia({ precio: 45000, comision: 5850, envio: 4000, costo: 20000 });
  assert.equal(conEnvio.ganancia, 15150);
  assert.equal(calcularGanancia({ precio: 45000, comision: 5850, costo: 60000 }).ganancia, -20850);
  assert.equal(calcularGanancia({ precio: 0 }), null);
  assert.equal(calcularGanancia({ precio: 1000, comision: 5000 }).comision, 1000);   // la comisión no pasa del precio
  assert.equal(calcularGanancia({ precio: '1000', comision: 'x', envio: -5, costo: null }).ganancia, 1000);
});

test('precioDeEquilibrio: el precio donde la ganancia es cero', () => {
  const eq = precioDeEquilibrio({ costo: 20000, envio: 4000, pct: 13, fijo: 0 });
  assert.equal(eq, 27600);   // 24000 / 0,87 = 27586 → a la centena
  const g = calcularGanancia({ precio: eq, comision: eq * 0.13, envio: 4000, costo: 20000 });
  assert.ok(g.ganancia >= 0 && g.ganancia < 100);
  assert.equal(precioDeEquilibrio({ costo: 0 }), 0);
  assert.equal(precioDeEquilibrio({ costo: 100, pct: 100 }), 0);
});

const PAQ = { pesoG: '1500', largoCm: '40', anchoCm: '30,4', altoCm: 15 };
const BASE = { titulo: 'Taladro', categoria: 'MLA5232', precio: 45000, condicion: 'usado', fotos: ['p1'], atributos: [] };

test('leerPaquete: los cuatro valores o nada', () => {
  assert.deepEqual(leerPaquete(PAQ), { pesoG: 1500, largoCm: 40, anchoCm: 30, altoCm: 15 });
  assert.equal(leerPaquete({ ...PAQ, altoCm: '' }), null);
  assert.equal(leerPaquete({ ...PAQ, pesoG: 0 }), null);
  assert.equal(leerPaquete({ ...PAQ, largoCm: 'abc' }), null);
  assert.equal(leerPaquete(undefined), null);
});

test('paqueteParaML: atributos SELLER_PACKAGE_* con User Products, shipping.dimensions sin ellos', () => {
  const up = paqueteParaML(PAQ, { userProducts: true });
  assert.deepEqual(up.atributos.map(a => `${a.id}=${a.value_name}`),
    ['SELLER_PACKAGE_WEIGHT=1500 g', 'SELLER_PACKAGE_LENGTH=40 cm', 'SELLER_PACKAGE_WIDTH=30 cm', 'SELLER_PACKAGE_HEIGHT=15 cm']);
  assert.equal(up.dimensions, undefined);
  assert.deepEqual(paqueteParaML(PAQ, { userProducts: false }), { dimensions: '15x30x40,1500' });
  assert.equal(paqueteParaML({}, { userProducts: true }), null);
});

test('aCentimetros y aGramos: convierten lo que escribió la IA o Nico', () => {
  assert.equal(aCentimetros('45 cm'), 45);
  assert.equal(aCentimetros('1,2 m'), 120);
  assert.equal(aCentimetros('800 mm'), 80);
  assert.equal(aCentimetros('20'), 20);
  assert.equal(aCentimetros('10 in'), 25);
  assert.equal(aCentimetros('grande'), null);
  assert.equal(aCentimetros('0 cm'), null);
  assert.equal(aGramos('800 g'), 800);
  assert.equal(aGramos('1,5 kg'), 1500);
  assert.equal(aGramos('2 lb'), 907);
  assert.equal(aGramos('500'), 500);
  assert.equal(aGramos('pesado'), null);
});

test('armarItem: Mercado Envíos (me2) lleva peso y medidas, gratis y retiro', () => {
  const conUP = armarItem({ ...BASE, envio: 'me2', paquete: PAQ, envioGratis: true, retiroTambien: true }, { userProducts: true });
  assert.deepEqual(conUP.shipping, { mode: 'me2', local_pick_up: true, free_shipping: true });
  assert.ok(conUP.attributes.some(a => a.id === 'SELLER_PACKAGE_WEIGHT' && a.value_name === '1500 g'));
  const sinUP = armarItem({ ...BASE, envio: 'me2', paquete: PAQ }, { userProducts: false });
  assert.deepEqual(sinUP.shipping, { mode: 'me2', local_pick_up: false, free_shipping: false, dimensions: '15x30x40,1500' });
  assert.ok(!sinUP.attributes.some(a => a.id.startsWith('SELLER_PACKAGE')));
});

test('armarItem: retiro no lleva paquete; la configuración de la cuenta solo suma medidas si están', () => {
  const retiro = armarItem({ ...BASE, envio: 'retiro', paquete: PAQ }, { userProducts: true });
  assert.deepEqual(retiro.shipping, { mode: 'not_specified', local_pick_up: true, free_shipping: false });
  assert.ok(!retiro.attributes.some(a => a.id.startsWith('SELLER_PACKAGE')));
  const cuenta = armarItem({ ...BASE, envio: '' }, { userProducts: true });
  assert.equal(cuenta.shipping, undefined);
  assert.equal(armarItem({ ...BASE, envio: '', paquete: PAQ }, { userProducts: false }).shipping.dimensions, '15x30x40,1500');
});

test('faltantes: con Mercado Envíos el paquete es obligatorio; con retiro o cuenta, no', () => {
  assert.deepEqual(faltantes({ ...BASE, envio: 'me2' }), ['el peso y las medidas del paquete (Mercado Envíos)']);
  assert.deepEqual(faltantes({ ...BASE, envio: 'me2', paquete: PAQ }), []);
  assert.deepEqual(faltantes({ ...BASE, envio: 'retiro' }), []);
  assert.deepEqual(faltantes({ ...BASE, envio: '' }), []);
});

console.log(`\n${n} tests en verde`);
