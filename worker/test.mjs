/* Tests de logica.js, sin red: node test.mjs
   fixtures/attrs-MLA5232.json son los atributos reales de "Taladros › De Mano",
   bajados de /categories/MLA5232/attributes el 17/10/2026. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  elegirAtributos, atributoParaML, recortarTitulo, limpiarDescripcion,
  armarItem, faltantes, precioDeReferencia, redondearPrecio, erroresML, gtinValido, aplicarGtin, separarCausas, resumenRegistro, actualizarIndice, aplicarDefaults,
  estadoPublicacion, armarSeguimiento, cambioPublicacion, validarRespuesta, elegirParecidos,
  leerComisiones, calcularGanancia, precioDeEquilibrio,
  leerPaquete, paqueteParaML, aCentimetros, aGramos, parsearNumero, parsearMonto, validarPaquete,
  huellaItem, paraHuella, marcarValidado, estaValidado, gastarValidacion, leerVisitas,
  requisitosDeGuia, armarBusquedaGuia, elegirGuia, filaDeGuia, tallesDeGuia, aplicarGuia,
  validarDescripcion, limpiarTalles, conTalle, MAX_TALLES, itemsDeRegistro, juntarSeguimiento
} from './logica.js';

const attrs = JSON.parse(readFileSync(new URL('./fixtures/attrs-MLA5232.json', import.meta.url)));
let n = 0;
const test = (nombre, fn) => { fn(); n++; console.log('ok', nombre); };
const testA = async (nombre, fn) => { await fn(); n++; console.log('ok', nombre); };

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

test('separarCausas: el aviso de ME1 con Mercado Envíos 2 elegido no dice que el envío queda a acordar', () => {
  // Validado contra ML real (09/11/2026): cochecito y bicicleta con me2 validan y traen igual lost_me1_by_user.
  const me1 = { type: 'warning', code: 'shipping.lost_me1_by_user', message: 'User has not mode me1' };
  const conMe2 = separarCausas({ cause: [me1] }, { envio: 'me2' });
  assert.equal(conMe2.avisos.length, 1);
  assert.match(conMe2.avisos[0], /No afecta al envío por Mercado Envíos 2/);
  assert.doesNotMatch(conMe2.avisos[0], /a acordar/);
  // Con retiro (o sin dato) sigue el aviso de siempre.
  assert.match(separarCausas({ cause: [me1] }, { envio: 'retiro' }).avisos[0], /a acordar con el comprador/);
  assert.match(separarCausas({ cause: [me1] }).avisos[0], /a acordar con el comprador/);
});

test('separarCausas: si se perdió ME2 (heladera), un solo aviso claro y sin el de ME1', () => {
  const r = separarCausas({ cause: [
    { type: 'warning', code: 'shipping.lost_me1_by_user', message: 'User has not mode me1' },
    { type: 'warning', code: 'shipping.lost_me2_by_intersected_logistics', message: 'Item lost me2 by intersected logistics' }
  ] }, { envio: 'me2' });
  assert.equal(r.avisos.length, 1);
  assert.match(r.avisos[0], /Mercado Envíos no puede llevar este producto/);
  assert.match(r.avisos[0], /a acordar con el comprador/);
  assert.match(r.avisos[0], /Revisá el paquete o ofrecé retiro/);
  assert.doesNotMatch(r.avisos[0], /intersected|\[shipping/);
});

test('envío gratis: la app nunca lo activa sola y el aviso de costo mayor que la venta se entiende', () => {
  const aviso = { type: 'warning', code: 'shipping.free_shipping.cost_exceeded', message: 'Free shipping costs exceeds sale' };
  const r = separarCausas({ cause: [aviso] }, { envio: 'me2' });
  assert.deepEqual(r.errores, []);
  assert.match(r.avisos[0], /costo del envío gratis supera lo que cobrás/);
  assert.match(r.avisos[0], /Subí el precio o ofrecé retiro/);
  assert.doesNotMatch(r.avisos[0], /exceeds|\[shipping/);
  // ni con precio alto ni con paquete: free_shipping solo es true si Nico lo pide en la revisión
  const paquete = { pesoG: '1500', largoCm: '40', anchoCm: '30', altoCm: '15' };
  for (const userProducts of [true, false]) {
    for (const envio of ['retiro', 'me2']) {
      const it = armarItem({ ...base, precio: 900000, envio, paquete }, { userProducts });
      assert.ok(!it.shipping || it.shipping.free_shipping !== true, `${envio}/${userProducts}`);
    }
  }
  assert.equal(armarItem({ ...base, envio: 'me2', envioGratis: true, paquete }, { userProducts: true }).shipping.free_shipping, true);
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

test('leerComisiones: null, "" o ausente es "no informado", nunca 0 (ni comisión, ni porcentaje, ni fijo)', () => {
  const t = (extra) => leerComisiones([{ listing_type_id: 'gold_special', ...extra }]);
  assert.deepEqual(t({ sale_fee_amount: null }), []);                    // sin comisión informada → el tipo no cuenta
  assert.deepEqual(t({ sale_fee_amount: '' }), []);
  assert.deepEqual(t({ sale_fee_amount: '   ' }), []);
  assert.deepEqual(t({}), []);
  assert.deepEqual(t({ sale_fee_amount: 'abc' }), []);
  assert.deepEqual(t({ sale_fee_amount: -5 }), []);
  assert.deepEqual(t({ sale_fee_amount: NaN }), []);
  const sinDetalle = t({ sale_fee_amount: 5850, sale_fee_details: { percentage_fee: null, fixed_fee: '' } });
  assert.equal(sinDetalle[0].comision, 5850);
  assert.equal(sinDetalle[0].pct, null);                                 // antes: 0 → "Comisión que informa MercadoLibre (0 %)"
  assert.equal(sinDetalle[0].fijo, null);
  assert.equal(t({ sale_fee_amount: 5850 })[0].pct, null);
  // un cero que MercadoLibre sí informó es un cero válido (publicación gratuita)
  const gratis = t({ sale_fee_amount: 0, sale_fee_details: { percentage_fee: 0, fixed_fee: 0 } });
  assert.deepEqual([gratis[0].comision, gratis[0].pct, gratis[0].fijo], [0, 0, 0]);
  assert.equal(t({ sale_fee_amount: '5850.5', sale_fee_details: { percentage_fee: '13' } })[0].pct, 13);
});



/* Las copias del front (el bloque `>>> compartido` de app.js) se cargan tal cual y corren los mismos casos. */
const fuenteApp = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const bloqueCompartido = /\/\* >>> compartido([\s\S]*?)\/\* <<< compartido \*\//.exec(fuenteApp)?.[1];
assert.ok(bloqueCompartido, 'app.js no tiene el bloque ">>> compartido"');
const NOMBRES_COMPARTIDOS = ['calcularGanancia', 'precioDeEquilibrio', 'aCentimetros', 'aGramos', 'cambiarDeRegistro', 'resolverComision', 'parsearNumero', 'parsearMonto', 'validarPaquete', 'unaALaVez', 'colaPorPerder', 'textoEnvio', 'avisoEnvioGratis'];
const front = new Function(`${bloqueCompartido.slice(bloqueCompartido.indexOf('*/') + 2)}\nreturn { ${NOMBRES_COMPARTIDOS.join(', ')} };`)();
const IMPLEMENTACIONES = {
  worker: { calcularGanancia, precioDeEquilibrio, aCentimetros, aGramos, parsearNumero, parsearMonto, validarPaquete },
  front
};
const enAmbas = (nombre, fn) => test(nombre, () => { for (const [donde, impl] of Object.entries(IMPLEMENTACIONES)) { try { fn(impl); } catch (e) { e.message = `[${donde}] ${e.message}`; throw e; } } });

enAmbas('calcularGanancia: precio − comisión − envío − costo, con margen sobre el precio (worker y front)', ({ calcularGanancia }) => {
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

enAmbas('precioDeEquilibrio: caso exacto, caso que antes quedaba abajo y bordes (worker y front)', ({ precioDeEquilibrio, calcularGanancia }) => {
  assert.equal(precioDeEquilibrio({ costo: 20000, envio: 4000, pct: 13, fijo: 0 }), 27600);   // 24000 / 0,87 = 27586 → arriba
  // El caso de la revisión: 10.040 con 13 % necesita 11.540; redondeando al más cercano daba 11.500 y perdía $35.
  const eq = precioDeEquilibrio({ costo: 10040, envio: 0, pct: 13, fijo: 0 });
  assert.equal(eq, 11600);
  assert.ok(calcularGanancia({ precio: eq, comision: eq * 0.13, envio: 0, costo: 10040 }).ganancia >= 0);
  assert.equal(precioDeEquilibrio({ costo: 8700, pct: 13 }), 10000);   // 8700 / 0,87 = 10000 exacto: no sube un escalón de más
  assert.equal(precioDeEquilibrio({ costo: 0 }), 0);
  assert.equal(precioDeEquilibrio({ costo: 100, pct: 100 }), 0);
});

enAmbas('precioDeEquilibrio: barrido, en ningún caso la ganancia es negativa ni sobra más de un escalón (worker y front)', ({ precioDeEquilibrio, calcularGanancia }) => {
  let casos = 0;
  for (const pct of [0, 5, 13, 18, 22.5, 27.5, 35]) {
    for (const fijo of [0, 50, 1000]) {
      for (const envio of [0, 500, 4000]) {
        for (let costo = 1; costo <= 400000; costo = Math.ceil(costo * 1.037) + 3) {
          const eq = precioDeEquilibrio({ costo, envio, pct, fijo });
          const g = calcularGanancia({ precio: eq, comision: eq * pct / 100 + fijo, envio, costo });
          assert.ok(g.ganancia >= -0.005, `pierde ${g.ganancia} con costo ${costo}, envío ${envio}, ${pct} % + ${fijo}: equilibrio ${eq}`);
          const exacto = (costo + envio + fijo) / (1 - pct / 100);
          const paso = exacto >= 50000 ? 1000 : 100;
          assert.ok(eq - exacto < paso + 1e-6, `sobra más de un escalón: ${eq} vs ${exacto}`);
          casos++;
        }
      }
    }
  }
  assert.ok(casos > 1500, `pocos casos: ${casos}`);
});

await testA('cambiarDeRegistro (front): guarda lo pendiente ANTES de abrir el siguiente y no cambia si no pudo guardar', async () => {
  const { cambiarDeRegistro } = front;
  const armar = ({ pendiente, guardaBien = true }) => {
    const pasos = [];
    return { pasos, args: {
      hayPendiente: () => pendiente,
      cancelarAutoguardado: () => pasos.push('cancelar'),
      guardar: async () => { pasos.push('guardar'); return guardaBien; },
      limpiar: () => pasos.push('limpiar'),
      abrir: async () => { pasos.push('abrir'); return true; }
    } };
  };
  // editar el título y tocar "Siguiente de la cola": el autoguardado se corta, se guarda y recién ahí se abre
  const a = armar({ pendiente: true });
  assert.equal(await cambiarDeRegistro(a.args), true);
  assert.deepEqual(a.pasos, ['cancelar', 'guardar', 'limpiar', 'abrir']);
  // sin nada pendiente no hay guardado de más
  const b = armar({ pendiente: false });
  assert.equal(await cambiarDeRegistro(b.args), true);
  assert.deepEqual(b.pasos, ['cancelar', 'limpiar', 'abrir']);
  // si no se pudo guardar NO se abre el otro (la edición sigue en pantalla) ni se limpia el estado del viejo
  const c = armar({ pendiente: true, guardaBien: false });
  assert.equal(await cambiarDeRegistro(c.args), false);
  assert.deepEqual(c.pasos, ['cancelar', 'guardar']);
});

test('resolverComision (front): nunca asume $0; sin dato o sin ese tipo pide cargarla a mano', () => {
  const { resolverComision } = front;
  const tipos = [{ id: 'gold_special', nombre: 'Clásica', comision: 5850, pct: 13, fijo: 0 },
                 { id: 'free', nombre: 'Gratuita', comision: 0, pct: null, fijo: null }];
  const base = { tipos, disponible: true, precio: 45000, precioConsultado: 45000, manualPct: '' };
  // exacta para el precio consultado
  assert.deepEqual(resolverComision({ ...base, tipoId: 'gold_special' }), { fuente: 'ml', monto: 5850, pct: 13, fijo: 0 });
  // otro precio: por porcentaje + fijo
  assert.equal(resolverComision({ ...base, tipoId: 'gold_special', precio: 30000 }).monto, 3900);
  // un tipo sin porcentaje informado y otro precio: no se inventa, se espera la consulta
  assert.deepEqual(resolverComision({ ...base, tipoId: 'free', precio: 30000 }), { fuente: 'ninguna', motivo: 'actualizando' });
  // la gratuita informada por MercadoLibre con el precio consultado sí es $0 con fuente
  assert.deepEqual(resolverComision({ ...base, tipoId: 'free' }), { fuente: 'ml', monto: 0, pct: null, fijo: null });
  // MercadoLibre contestó pero no devolvió Premium: no hay dato, NO es 0
  assert.deepEqual(resolverComision({ ...base, tipoId: 'gold_pro' }), { fuente: 'ninguna', motivo: 'sin-tipo' });
  // ...y con un % a mano sí se calcula, marcado como manual
  assert.deepEqual(resolverComision({ ...base, tipoId: 'gold_pro', manualPct: '18' }), { fuente: 'manual', monto: 8100, pct: 18, fijo: 0 });
  assert.equal(resolverComision({ ...base, tipoId: 'gold_pro', manualPct: '17,5' }).pct, 17.5);
  assert.equal(resolverComision({ ...base, tipoId: 'gold_pro', manualPct: 'x' }).fuente, 'ninguna');
  assert.equal(resolverComision({ ...base, tipoId: 'gold_pro', manualPct: '100' }).fuente, 'ninguna');
  // MercadoLibre no contestó
  assert.deepEqual(resolverComision({ ...base, disponible: false, tipos: [], tipoId: 'gold_special' }), { fuente: 'ninguna', motivo: 'sin-dato' });
  assert.equal(resolverComision({ ...base, disponible: false, tipos: [], tipoId: 'gold_special', manualPct: '13' }).monto, 5850);
  // todavía no se consultó
  assert.deepEqual(resolverComision({ ...base, disponible: null, tipos: [], tipoId: 'gold_special' }), { fuente: 'ninguna', motivo: 'actualizando' });
});

await testA('unaALaVez (front): el doble toque corre una sola vez y un error suelta el candado', async () => {
  const { unaALaVez } = front;
  let corridas = 0;
  let soltar;
  const espera = new Promise(r => { soltar = r; });
  const sumar = unaALaVez(async () => { corridas++; await espera; return 'sumado'; });
  // dos toques "al mismo tiempo" (antes: 6 → 8 productos, doble gasto de Claude)
  const [a, b, c] = [sumar(), sumar(), sumar()];
  soltar();
  assert.deepEqual(await Promise.all([a, b, c]), ['sumado', undefined, undefined]);
  assert.equal(corridas, 1);
  // terminada la primera, el siguiente toque sí corre
  assert.equal(await sumar(), 'sumado');
  assert.equal(corridas, 2);
  // si falla, el candado se suelta (no queda el botón muerto)
  let intentos = 0;
  const fallida = unaALaVez(async () => { intentos++; if (intentos === 1) throw new Error('boom'); return 'ok'; });
  await assert.rejects(fallida(), /boom/);
  assert.equal(await fallida(), 'ok');
  // y los argumentos pasan
  assert.equal(await unaALaVez(async (x, y) => x + y)(2, 3), 5);
});

test('colaPorPerder (front): cuenta lo que no quedó guardado como borrador', () => {
  const { colaPorPerder } = front;
  const c = estado => ({ estado });
  assert.equal(colaPorPerder([]), 0);
  assert.equal(colaPorPerder(undefined), 0);
  assert.equal(colaPorPerder([c('lista'), c('lista')]), 0);                           // lo armado ya está en el historial
  assert.equal(colaPorPerder([c('pendiente'), c('armando'), c('error'), c('lista')]), 3);   // con 4 pendientes, recargar los perdía sin avisar
});

enAmbas('parsearNumero: es-AR (coma decimal, punto de miles) y rechazo de lo ambiguo (worker y front)', ({ parsearNumero }) => {
  const casos = { '1.500': 1500, '1,5': 1.5, '1.250,50': 1250.5, '99,90': 99.9, '1500': 1500, '1.5': 1.5, '1234.56': 1234.56,
    '12.500': 12500, '1.234.567,8': 1234567.8, '0,5': 0.5, '-500': -500, ' 250 ': 250, 12.5: 12.5 };
  for (const [entrada, esperado] of Object.entries(casos)) assert.equal(parsearNumero(entrada), esperado, `"${entrada}"`);
  assert.equal(parsearNumero(15), 15);
  for (const malo of ['1e9', '0x10', 'abc', '', ' ', '1.2.3', '1,2,3', '1.2,3.4', '12,', ',5', '+5', '1 500', '١٢', '--5', '1_000', null, undefined, '99.999.999.999e3'])
    assert.ok(Number.isNaN(parsearNumero(malo)), `debería ser NaN: ${JSON.stringify(malo)}`);
});

enAmbas('parsearMonto: decimales es-AR bien leídos; negativo, ilegible o enorme = error y 0 (worker y front)', ({ parsearMonto }) => {
  assert.deepEqual(parsearMonto('99,90'), { valor: 99.9, error: '' });          // antes: 9.990
  assert.deepEqual(parsearMonto('1.250,50'), { valor: 1250.5, error: '' });     // antes: 125.050
  assert.deepEqual(parsearMonto('12.500'), { valor: 12500, error: '' });
  assert.deepEqual(parsearMonto(''), { valor: 0, error: '' });
  assert.deepEqual(parsearMonto('   '), { valor: 0, error: '' });
  for (const malo of ['-500', '1e9', '0x10', 'mil', '1.2.3', '99999999999']) {
    const r = parsearMonto(malo);
    assert.equal(r.valor, 0, malo);
    assert.ok(r.error.length > 5, `sin mensaje para ${malo}`);
  }
  assert.match(parsearMonto('-500').error, /negativo/);                         // antes: quedaba en 500
});

enAmbas('validarPaquete: peso en g enteros, medidas en cm, rango razonable y mensajes claros (worker y front)', ({ validarPaquete }) => {
  const ok = validarPaquete({ pesoG: '1.500', largoCm: '40', anchoCm: '30,4', altoCm: 15 });
  assert.deepEqual(ok, { ok: true, valores: { pesoG: 1500, largoCm: 40, anchoCm: 30, altoCm: 15 }, errores: [] });   // '1.500' era 2 g
  const base = { pesoG: '1500', largoCm: '40', anchoCm: '30', altoCm: '15' };
  const mal = (cambio, patron) => {
    const r = validarPaquete({ ...base, ...cambio });
    assert.equal(r.ok, false, JSON.stringify(cambio));
    assert.equal(r.valores, null);
    assert.match(r.errores.join(' '), patron, JSON.stringify(cambio));
  };
  mal({ pesoG: '1,5' }, /sin decimales/);                  // antes: 2 g
  mal({ pesoG: '99.999.999.999' }, /entre 1 g y 100\.000 g/);
  mal({ pesoG: '1e9' }, /no es un número/);
  mal({ pesoG: '0x10' }, /no es un número/);
  mal({ pesoG: '0' }, /entre 1 g/);
  mal({ pesoG: '-5' }, /entre 1 g/);
  mal({ pesoG: '100001' }, /entre 1 g/);
  assert.equal(validarPaquete({ ...base, pesoG: '100000' }).ok, true);
  mal({ largoCm: '301' }, /El largo tiene que estar entre 1 y 300 cm/);
  mal({ anchoCm: '0,2' }, /El ancho tiene que estar entre 1/);
  mal({ altoCm: 'alto' }, /El alto no es un número/);
  mal({ altoCm: '' }, /Falta el alto/);
  assert.equal(validarPaquete({ ...base, largoCm: '300' }).ok, true);
  assert.equal(validarPaquete({ ...base, largoCm: '0,5' }).valores.largoCm, 1);
  assert.deepEqual(validarPaquete(undefined).errores, ['Cargá el peso y las medidas del paquete.']);
  assert.deepEqual(validarPaquete({ pesoG: '', largoCm: '', anchoCm: '', altoCm: '' }).errores, ['Cargá el peso y las medidas del paquete.']);
});

test('armarItem y faltantes: un paquete fuera de rango nunca llega a /items/validate (me2 ni cuenta)', () => {
  const malos = [{ pesoG: '99.999.999.999' }, { pesoG: '1e9' }, { pesoG: '0x10' }, { pesoG: '1,5' }, { largoCm: '9999' }];
  for (const cambio of malos) {
    const p = { titulo: 'Taladro', categoria: 'MLA5232', precio: 45000, condicion: 'usado', fotos: ['p1'], atributos: [], paquete: { pesoG: '1500', largoCm: '40', anchoCm: '30', altoCm: '15', ...cambio } };
    for (const envio of ['me2', '']) {
      assert.match(faltantes({ ...p, envio }).join(' '), /el paquete de envío/, `${envio}:${JSON.stringify(cambio)}`);
      const item = armarItem({ ...p, envio }, { userProducts: true });
      assert.ok(!item.attributes.some(a => a.id.startsWith('SELLER_PACKAGE')), 'no debe mandar un paquete inválido');
      assert.equal(item.shipping?.dimensions, undefined);
    }
    assert.deepEqual(faltantes({ ...p, envio: 'retiro' }), []);
  }
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

enAmbas('aCentimetros y aGramos: convierten lo que escribió la IA o Nico (worker y front)', ({ aCentimetros, aGramos }) => {
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
  assert.equal(aCentimetros('1.200 mm'), 120);   // el punto es de miles (antes se leía como 1,2 mm)
  assert.equal(aGramos('1.500 g'), 1500);
  assert.equal(aCentimetros('1e9'), null);
  assert.equal(aGramos('0x10'), null);
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
  assert.deepEqual(faltantes({ ...BASE, envio: 'me2' }), ['el paquete de envío (Cargá el peso y las medidas del paquete.)']);
  assert.deepEqual(faltantes({ ...BASE, envio: 'me2', paquete: PAQ }), []);
  assert.deepEqual(faltantes({ ...BASE, envio: 'retiro' }), []);
  assert.deepEqual(faltantes({ ...BASE, envio: '' }), []);
});

test('textoEnvio y avisoEnvioGratis (front): el diálogo dice el envío y avisa si "Te queda" no lo descuenta', () => {
  const { textoEnvio, avisoEnvioGratis } = front;
  assert.equal(textoEnvio({ envio: 'retiro' }), 'solo retiro en persona');
  assert.equal(textoEnvio({ envio: 'me2', envioGratis: true, retiroTambien: true }), 'Mercado Envíos, envío gratis (lo pagás vos), y también retiro en persona');
  assert.equal(textoEnvio({ envio: 'me2' }), 'Mercado Envíos, el envío lo paga el comprador');
  assert.match(textoEnvio({ envio: '' }), /configurado tu cuenta/);
  assert.match(avisoEnvioGratis({ envio: 'me2', envioGratis: true, costoEnvio: 0 }), /NO lo descuenta/);
  assert.match(avisoEnvioGratis({ envio: 'me2', envioGratis: true, costoEnvio: '' }), /NO lo descuenta/);
  assert.equal(avisoEnvioGratis({ envio: 'me2', envioGratis: true, costoEnvio: 4000 }), '');   // con el costo cargado, "Te queda" ya lo descuenta
  assert.equal(avisoEnvioGratis({ envio: 'me2', envioGratis: false, costoEnvio: 0 }), '');
  assert.equal(avisoEnvioGratis({ envio: 'retiro', envioGratis: true, costoEnvio: 0 }), '');
});

await testA('huellaItem / estaValidado: la huella es estable y cambia con cualquier cambio de contenido', async () => {
  const kv = fakeKV();
  const a = { price: 45000, title: 'x', attributes: [{ id: 'A', value_name: '1' }], shipping: { mode: 'me2', local_pick_up: false } };
  const mismoEnOtroOrden = { shipping: { local_pick_up: false, mode: 'me2' }, attributes: [{ value_name: '1', id: 'A' }], title: 'x', price: 45000 };
  assert.equal(await huellaItem(a), await huellaItem(mismoEnOtroOrden));
  assert.match(await huellaItem(a), /^[0-9a-f]{64}$/);
  assert.equal(await estaValidado(kv, a), false);
  await marcarValidado(kv, a);
  assert.equal(await estaValidado(kv, a), true);
  assert.equal(await estaValidado(kv, mismoEnOtroOrden), true);
  for (const cambio of [{ price: 45001 }, { title: 'y' }, { shipping: { mode: 'me2', local_pick_up: true } }, { attributes: [] }])
    assert.equal(await estaValidado(kv, { ...a, ...cambio }), false, JSON.stringify(cambio));
  await gastarValidacion(kv, a);
  assert.equal(await estaValidado(kv, a), false);
  assert.ok([...kv.escrituras].every(e => e.ttl >= 60), 'la marca debe vencer (TTL de KV ≥ 60 s)');
});

/* El Worker de punta a punta con MercadoLibre simulado (ninguna llamada sale a la red). */
function fakeKV() {
  const datos = new Map();
  return { datos, escrituras: [],
    async get(k, tipo) { const v = datos.get(k); return v === undefined ? null : tipo === 'json' ? JSON.parse(v) : v; },
    async put(k, v, opts) { datos.set(k, v); this.escrituras.push({ k, ttl: opts?.expirationTtl }); },
    async delete(k) { datos.delete(k); } };
}

await testA('Worker: /api/publicar solo publica lo que pasó /api/revisar con ese mismo contenido', async () => {
  const { default: worker } = await import('./worker.js');
  const llamadas = [];
  let validador = () => ({ status: 200, cuerpo: {} });
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const ruta = String(url).replace('https://api.mercadolibre.com', '');
    llamadas.push(`${init.method || 'GET'} ${ruta}`);
    const responder = (status, cuerpo) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
    if (ruta === '/users/me') return responder(200, { id: 1, nickname: 'prueba', tags: ['user_product_seller'] });
    if (ruta === '/items/validate') { const r = validador(JSON.parse(init.body)); return responder(r.status, r.cuerpo); }
    if (ruta === '/items') return responder(201, { id: 'MLA999000001', permalink: 'https://articulo.mercadolibre.com.ar/MLA-999000001', status: 'active' });
    if (ruta.endsWith('/description')) return responder(201, {});
    if (ruta === '/pictures/items/upload') return responder(201, { id: 'subida' });
    return responder(404, { message: `ruta no simulada: ${ruta}` });
  };
  try {
    const kv = fakeKV();
    await kv.put('ml:tokens', JSON.stringify({ access_token: 't', refresh_token: 'r', user_id: 1, vence: Date.now() + 3600e3 }));
    const env = { KV: kv, APP_SECRET: 'secreto' };
    const llamar = async (ruta, cuerpo) => {
      const r = await worker.fetch(new Request(`https://w.test${ruta}`, { method: 'POST', body: JSON.stringify(cuerpo),
        headers: { origin: 'http://localhost:5610', 'x-clave': 'secreto', 'content-type': 'application/json' } }), env);
      return { status: r.status, ...(await r.json()) };
    };
    const pub = (extra = {}) => ({ titulo: 'Taladro percutor', categoria: 'MLA5232', precio: 45000, condicion: 'usado', cantidad: 1, tipoPublicacion: 'gold_special',
      envio: 'me2', paquete: { pesoG: '1500', largoCm: '40', anchoCm: '30', altoCm: '15' }, descripcion: 'Anda bien', atributos: [], ...extra });
    const cuerpo = (extra, fotos = [{ id: 'p1' }]) => ({ publicacion: pub(extra), fotos });
    const creados = () => llamadas.filter(l => l === 'POST /items').length;

    // 1) publicar SIN revisar: rechazado, y no crea nada (el caso del paquete que se saltaba el validador)
    let r = await llamar('/api/publicar', cuerpo());
    assert.equal(r.status, 412);
    assert.match(r.error, /no pasó la revisión/);
    assert.equal(creados(), 0);

    // 2) revisar (el validador aprueba) → publicar con el mismo contenido: sale
    r = await llamar('/api/revisar', cuerpo());
    assert.equal(r.ok, true);
    // 2b) cambiar el precio después de revisar: otro contenido, rechazado
    r = await llamar('/api/publicar', cuerpo({ precio: 46000 }));
    assert.equal(r.status, 412);
    assert.equal(creados(), 0);
    // 2b') cambiar solo la descripción después de revisar: también (va aparte del ítem pero se sella con él)
    r = await llamar('/api/publicar', cuerpo({ descripcion: 'Otra descripción' }));
    assert.equal(r.status, 412);
    assert.equal(creados(), 0);
    // 2c) cambiar el paquete después de revisar: también
    r = await llamar('/api/publicar', cuerpo({ paquete: { pesoG: '1600', largoCm: '40', anchoCm: '30', altoCm: '15' } }));
    assert.equal(r.status, 412);
    // 2d) el contenido revisado, tal cual: publica (y la descripción, aparte, también)
    r = await llamar('/api/publicar', cuerpo());
    assert.equal(r.status, 200);
    assert.equal(r.id, 'MLA999000001');
    assert.equal(creados(), 1);
    assert.ok(llamadas.includes('POST /items/MLA999000001/description'));

    // 3) la revisión se gasta: repetir el mismo POST no crea una segunda publicación
    r = await llamar('/api/publicar', cuerpo());
    assert.equal(r.status, 412);
    assert.equal(creados(), 1);

    // 4) una foto sin id nunca fue revisada: se rechaza antes de subir nada
    const subidasAntes = llamadas.filter(l => l.includes('/pictures/')).length;
    r = await llamar('/api/publicar', cuerpo({}, [{ id: 'p1' }, { dataUrl: 'data:image/jpeg;base64,AAAA' }]));
    assert.equal(r.status, 412);
    assert.equal(llamadas.filter(l => l.includes('/pictures/')).length, subidasAntes);

    // 5) el validador rechaza con errores: no queda marca, publicar falla
    validador = () => ({ status: 400, cuerpo: { cause: [{ type: 'error', code: 'item.attribute.invalid', message: 'atributo inválido' }] } });
    r = await llamar('/api/revisar', cuerpo({ titulo: 'Otro título' }));
    assert.equal(r.ok, false);
    r = await llamar('/api/publicar', cuerpo({ titulo: 'Otro título' }));
    assert.equal(r.status, 412);
    assert.equal(creados(), 1);

    // 6) solo avisos (type warning): se puede publicar
    validador = () => ({ status: 400, cuerpo: { cause: [{ type: 'warning', code: 'shipping.lost_me2_by_catalog', message: 'aviso' }] } });
    r = await llamar('/api/revisar', cuerpo({ titulo: 'Con aviso' }));
    assert.equal(r.ok, true);
    assert.equal(r.avisos.length, 1);
    r = await llamar('/api/publicar', cuerpo({ titulo: 'Con aviso' }));
    assert.equal(r.status, 200);
    assert.equal(creados(), 2);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

/* Contrato con MercadoLibre REAL: respuestas públicas grabadas con tools/grabar-fixtures.mjs
   (8 rubros distintos). Si ML cambia la forma, se vuelve a grabar y estos tests lo dicen. */
const contrato = JSON.parse(readFileSync(new URL('./fixtures/contrato-ml.json', import.meta.url)));

test('contrato real: domain_discovery y categoría tienen los campos que el Worker lee', () => {
  assert.ok(contrato.casos.length >= 6, 'pocos rubros grabados');
  for (const c of contrato.casos) {
    const d = c.discovery[0];
    for (const k of ['category_id', 'category_name', 'domain_name']) assert.equal(typeof d[k], 'string', `${c.busqueda}: discovery.${k}`);
    assert.match(d.category_id, /^MLA\d+$/);
    const cat = c.categoria;
    assert.equal(cat.id, d.category_id);
    assert.ok(Array.isArray(cat.path_from_root) && cat.path_from_root.every(p => typeof p.name === 'string'), `${c.busqueda}: path_from_root`);
    assert.ok(Number.isFinite(cat.settings?.max_title_length) && cat.settings.max_title_length >= 30, `${c.busqueda}: max_title_length`);
    assert.ok(Number.isFinite(cat.settings?.max_pictures_per_item), `${c.busqueda}: max_pictures_per_item`);
    assert.ok(cat.settings?.minimum_price === undefined || cat.settings.minimum_price === null || Number.isFinite(cat.settings.minimum_price), `${c.busqueda}: minimum_price`);
  }
});

test('contrato real: elegirAtributos con los atributos de 8 categorías reales, nuevo y usado', () => {
  for (const c of contrato.casos) {
    assert.ok(Array.isArray(c.atributos) && c.atributos.length > 10, `${c.busqueda}: atributos`);
    for (const condicion of ['nuevo', 'usado']) {
      const el = elegirAtributos(c.atributos, condicion);
      assert.ok(el.length > 0, `${c.busqueda}/${condicion}: vacío`);
      assert.equal(new Set(el.map(a => a.id)).size, el.length, `${c.busqueda}/${condicion}: ids repetidos`);
      assert.ok(el.filter(a => !a.requerido).length <= 12);
      for (const a of el) {
        assert.equal(typeof a.id, 'string');
        assert.equal(typeof a.nombre, 'string', `${c.busqueda}: ${a.id} sin nombre`);
        assert.equal(typeof a.tipo, 'string', `${c.busqueda}: ${a.id} sin value_type`);
        assert.ok(Array.isArray(a.opciones) && Array.isArray(a.unidades));
        assert.ok(a.opciones.every(o => o.id && o.nombre), `${c.busqueda}: ${a.id} opción rara`);
      }
      // lo que ML marca como obligatorio para esa condición tiene que aparecer
      const obligatorios = c.atributos.filter(a => { const t = a.tags || {}; return (t.required || t.catalog_required || t.conditional_required || (condicion === 'nuevo' && t.new_required)) && !t[condicion === 'nuevo' ? 'new_hidden' : 'used_hidden'] && !t.read_only && !t.fixed && !t.inferred && !['ITEM_CONDITION', 'EMPTY_GTIN_REASON', 'SELLER_SKU'].includes(a.id); });
      const ids = new Set(el.map(a => a.id));
      assert.ok(obligatorios.every(a => ids.has(a.id)), `${c.busqueda}/${condicion}: falta un obligatorio`);
    }
  }
});

test('contrato real: GRADING (used_hidden) no se pide en auriculares ni heladera usados; lo oculto nunca se elige', () => {
  const ocultoPara = { nuevo: 'new_hidden', usado: 'used_hidden' };
  for (const c of contrato.casos) {
    for (const condicion of ['nuevo', 'usado']) {
      const ids = new Set(elegirAtributos(c.atributos, condicion).map(a => a.id));
      for (const a of c.atributos) {
        if (a.tags?.[ocultoPara[condicion]]) assert.ok(!ids.has(a.id), `${c.busqueda}/${condicion}: ${a.id} está oculto para esa condición`);
      }
    }
  }
  for (const rubro of ['auriculares bluetooth', 'heladera no frost']) {
    const c = contrato.casos.find(x => x.busqueda === rubro);
    assert.ok(c.atributos.some(a => a.id === 'GRADING' && a.tags?.used_hidden), `${rubro}: el fixture ya no tiene GRADING used_hidden`);
    assert.ok(!elegirAtributos(c.atributos, 'usado').some(a => a.id === 'GRADING'), `${rubro}: GRADING en usado`);
  }
  // Una condición sin tag oculto no pierde atributos (reacondicionado no usa used_hidden).
  const hid = [{ id: 'GRADING', name: 'Gradación', value_type: 'list', tags: { used_hidden: true, conditional_required: true }, values: [] }];
  assert.equal(elegirAtributos(hid, 'usado').length, 0);
  assert.equal(elegirAtributos(hid, 'reacondicionado').length, 1);
});

test('aplicarDefaults: UNITS_PER_PACK vacío va con 1 (ML corrige 10 a 1); un valor ya cargado no se pisa', () => {
  const r = aplicarDefaults([
    { id: 'UNITS_PER_PACK', tipo: 'number', valor: '', opciones: [] },
    { id: 'UNITS_PER_PACK', tipo: 'number', valor: '6', opciones: [] }
  ]);
  assert.equal(r[0].valor, '1');
  assert.equal(r[1].valor, '6');
  // y el contrato real de la mesa ratona: el atributo llega al ítem como 1
  const mesa = contrato.casos.find(x => x.busqueda === 'mesa ratona de madera');
  const el = aplicarDefaults(elegirAtributos(mesa.atributos, 'usado'));
  assert.equal(el.find(a => a.id === 'UNITS_PER_PACK').valor, '1');
});

test('contrato real: atributoParaML arma un atributo válido con cada opción real', () => {
  for (const c of contrato.casos) {
    for (const a of elegirAtributos(c.atributos, 'usado').filter(x => x.opciones.length)) {
      const o = a.opciones[0];
      const r = atributoParaML(a, o.nombre);
      assert.equal(r.id, a.id);
      assert.equal(r.value_id, o.id, `${c.busqueda}: ${a.id} no encontró su propia opción`);
    }
  }
});

test('leerVisitas: entiende el mapa documentado, la lista y el ítem suelto; descarta lo raro', () => {
  assert.deepEqual(leerVisitas({ MLA1: 12, MLA2: 0 }), { MLA1: 12, MLA2: 0 });
  assert.deepEqual(leerVisitas([{ item_id: 'MLA1', total_visits: 7 }, { id: 'MLA2', visits: 3 }]), { MLA1: 7, MLA2: 3 });
  assert.deepEqual(leerVisitas({ item_id: 'MLA1', total_visits: 9, results: [] }), { MLA1: 9 });
  assert.deepEqual(leerVisitas({ MLA1: { total_visits: 5 } }), { MLA1: 5 });
  assert.deepEqual(leerVisitas({ message: 'Not found', status: 404, MLA1: null }), {});
  assert.deepEqual(leerVisitas(null), {});
  assert.deepEqual(leerVisitas([]), {});
});

test('separarCausas: la guía de talles de ropa y calzado se explica, sin el código técnico', () => {
  for (const code of ['missing.fashion_grid.grid_id.values', 'invalid.fashion_grid.grid_id.values']) {
    const r = separarCausas({ cause: [{ type: 'error', code, message: 'Attribute [SIZE_GRID_ID] is missing' }] });
    assert.equal(r.errores.length, 1);
    assert.match(r.errores[0], /guía de talles/);
    assert.match(r.errores[0], /Publicala directo desde MercadoLibre/);
    assert.doesNotMatch(r.errores[0], /SIZE_GRID_ID|fashion_grid/);
  }
});

test('armarSeguimiento: preguntas null = no se pudo consultar, no "cero preguntas"', () => {
  const items = [{ id: 'MLA1', status: 'active', sold_quantity: 0, available_quantity: 1, price: 10 }];
  assert.equal(armarSeguimiento(items, {}, null).MLA1.preguntas, null);
  assert.equal(armarSeguimiento(items, {}, []).MLA1.preguntas, 0);
});

test('elegirAtributos: nunca pide SIZE_GRID_ID ni ids de grilla (ML los asigna y rechaza el texto libre)', () => {
  const zap = contrato.casos.find(x => x.categoria.id === 'MLA109027');
  assert.ok(zap.atributos.some(a => a.id === 'SIZE_GRID_ID' && a.value_type === 'grid_id'), 'el fixture ya no tiene SIZE_GRID_ID');
  for (const condicion of ['nuevo', 'usado']) {
    const ids = elegirAtributos(zap.atributos, condicion).map(a => a.id);
    assert.ok(!ids.includes('SIZE_GRID_ID') && !ids.includes('SIZE_GRID_ROW_ID'), condicion);
    assert.ok(ids.includes('SIZE') && ids.includes('GENDER'), 'el talle y el género siguen yendo');
  }
  for (const c of contrato.casos) for (const a of elegirAtributos(c.atributos, 'usado')) assert.ok(!/grid/.test(a.tipo), `${c.busqueda}: ${a.id} es de grilla`);
});

await testA('Worker: preguntas y visitas con permisos bloqueados o formas distintas, sin tocar nada real', async () => {
  const { default: worker } = await import('./worker.js');
  const fetchOriginal = globalThis.fetch;
  const llamadas = [];
  let modo = 'bloqueado';
  const bloqueo = { blocked_by: 'PolicyAgent', code: 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES', message: 'At least one policy returned UNAUTHORIZED.', status: 403 };
  globalThis.fetch = async (url, init = {}) => {
    const ruta = String(url).replace('https://api.mercadolibre.com', '');
    llamadas.push(`${init.method || 'GET'} ${ruta}`);
    const responder = (status, cuerpo) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
    if (ruta === '/users/me') return responder(200, { id: 77, nickname: 'prueba', tags: [] });
    if (ruta.startsWith('/items?ids=')) return responder(200, [
      { code: 200, body: { id: 'MLA1', status: 'active', sold_quantity: 0, available_quantity: 1, price: 100 } },
      { code: 200, body: { id: 'MLA2', status: 'active', sold_quantity: 0, available_quantity: 1, price: 200 } }]);
    // Con la cuenta real (12/11/2026): /visits/items?ids=A,B da 400 "maximum amount of items to query is 1" (un ítem por llamada).
    const idVisita = (/^\/visits\/items\?ids=([^&]+)/.exec(ruta) || /^\/items\/([^/]+)\/visits\/time_window/.exec(ruta) || [])[1];
    if (ruta.startsWith('/visits/items')) {
      if (idVisita.includes(',')) return responder(400, { code: 'validation_parameters', message: 'maximum amount of items to query is 1' });
      if (modo === 'bloqueado') return responder(403, bloqueo);
      if (modo === 'ventana') return responder(400, { code: 'validation_parameters', message: 'invalid parameters' });
      if (modo === 'lista') return responder(200, [{ item_id: idVisita, total_visits: { MLA1: 4, MLA2: 6 }[idVisita] }]);
      return responder(200, { [idVisita]: { MLA1: 11, MLA2: 0 }[idVisita] });
    }
    if (ruta.includes('/visits/time_window')) return modo === 'ventana' ? responder(200, { item_id: idVisita, total_visits: { MLA1: 8, MLA2: 1 }[idVisita], results: [] })
      : modo === 'bloqueado' ? responder(403, bloqueo) : responder(404, { message: 'no simulada' });
    if (ruta.startsWith('/my/received_questions/search')) return modo === 'nuevo-ok' ? responder(200, { questions: [{ id: 5, item_id: 'MLA1', text: 'Hola', date_created: 'x' }] }) : responder(403, bloqueo);
    if (ruta.startsWith('/questions/search?seller_id=77')) return modo === 'viejo-ok' ? responder(200, { questions: [{ id: 6, item_id: 'MLA2', text: 'Envían?', date_created: 'y' }] }) : responder(403, bloqueo);
    if (ruta === '/answers') return responder(403, bloqueo);
    return responder(404, { message: `ruta no simulada: ${ruta}` });
  };
  try {
    const kv = fakeKV();
    await kv.put('ml:tokens', JSON.stringify({ access_token: 't', refresh_token: 'r', user_id: 77, vence: Date.now() + 3600e3 }));
    await kv.put('regs', JSON.stringify([
      { id: 'aaaa1111', titulo: 'Uno', estado: 'publicada', mlId: 'MLA1' }, { id: 'bbbb2222', titulo: 'Dos', estado: 'publicada', mlId: 'MLA2' }]));
    const env = { KV: kv, APP_SECRET: 'secreto' };
    const llamar = async (metodo, ruta, cuerpo) => {
      const r = await worker.fetch(new Request(`https://w.test${ruta}`, { method: metodo, body: cuerpo ? JSON.stringify(cuerpo) : undefined,
        headers: { origin: 'http://localhost:5610', 'x-clave': 'secreto', 'content-type': 'application/json' } }), env);
      return { status: r.status, ...(await r.json()) };
    };

    // 1) los dos recursos de preguntas bloqueados: error claro con el permiso a activar, y se probaron los dos
    let r = await llamar('GET', '/api/preguntas');
    assert.equal(r.status, 403);
    assert.match(r.error, /Comunicaciones pre y post venta/);
    assert.match(r.error, /Volver a conectar/);
    assert.ok(llamadas.some(l => l.startsWith('GET /my/received_questions')) && llamadas.some(l => l.startsWith('GET /questions/search?seller_id=77')));

    // 2) el recurso nuevo bloqueado pero el documentado por vendedor anda: se usa ese
    modo = 'viejo-ok';
    r = await llamar('GET', '/api/preguntas');
    assert.equal(r.status, 200);
    assert.equal(r.preguntas.length, 1);
    assert.equal(r.preguntas[0].registroId, 'bbbb2222');

    // 3) seguimiento con todo bloqueado: el estado sale, visitas y preguntas en null (no en 0) y el diagnóstico dice por qué
    modo = 'bloqueado';
    r = await llamar('GET', '/api/seguimiento?forzar=1');
    assert.equal(r.status, 200);
    assert.equal(r.registros.aaaa1111.estado, 'activa');
    assert.equal(r.registros.aaaa1111.visitas, null);
    assert.equal(r.registros.aaaa1111.preguntas, null);
    assert.equal(r.diagnostico.visitas.estado, 403);
    assert.equal(r.diagnostico.visitas.codigo, 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES');
    assert.equal(r.diagnostico.preguntas.estado, 403);
    assert.ok(!JSON.stringify(r.diagnostico).includes('"t"'), 'el diagnóstico no lleva token');

    // 4) visitas como lista [{item_id,total_visits}] y preguntas por el recurso nuevo
    modo = 'lista';
    r = await llamar('GET', '/api/seguimiento?forzar=1');
    assert.equal(r.registros.aaaa1111.visitas, 4);
    assert.equal(r.registros.bbbb2222.visitas, 6);
    assert.equal(r.diagnostico.visitas.forma, 'lista');
    assert.equal(r.diagnostico.visitas.conDatos, 2);
    // un ítem por llamada: nunca "MLA1,MLA2" juntos (ML contesta 400 "maximum amount of items to query is 1")
    assert.ok(!llamadas.some(l => /^GET \/visits\/items\?ids=[^&]*,/.test(l)));
    assert.ok(llamadas.includes('GET /visits/items?ids=MLA1') && llamadas.includes('GET /visits/items?ids=MLA2'));

    // 4b) /visits/items falla con 400: se prueba el total de 90 días de cada ítem y se informa qué pasó con cada intento
    modo = 'ventana';
    r = await llamar('GET', '/api/seguimiento?forzar=1');
    assert.equal(r.registros.aaaa1111.visitas, 8);
    assert.equal(r.registros.bbbb2222.visitas, 1);
    assert.equal(r.diagnostico.visitas.via, 'visits/time_window');
    assert.equal(r.diagnostico.visitas.intentos.length, 4);
    assert.equal(r.diagnostico.visitas.intentos[0].estado, 400);
    assert.equal(r.diagnostico.visitas.intentos[0].codigo, 'validation_parameters');
    assert.equal(r.diagnostico.visitas.intentos[0].mensaje, 'invalid parameters');
    assert.ok(llamadas.includes('GET /items/MLA1/visits/time_window?last=90&unit=day'));

    // 5) visitas como mapa documentado + preguntas por el recurso nuevo
    modo = 'nuevo-ok';
    r = await llamar('GET', '/api/seguimiento?forzar=1');
    assert.equal(r.registros.aaaa1111.visitas, 11);
    assert.equal(r.registros.aaaa1111.preguntas, 1);
    assert.equal(r.registros.bbbb2222.preguntas, 0);
    assert.equal(r.diagnostico.preguntas.via, 'my/received_questions');

    // 6) responder con el permiso bloqueado: mensaje claro (esto simula el rechazo, no se envía nada real)
    r = await llamar('POST', '/api/preguntas/5/responder', { texto: 'Sí, hay stock' });
    assert.equal(r.status, 403);
    assert.match(r.error, /Comunicaciones pre y post venta/);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

await testA('Worker: con el token vencido, pedidos simultáneos comparten UN solo refresco (el refresh token es de un solo uso)', async () => {
  const { default: worker } = await import('./worker.js');
  const fetchOriginal = globalThis.fetch;
  let refrescos = 0;
  globalThis.fetch = async (url, init = {}) => {
    const ruta = String(url).replace('https://api.mercadolibre.com', '');
    const responder = (status, cuerpo) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
    if (ruta === '/oauth/token') {
      refrescos++;
      await new Promise(r => setTimeout(r, 20));
      // el refresh token es de un solo uso: el segundo intento falla, como en MercadoLibre real
      return refrescos === 1 ? responder(200, { access_token: 'nuevo', refresh_token: 'r2', user_id: 1, expires_in: 21600 }) : responder(400, { error: 'invalid_grant' });
    }
    if (ruta === '/users/me') return responder(200, { id: 1, nickname: 'prueba', tags: [] });
    return responder(404, {});
  };
  try {
    const kv = fakeKV();
    await kv.put('ml:tokens', JSON.stringify({ access_token: 'viejo', refresh_token: 'r1', user_id: 1, vence: Date.now() - 1000 }));
    const env = { KV: kv, APP_SECRET: 's', ML_CLIENT_ID: 'i', ML_CLIENT_SECRET: 'c', ANTHROPIC_API_KEY: 'a' };
    const pedir = () => worker.fetch(new Request('https://w.test/api/estado', { headers: { origin: 'http://localhost:5610', 'x-clave': 's' } }), env).then(async r => ({ status: r.status, ...(await r.json()) }));
    const rs = await Promise.all([pedir(), pedir(), pedir()]);
    assert.equal(refrescos, 1, 'se refrescó más de una vez');
    for (const r of rs) {
      assert.equal(r.status, 200);
      assert.equal(r.conectado, true);
      assert.ok(r.token.venceEnMin > 300, 'el token nuevo dura ~6 h');
      assert.match(r.token.ultimoRefresco, /^\d{4}-\d\d-\d\dT/);
    }
    assert.ok(!JSON.stringify(rs).includes('nuevo') && !JSON.stringify(rs).includes('r2'), 'la respuesta no debe incluir el token');
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

/* Scripts de validación contra ML real (tools/validar-*.mjs): sin clave no hacen nada y no filtran datos. */
import { spawnSync } from 'node:child_process';
const herramienta = n => fileURLToPath(new URL(`../tools/${n}`, import.meta.url));
const correr = (n, args = [], env = {}) => spawnSync(process.execPath, [herramienta(n), ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env } });

test('tools/validar-*: sin VENDELOYA_CLAVE terminan con error claro y sin tocar la red', () => {
  for (const s of ['validar-comision.mjs', 'validar-token.mjs', 'validar-seguimiento.mjs', 'validar-preguntas.mjs']) {
    const r = correr(s);
    assert.equal(r.status, 1, s);
    assert.match(r.stderr + r.stdout, /Falta la variable VENDELOYA_CLAVE/, s);
  }
});

test('tools/validar-lote --seco: 8 borradores reales, ninguno con campos faltantes, la mitad con me2', () => {
  const r = correr('validar-lote.mjs', ['--seco']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^8 borradores de prueba \(4 con Mercado Envíos y paquete\)/);
  const lineas = r.stdout.split('\n').filter(l => l.startsWith('- '));
  assert.equal(lineas.length, 8);
  assert.ok(lineas.every(l => l.includes('| faltan: 0 |')), r.stdout);
  assert.equal(lineas.filter(l => l.endsWith('shipping: me2')).length, 4);
  assert.equal(lineas.filter(l => l.endsWith('shipping: not_specified')).length, 4);
});

test('tools/_cliente forma(): muestra la estructura sin los valores', async () => {
  const { forma } = await import('../tools/_cliente.mjs');
  assert.deepEqual(forma({ id: 'MLA1', nombre: 'Juan Pérez', n: 3, ok: true, x: null, l: [{ a: 'q' }, { a: 'r' }] }),
    { id: 'string', nombre: 'string', n: 'number', ok: 'boolean', x: 'null', l: [{ a: 'string' }, '… 2 en total'] });
});

/* Respaldo del historial: qué se importa de un archivo (respaldo.js, el mismo que carga la app). */
import { createRequire } from 'node:module';
const { planImportacion, resumenImportacion } = createRequire(import.meta.url)('../respaldo.js');

test('respaldo: importa solo lo nuevo, no pisa lo existente y descarta lo inválido', () => {
  const reg = (id, extra = {}) => ({ id, creado: 'x', fotos: [{ id: 'f' }], thumb: 't', estado: 'borrador', basura: 1, ...extra });
  const archivo = { app: 'VendeloYa', exportado: '2026-11-07', registros: [
    reg('aaaaaaaa-1'), reg('bbbbbbbb-2'), reg('bbbbbbbb-2'), reg('corto'), reg('cccccccc-3', { fotos: 'no' }),
    null, { id: 'dddddddd-4' }, reg('eeeeeeee-5', { ml: { id: 'MLA1', permalink: 'p' }, estado: 'publicada' })
  ] };
  const plan = planImportacion(archivo, new Set(['aaaaaaaa-1']));
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.importar.map(r => r.id), ['bbbbbbbb-2', 'eeeeeeee-5']);
  assert.deepEqual(plan.yaExistian, ['aaaaaaaa-1']);
  assert.deepEqual(plan.invalidos.map(i => i.n), [3, 4, 5, 6, 7]);
  assert.deepEqual(Object.keys(plan.importar[0].cambios).sort(), ['estado', 'fotos', 'thumb']);   // 'basura' y 'creado' no entran
  assert.equal(plan.importar[1].cambios.ml.id, 'MLA1');
  assert.equal(resumenImportacion(plan, 2), '2 registros cargados · 1 ya estaba (no se pisan) · 5 inválidos descartados');
});

test('respaldo: rechaza archivos que no son de VendeloYa, sin registros o demasiado grandes', () => {
  for (const malo of [null, [], 'x', { app: 'Otra', registros: [] }, { app: 'VendeloYa' }, { app: 'VendeloYa', registros: {} }])
    assert.equal(planImportacion(malo, []).ok, false, JSON.stringify(malo));
  const muchos = { app: 'VendeloYa', registros: Array.from({ length: 201 }, (_, i) => ({ id: `registro-${String(i).padStart(4, '0')}`, estado: 'borrador' })) };
  assert.match(planImportacion(muchos, []).error, /máximo es 200/);
  assert.equal(planImportacion({ app: 'VendeloYa', registros: [] }, []).importar.length, 0);
});

/* ---- Guías de talles (ropa y calzado) ---- */
const guiaFalsa = (id = '426238', type = 'STANDARD') => ({
  id, type, names: { MLA: 'Guía de talles Standard de calzado de hombre' }, main_attribute_id: 'AR_SIZE',
  rows: ['40', '41', '42'].map((n, i) => ({ id: `${id}:${i + 1}`, attributes: [
    { id: 'SIZE', values: [{ name: `${n} AR` }] }, { id: 'AR_SIZE', values: [{ name: `${n} AR` }] },
    { id: 'M_US_SIZE', values: [{ name: `${8.5 + i / 2} US`.replace('.', ',') }] }] }))
});

test('guía de talles: la categoría de zapatillas pide guía y GENDER es lo que define la búsqueda', () => {
  const zap = contrato.casos.find(x => x.categoria.id === 'MLA109027');
  const r = requisitosDeGuia(zap.atributos);
  assert.equal(r.pide, true);
  assert.deepEqual(r.plantilla, ['GENDER']);
  for (const c of contrato.casos.filter(x => x.categoria.id !== 'MLA109027')) assert.equal(requisitosDeGuia(c.atributos).pide, false, c.busqueda);
});

test('guía de talles: el cuerpo de la búsqueda lleva dominio sin prefijo, vendedor, género y marca; avisa si falta el género', () => {
  const req = { pide: true, plantilla: ['GENDER'] };
  const atributos = [{ id: 'GENDER', valor: 'Hombre' }, { id: 'BRAND', valor: 'Adidas' }, { id: 'COLOR', valor: 'Negro' }];
  const { cuerpo, faltan } = armarBusquedaGuia({ dominio: 'MLA-SNEAKERS', sitio: 'MLA', vendedor: 123, requisitos: req, atributos });
  assert.equal(cuerpo.domain_id, 'SNEAKERS');
  assert.equal(cuerpo.site_id, 'MLA');
  assert.equal(cuerpo.seller_id, 123);
  assert.deepEqual(cuerpo.attributes, [{ id: 'GENDER', values: [{ name: 'Hombre' }] }, { id: 'BRAND', values: [{ name: 'Adidas' }] }]);
  assert.deepEqual(faltan, []);
  assert.deepEqual(armarBusquedaGuia({ dominio: 'MLA-SNEAKERS', vendedor: 1, requisitos: req, atributos, sinMarca: true }).cuerpo.attributes.map(a => a.id), ['GENDER']);
  assert.deepEqual(armarBusquedaGuia({ dominio: 'SNEAKERS', vendedor: 1, requisitos: req, atributos: [{ id: 'BRAND', valor: 'X' }] }).faltan, ['GENDER']);
});

test('guía de talles: elige la de la marca, si no la estándar, si no una propia; nunca una de otra marca', () => {
  const ch = (id, type, nombre) => ({ id, type, names: { MLA: nombre } });
  const lista = [ch('1', 'BRAND', 'Guía de calzado de mujer de adidas'), ch('2', 'SPECIFIC', 'Mi guía'), ch('3', 'STANDARD', 'Standard')];
  assert.equal(elegirGuia(lista, 'adidas').id, '1');
  assert.equal(elegirGuia(lista, 'Nike').id, '3');   // la de adidas no sirve para Nike
  assert.equal(elegirGuia(lista, '').id, '3');
  assert.equal(elegirGuia([lista[1]], 'Nike').id, '2');
  assert.equal(elegirGuia([], 'Nike'), null);
  assert.equal(elegirGuia([{ type: 'STANDARD' }], ''), null);
});

test('guía de talles: la fila sale del talle (por nombre, por número, en cualquier columna) o no hay fila', () => {
  const g = guiaFalsa();
  assert.deepEqual(filaDeGuia(g, '41 AR'), { fila: '426238:2', talle: '41 AR' });
  assert.deepEqual(filaDeGuia(g, '41'), { fila: '426238:2', talle: '41 AR' });
  assert.deepEqual(filaDeGuia(g, '9,5 US'), { fila: '426238:3', talle: '42 AR' });
  assert.deepEqual(filaDeGuia(g, '9'), { fila: '426238:2', talle: '41 AR' });   // "9 US" en otra columna
  // el número del talle principal gana sobre el mismo número en otra columna (largo del pie, etc.)
  const guia2 = { rows: [
    { id: '7:1', attributes: [{ id: 'SIZE', values: [{ name: 'M' }] }, { id: 'FOOT_LENGTH', values: [{ name: '41 cm' }] }] },
    { id: '7:2', attributes: [{ id: 'SIZE', values: [{ name: '41 AR' }] }] }] };
  assert.deepEqual(filaDeGuia(guia2, '41'), { fila: '7:2', talle: '41 AR' });
  assert.equal(filaDeGuia(g, '50'), null);
  assert.equal(filaDeGuia(g, ''), null);
  assert.equal(filaDeGuia({ rows: [] }, '40'), null);
  assert.deepEqual(tallesDeGuia(g), ['40 AR', '41 AR', '42 AR']);
});

test('guía de talles: aplicarGuia deja el talle de la fila y armarItem manda SIZE_GRID_ID y SIZE_GRID_ROW_ID; sin guía no manda nada', () => {
  const base = { titulo: 'Zapatillas', categoria: 'MLA109027', precio: 30000, condicion: 'usado', cantidad: 1, fotos: ['f'], envio: 'retiro',
    atributos: [{ id: 'SIZE', valor: '41', opciones: [{ id: '1', nombre: '41' }] }, { id: 'GENDER', valor: 'Hombre', opciones: [] }] };
  const p = aplicarGuia(base, guiaFalsa(), { fila: '426238:2', talle: '41 AR' });
  assert.equal(p.atributos.filter(a => a.id === 'SIZE').length, 1);
  assert.equal(p.atributos.find(a => a.id === 'SIZE').valor, '41 AR');
  const item = armarItem(p, { userProducts: true });
  assert.deepEqual(item.attributes.find(a => a.id === 'SIZE_GRID_ID'), { id: 'SIZE_GRID_ID', value_name: '426238' });
  assert.deepEqual(item.attributes.find(a => a.id === 'SIZE_GRID_ROW_ID'), { id: 'SIZE_GRID_ROW_ID', value_name: '426238:2' });
  assert.equal(item.attributes.find(a => a.id === 'SIZE').value_name, '41 AR');
  assert.ok(!armarItem(base, { userProducts: true }).attributes.some(a => /GRID/.test(a.id)));
  assert.equal(base.atributos[0].valor, '41', 'no muta la publicación original');
});

await testA('Worker: ropa y calzado buscan la guía (solo lectura), la asocian al ítem y nunca crean una', async () => {
  const { default: worker } = await import('./worker.js');
  const zap = contrato.casos.find(x => x.categoria.id === 'MLA109027');
  const llamadas = [];
  const busquedas = [];
  let charts = [{ id: '426238', type: 'STANDARD', names: { MLA: 'Standard' } }];
  let vaciaConMarca = false;   // simula que con la marca en el filtro no hay guía, y sin ella sí
  let validador = () => ({ status: 200, cuerpo: {} });
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const ruta = String(url).replace('https://api.mercadolibre.com', '');
    llamadas.push(`${init.method || 'GET'} ${ruta}`);
    const r = (status, cuerpo) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
    if (ruta === '/users/me') return r(200, { id: 77, nickname: 'prueba', tags: ['user_product_seller'] });
    if (ruta === '/categories/MLA109027/attributes') return r(200, zap.atributos);
    if (ruta === '/categories/MLA109027') return r(200, zap.categoria);
    if (ruta === '/categories/MLA5232/attributes') return r(200, contrato.casos.find(x => x.categoria.id === 'MLA5232').atributos);
    if (ruta.startsWith('/sites/MLA/domain_discovery/search')) return r(200, zap.discovery);
    if (ruta === '/catalog/charts/search') { const cuerpoBusqueda = JSON.parse(init.body);
      busquedas.push({ cuerpo: cuerpoBusqueda, caller: init.headers['x-caller-id'] });
      return r(200, { charts: vaciaConMarca && cuerpoBusqueda.attributes.some(a => a.id === 'BRAND') ? [] : charts }); }
    if (ruta === '/catalog/charts/426238') return r(200, guiaFalsa());
    if (ruta === '/items/validate') { const v = validador(JSON.parse(init.body)); return r(v.status, v.cuerpo); }
    if (ruta === '/items') return r(201, { id: 'MLA999000002', permalink: 'p', status: 'active' });
    if (ruta.endsWith('/description')) return r(201, {});
    return r(404, { message: `ruta no simulada: ${ruta}` });
  };
  try {
    const kv = fakeKV();
    await kv.put('ml:tokens', JSON.stringify({ access_token: 't', refresh_token: 'r', user_id: 77, vence: Date.now() + 3600e3 }));
    const env = { KV: kv, APP_SECRET: 'secreto' };
    const llamar = async (ruta, cuerpo) => {
      const res = await worker.fetch(new Request(`https://w.test${ruta}`, { method: 'POST', body: JSON.stringify(cuerpo),
        headers: { origin: 'http://localhost:5610', 'x-clave': 'secreto', 'content-type': 'application/json' } }), env);
      return { status: res.status, ...(await res.json()) };
    };
    const pub = (talle, extra = {}) => ({ titulo: 'Zapatillas running', categoria: 'MLA109027', precio: 30000, condicion: 'usado', cantidad: 1, tipoPublicacion: 'gold_special',
      envio: 'retiro', descripcion: 'Casi nuevas',
      atributos: [{ id: 'SIZE', valor: talle, opciones: [] }, { id: 'GENDER', valor: 'Hombre', opciones: [] }, { id: 'BRAND', valor: 'Adidas', opciones: [] }], ...extra });
    const cuerpo = (talle, extra) => ({ publicacion: pub(talle, extra), fotos: [{ id: 'p1' }] });

    // el explorador de solo lectura
    const g = await llamar('/api/guia-talles', { categoria: 'MLA109027', atributos: pub('41').atributos });
    assert.equal(g.pide, true);
    assert.equal(g.elegida.id, '426238');
    assert.deepEqual(g.talles, ['40 AR', '41 AR', '42 AR']);
    assert.equal(busquedas[0].cuerpo.domain_id, 'SNEAKERS');
    assert.equal(busquedas[0].cuerpo.seller_id, 77);
    assert.equal(busquedas[0].caller, '77');

    // revisar: la guía queda en el ítem que se valida
    let visto = null;
    validador = item => { visto = item; return { status: 200, cuerpo: {} }; };
    let r = await llamar('/api/revisar', cuerpo('41'));
    assert.equal(r.ok, true);
    assert.equal(r.guia.fila, '426238:2');
    assert.ok(visto.attributes.some(a => a.id === 'SIZE_GRID_ID' && a.value_name === '426238'));
    assert.ok(visto.attributes.some(a => a.id === 'SIZE_GRID_ROW_ID' && a.value_name === '426238:2'));
    // publicar con el mismo contenido: sale, con la misma guía
    r = await llamar('/api/publicar', cuerpo('41'));
    assert.equal(r.status, 200);

    // un talle que no está en la guía: error claro y no se valida ni se publica
    const antes = llamadas.filter(l => l === 'POST /items/validate').length;
    r = await llamar('/api/revisar', cuerpo('50'));
    assert.equal(r.ok, false);
    assert.match(r.errores[0], /no está en la guía de talles.*40 AR, 41 AR, 42 AR/);
    assert.equal(llamadas.filter(l => l === 'POST /items/validate').length, antes);

    // sin guía de la marca: reintenta sin la marca y usa la estándar
    vaciaConMarca = true;
    const intentos = busquedas.length;
    r = await llamar('/api/revisar', cuerpo('42'));
    assert.equal(r.ok, true);
    assert.equal(r.guia.id, '426238');
    assert.equal(busquedas.length - intentos, 2);
    assert.ok(!busquedas.at(-1).cuerpo.attributes.some(a => a.id === 'BRAND'));
    vaciaConMarca = false;

    // sin guía en MercadoLibre: se dice, y NO se crea nada
    charts = [];
    r = await llamar('/api/revisar', cuerpo('41'));
    assert.equal(r.ok, false);
    assert.match(r.errores[0], /no tiene una guía de talles estándar/);
    assert.match(r.errores[0], /Nico/);

    // jamás se escribe en /catalog/charts (crear, modificar o borrar guías)
    assert.ok(!llamadas.some(l => /^(POST|PUT|DELETE|PATCH) \/catalog\/charts(?!\/search)/.test(l)), llamadas.filter(l => l.includes('charts')).join(' | '));
    // una categoría sin guía (taladro) no busca nada
    const buscadas = llamadas.filter(l => l === 'POST /catalog/charts/search').length;
    assert.equal((await llamar('/api/guia-talles', { categoria: 'MLA5232' })).pide, false);
    assert.equal(llamadas.filter(l => l === 'POST /catalog/charts/search').length, buscadas);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

/* ---------- varios talles y editar lo publicado ---------- */

test('cambioPublicacion stock: entero de 1 a 999999; rechaza 0, negativos, decimales, vacío y texto', () => {
  assert.deepEqual(cambioPublicacion('stock', 5), { available_quantity: 5 });
  assert.deepEqual(cambioPublicacion('stock', '12'), { available_quantity: 12 });
  assert.deepEqual(cambioPublicacion('stock', 999999), { available_quantity: 999999 });
  for (const malo of [0, -3, 2.5, '', null, undefined, 'abc', 1000000, NaN]) {
    assert.throws(() => cambioPublicacion('stock', malo), /stock tiene que ser/, `debería rechazar ${String(malo)}`);
  }
  assert.deepEqual(cambioPublicacion('precio', '85000.4'), { price: 85000 }, 'el precio sigue igual');
});

test('validarDescripcion: la deja en texto plano y no acepta vacía', () => {
  assert.equal(validarDescripcion('  Hola <b>mundo</b> 😀\r\n\r\n\r\n\r\nChau  '), 'Hola mundo\n\nChau');
  assert.throws(() => validarDescripcion(''), /Escribí la descripción/);
  assert.throws(() => validarDescripcion('  <p> </p> 😀 '), /Escribí la descripción/);
  assert.throws(() => validarDescripcion(null), /Escribí la descripción/);
  assert.throws(() => validarDescripcion('a'.repeat(50001)), /demasiado larga/);
});

test('limpiarTalles: sin vacíos ni repetidos (sin importar mayúsculas), separa por coma, punto y coma o línea, y tope', () => {
  assert.deepEqual(limpiarTalles('40, 41;42\n43,, 41 ,  '), ['40', '41', '42', '43']);
  assert.deepEqual(limpiarTalles(['M', ' m ', 'L', '', null, 'XL']), ['M', 'L', 'XL']);
  assert.deepEqual(limpiarTalles('41  AR,41 ar'), ['41 AR']);
  assert.deepEqual(limpiarTalles(undefined), []);
  assert.deepEqual(limpiarTalles(''), []);
  assert.equal(limpiarTalles(Array.from({ length: MAX_TALLES }, (_, i) => `T${i}`)).length, MAX_TALLES);
  assert.throws(() => limpiarTalles(Array.from({ length: MAX_TALLES + 1 }, (_, i) => `T${i}`)), /máximo es 12/);
  // los repetidos no cuentan para el tope
  assert.equal(limpiarTalles([...Array.from({ length: MAX_TALLES }, (_, i) => `T${i}`), 'T0']).length, MAX_TALLES);
});

test('conTalle: pone SIZE (reemplaza o agrega), saca la lista de talles y no muta la original', () => {
  const base = { titulo: 'Zapas', talles: ['40', '41'], atributos: [{ id: 'SIZE', valor: 'x', opciones: [{ id: '1', nombre: '40' }] }, { id: 'BRAND', valor: 'Adidas' }] };
  const p = conTalle(base, '41');
  assert.equal(p.atributos.filter(a => a.id === 'SIZE').length, 1);
  assert.equal(p.atributos.find(a => a.id === 'SIZE').valor, '41');
  assert.equal(p.atributos.find(a => a.id === 'BRAND').valor, 'Adidas');
  assert.equal(p.talles, undefined);
  assert.equal(base.atributos[0].valor, 'x');
  assert.deepEqual(base.talles, ['40', '41']);
  const sin = conTalle({ titulo: 'Remera', atributos: [{ id: 'BRAND', valor: 'Nike' }] }, 'M');
  assert.deepEqual(sin.atributos.find(a => a.id === 'SIZE').valor, 'M');
  assert.equal(conTalle({ titulo: 'X' }, 'S').atributos[0].valor, 'S');
});

await testA('Worker: varios talles = un ítem por talle (revisar, publicar, un rechazo no frena a los demás, sin revisar no sale nada)', async () => {
  const { default: worker } = await import('./worker.js');
  const zap = contrato.casos.find(x => x.categoria.id === 'MLA109027');
  const llamadas = [];
  const validados = [];
  const creados = [];
  let malos = new Set();       // talles que el validador rechaza
  let rechazaAlCrear = null;   // talle que ML rechaza al POST /items
  let serie = 0;
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const ruta = String(url).replace('https://api.mercadolibre.com', '');
    llamadas.push(`${init.method || 'GET'} ${ruta}`);
    const r = (status, cuerpo) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
    const talleDe = it => it.attributes.find(a => a.id === 'SIZE')?.value_name;
    if (ruta === '/users/me') return r(200, { id: 77, nickname: 'prueba', tags: ['user_product_seller'] });
    if (ruta === '/categories/MLA109027/attributes') return r(200, zap.atributos);
    if (ruta === '/categories/MLA109027') return r(200, zap.categoria);
    if (ruta.startsWith('/sites/MLA/domain_discovery/search')) return r(200, zap.discovery);
    if (ruta === '/catalog/charts/search') return r(200, { charts: [{ id: '426238', type: 'STANDARD', names: { MLA: 'Standard' } }] });
    if (ruta === '/catalog/charts/426238') return r(200, guiaFalsa());
    if (ruta === '/items/validate') {
      const it = JSON.parse(init.body); validados.push(it);
      return malos.has(talleDe(it)) ? r(400, { cause: [{ type: 'error', code: 'item.attribute.invalid', message: `talle ${talleDe(it)} inválido` }] }) : r(200, {});
    }
    if (ruta === '/items') {
      const it = JSON.parse(init.body);
      if (talleDe(it) === rechazaAlCrear) return r(400, { message: 'ML dijo que no', cause: [] });
      creados.push(it); serie++;
      return r(201, { id: `MLA99900${serie}`, permalink: `https://articulo.mercadolibre.com.ar/MLA-99900${serie}`, status: 'active' });
    }
    if (ruta.endsWith('/description')) return r(201, {});
    return r(404, { message: `ruta no simulada: ${ruta}` });
  };
  try {
    const kv = fakeKV();
    await kv.put('ml:tokens', JSON.stringify({ access_token: 't', refresh_token: 'r', user_id: 77, vence: Date.now() + 3600e3 }));
    const env = { KV: kv, APP_SECRET: 'secreto' };
    const llamar = async (ruta, cuerpo) => {
      const res = await worker.fetch(new Request(`https://w.test${ruta}`, { method: 'POST', body: JSON.stringify(cuerpo),
        headers: { origin: 'http://localhost:5610', 'x-clave': 'secreto', 'content-type': 'application/json' } }), env);
      return { status: res.status, ...(await res.json()) };
    };
    const pub = (talles, extra = {}) => ({ titulo: 'Zapatillas running', categoria: 'MLA109027', precio: 30000, condicion: 'usado', cantidad: 2, tipoPublicacion: 'gold_special',
      envio: 'retiro', descripcion: 'Casi nuevas', talles,
      atributos: [{ id: 'SIZE', valor: '', opciones: [] }, { id: 'GENDER', valor: 'Hombre', opciones: [] }, { id: 'BRAND', valor: 'Adidas', opciones: [] }], ...extra });
    const cuerpo = (talles, extra) => ({ publicacion: pub(talles, extra), fotos: [{ id: 'p1' }] });
    const buscadas = () => llamadas.filter(l => l === 'POST /catalog/charts/search').length;
    const tallesDe = lista => lista.map(it => it.attributes.find(a => a.id === 'SIZE').value_name);

    // 1) revisar 3 talles: un validate por talle, cada uno con su fila, la guía se busca UNA vez
    let r = await llamar('/api/revisar', cuerpo(['40', '41 AR', ' 42 ', '40']));
    assert.equal(r.status, 200);
    assert.equal(r.ok, true);
    assert.equal(validados.length, 3, 'el 40 repetido no cuenta dos veces');
    assert.deepEqual(tallesDe(validados), ['40 AR', '41 AR', '42 AR']);
    assert.deepEqual(validados.map(it => it.attributes.find(a => a.id === 'SIZE_GRID_ROW_ID').value_name), ['426238:1', '426238:2', '426238:3']);
    assert.ok(validados.every(it => it.family_name === 'Zapatillas running' && it.available_quantity === 2));
    assert.equal(buscadas(), 1, 'la guía se busca una sola vez');
    assert.deepEqual(r.porTalle.map(t => [t.talle, t.ok]), [['40', true], ['41 AR', true], ['42', true]]);

    // 2) un talle que no está en la guía: ok false, error «Talle 99: …», y los demás se validan igual
    validados.length = 0;
    r = await llamar('/api/revisar', cuerpo(['41', '99', '42']));
    assert.equal(r.ok, false);
    assert.equal(validados.length, 2, 'el 99 no llega al validador');
    assert.match(r.errores[0], /^Talle 99: El talle «99» no está en la guía de talles/);
    assert.deepEqual(r.porTalle.map(t => t.ok), [true, false, true]);

    // 2b) un talle que el validador rechaza: su error lleva el talle; los demás pasan
    malos = new Set(['42 AR']);
    r = await llamar('/api/revisar', cuerpo(['41', '42']));
    assert.equal(r.ok, false);
    assert.ok(r.errores.some(e => /^Talle 42: .*inválido/.test(e)), r.errores.join(' | '));
    assert.deepEqual(r.porTalle.map(t => t.ok), [true, false]);
    malos = new Set();

    // 3) publicar SIN revisar un talle nuevo: 412 y no sale ninguno (aunque los otros sí estén revisados)
    r = await llamar('/api/revisar', cuerpo(['40', '41'], { precio: 31000 }));
    assert.equal(r.ok, true);
    r = await llamar('/api/publicar', cuerpo(['40', '41', '42'], { precio: 31000 }));   // el 42 a 31000 nunca se revisó
    assert.equal(r.status, 412);
    assert.equal(creados.length, 0, 'si falta revisar uno, no se publica ninguno');

    // 4) revisados todos: salen 3 ítems, uno por talle, con el mismo family_name; id del primero + items
    r = await llamar('/api/revisar', cuerpo(['40', '41', '42']));
    assert.equal(r.ok, true);
    r = await llamar('/api/publicar', cuerpo(['40', '41', '42']));
    assert.equal(r.status, 200);
    assert.equal(creados.length, 3);
    assert.deepEqual(tallesDe(creados), ['40 AR', '41 AR', '42 AR']);
    assert.ok(creados.every(it => it.family_name === 'Zapatillas running'));
    assert.deepEqual(r.items.map(i => [i.talle, i.id]), [['40', 'MLA999001'], ['41', 'MLA999002'], ['42', 'MLA999003']]);
    assert.equal(r.id, 'MLA999001');
    assert.equal(r.permalink, 'https://articulo.mercadolibre.com.ar/MLA-999001');
    assert.deepEqual(r.fallaron, []);
    assert.ok(['MLA999001', 'MLA999002', 'MLA999003'].every(id => llamadas.includes(`POST /items/${id}/description`)));

    // 4b) la revisión se gasta: repetir no crea de nuevo
    r = await llamar('/api/publicar', cuerpo(['40', '41', '42']));
    assert.equal(r.status, 412);
    assert.equal(creados.length, 3);

    // 5) ML rechaza uno al crear: los otros salen y `fallaron` dice cuál y por qué
    creados.length = 0;
    await llamar('/api/revisar', cuerpo(['41', '42']));
    rechazaAlCrear = '41 AR';
    r = await llamar('/api/publicar', cuerpo(['41', '42']));
    assert.equal(r.status, 200);
    assert.deepEqual(r.items.map(i => i.talle), ['42']);
    assert.equal(r.fallaron.length, 1);
    assert.equal(r.fallaron[0].talle, '41');
    assert.match(r.fallaron[0].error, /ML dijo que no/);
    assert.equal(creados.length, 1);

    // 6) si ML rechaza todos: error (no 200) y no queda nada creado
    creados.length = 0;
    await llamar('/api/revisar', cuerpo(['41']));
    r = await llamar('/api/publicar', cuerpo(['41']));
    assert.equal(r.status, 502);
    assert.match(r.error, /No salió ningún talle/);
    rechazaAlCrear = null;

    // 7) sin lista de talles, todo sigue como antes: un solo ítem con el SIZE del formulario
    validados.length = 0;
    r = await llamar('/api/revisar', cuerpo(undefined, { atributos: [{ id: 'SIZE', valor: '41', opciones: [] }, { id: 'GENDER', valor: 'Hombre', opciones: [] }, { id: 'BRAND', valor: 'Adidas', opciones: [] }] }));
    assert.equal(r.ok, true);
    assert.equal(r.porTalle, undefined);
    assert.equal(validados.length, 1);
    // y una lista con 13 talles se rechaza antes de llamar a nadie
    const antes = llamadas.length;
    r = await llamar('/api/revisar', cuerpo(Array.from({ length: 13 }, (_, i) => String(36 + i))));
    assert.equal(r.status, 400);
    assert.match(r.error, /máximo es 12/);
    assert.equal(llamadas.length, antes);

    // jamás se escribe en /catalog/charts
    assert.ok(!llamadas.some(l => /^(POST|PUT|DELETE|PATCH) \/catalog\/charts(?!\/search)/.test(l)));
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

await testA('Worker: editar lo publicado: descripción (PUT, con respaldo a POST) y stock (PUT), y nada más se escribe', async () => {
  const { default: worker } = await import('./worker.js');
  const llamadas = [];
  const cuerpos = [];
  let descripcionExiste = true;
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const ruta = String(url).replace('https://api.mercadolibre.com', '');
    llamadas.push(`${init.method || 'GET'} ${ruta}`);
    if (init.body) cuerpos.push(JSON.parse(init.body));
    const r = (status, cuerpo) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
    if (init.method === 'PUT' && ruta.startsWith('/items/MLA123456/description')) return descripcionExiste ? r(200, {}) : r(404, { message: 'no tiene' });
    if (init.method === 'POST' && ruta === '/items/MLA123456/description') return r(201, {});
    if (init.method === 'PUT' && ruta === '/items/MLA123456') return r(200, { id: 'MLA123456', status: 'active', price: 1000, available_quantity: cuerpos.at(-1).available_quantity });
    return r(404, { message: `ruta no simulada: ${init.method || 'GET'} ${ruta}` });
  };
  try {
    const kv = fakeKV();
    await kv.put('ml:tokens', JSON.stringify({ access_token: 't', refresh_token: 'r', user_id: 1, vence: Date.now() + 3600e3 }));
    const env = { KV: kv, APP_SECRET: 'secreto' };
    const llamar = async (cuerpo, id = 'MLA123456') => {
      const res = await worker.fetch(new Request(`https://w.test/api/publicaciones/${id}`, { method: 'POST', body: JSON.stringify(cuerpo),
        headers: { origin: 'http://localhost:5610', 'x-clave': 'secreto', 'content-type': 'application/json' } }), env);
      return { status: res.status, ...(await res.json()) };
    };

    // stock
    let r = await llamar({ accion: 'stock', stock: 7 });
    assert.equal(r.status, 200);
    assert.equal(r.cantidad, 7);
    assert.deepEqual(cuerpos.at(-1), { available_quantity: 7 });
    assert.ok(llamadas.includes('PUT /items/MLA123456'));
    for (const malo of [0, -1, 1.5, 'x', undefined]) {
      const antes = llamadas.length;
      r = await llamar({ accion: 'stock', stock: malo });
      assert.equal(r.status, 400, `stock ${String(malo)}`);
      assert.equal(llamadas.length, antes, 'un stock inválido no llama a MercadoLibre');
    }

    // descripción: existente → PUT; sin descripción previa (404) → POST; vacía → 400 sin llamar
    r = await llamar({ accion: 'descripcion', descripcion: 'Nueva <b>descripción</b> 😀' });
    assert.equal(r.status, 200);
    assert.equal(r.descripcion, 'Nueva descripción');
    assert.deepEqual(cuerpos.at(-1), { plain_text: 'Nueva descripción' });
    assert.ok(llamadas.includes('PUT /items/MLA123456/description?api_version=2'));
    assert.ok(!llamadas.includes('POST /items/MLA123456/description'));
    descripcionExiste = false;
    r = await llamar({ accion: 'descripcion', descripcion: 'Primera descripción' });
    assert.equal(r.status, 200);
    assert.ok(llamadas.includes('POST /items/MLA123456/description'));
    const antes = llamadas.length;
    r = await llamar({ accion: 'descripcion', descripcion: '   ' });
    assert.equal(r.status, 400);
    assert.match(r.error, /Escribí la descripción/);
    assert.equal(llamadas.length, antes);

    // lo que ya existía sigue igual (precio) y no hay otras escrituras
    r = await llamar({ accion: 'precio', precio: 1000 });
    assert.equal(r.status, 200);
    assert.equal(r.precio, 1000);
    assert.ok(llamadas.filter(l => !l.startsWith('GET')).every(l => /^(PUT|POST) \/items\/MLA123456(\/description.*)?$/.test(l)), llamadas.join(' | '));
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

/* ---------- seguimiento de todos los talles ---------- */

test('resumenRegistro / itemsDeRegistro: con varios talles guarda un ítem por talle; con uno solo queda como siempre', () => {
  const uno = resumenRegistro({ id: 'a', estado: 'publicada', ml: { id: 'MLA1', permalink: 'p', items: [{ talle: '40', id: 'MLA1' }] } });
  assert.equal('mlItems' in uno, false, 'un solo ítem no agrega mlItems');
  assert.deepEqual(itemsDeRegistro(uno), [{ talle: null, id: 'MLA1' }]);
  const varios = resumenRegistro({ id: 'b', estado: 'publicada', ml: { id: 'MLA2', items: [{ talle: '40', id: 'MLA2', permalink: 'x' }, { talle: '41', id: 'MLA3' }, { talle: '42' }] } });
  assert.deepEqual(varios.mlItems, [{ talle: '40', id: 'MLA2' }, { talle: '41', id: 'MLA3' }], 'sin id no cuenta');
  assert.deepEqual(itemsDeRegistro(varios), varios.mlItems);
  assert.deepEqual(itemsDeRegistro({ id: 'c', mlId: null }), []);
  assert.deepEqual(itemsDeRegistro(undefined), []);
});

test('juntarSeguimiento: un ítem queda igual; varios suman, toman el estado más vivo, el precio del primero y traen cada talle', () => {
  const porItem = {
    MLA1: { estado: 'activa', vendidas: 1, disponibles: 2, precio: 100, visitas: 5, preguntas: 0 },
    MLA2: { estado: 'vendida', vendidas: 3, disponibles: 0, precio: 900, visitas: 10, preguntas: 1 },
    MLA3: { estado: 'pausada', vendidas: 0, disponibles: 4, precio: 950, visitas: null, preguntas: 2 },
    MLA4: { estado: 'finalizada', vendidas: 0, disponibles: 0, precio: 50, visitas: 1, preguntas: 0 }
  };
  const r = juntarSeguimiento([
    { id: 'a', mlId: 'MLA1', mlItems: null },
    { id: 'b', mlId: 'MLA2', mlItems: [{ talle: '40', id: 'MLA2' }, { talle: '41', id: 'MLA3' }] },
    { id: 'c', mlId: 'MLA9', mlItems: null },                                    // sin datos de ML: sin fila, como antes
    { id: 'd', mlId: 'MLA4', mlItems: [{ talle: 'S', id: 'MLA4' }, { talle: 'M', id: 'MLA8' }] }   // un talle sin datos
  ], porItem);
  assert.deepEqual(r.a, { ...porItem.MLA1, mlId: 'MLA1' }, 'un ítem: exactamente como siempre, sin talles');
  assert.equal(r.c, undefined);
  assert.equal(r.b.estado, 'pausada', 'pausada gana a vendida: todavía hay un talle a la venta');
  assert.equal(r.b.vendidas, 3);
  assert.equal(r.b.disponibles, 4);
  assert.equal(r.b.visitas, 10, 'null cuenta como 0 si hay otro número');
  assert.equal(r.b.preguntas, 3);
  assert.equal(r.b.precio, 900);
  assert.equal(r.b.mlId, 'MLA2');
  assert.deepEqual(r.b.talles.map(t => [t.talle, t.id, t.estado, t.disponibles]), [['40', 'MLA2', 'vendida', 0], ['41', 'MLA3', 'pausada', 4]]);
  assert.deepEqual(r.d.talles.map(t => t.talle), ['S'], 'el talle sin datos no aparece');
  // todos cerrados: vendida antes que finalizada; todo en null queda en null
  const cerr = juntarSeguimiento([{ id: 'x', mlId: 'A1', mlItems: [{ talle: '1', id: 'A1' }, { talle: '2', id: 'A2' }] }],
    { A1: { estado: 'finalizada', vendidas: 0, disponibles: null, precio: 1, visitas: null, preguntas: null }, A2: { estado: 'vendida', vendidas: 1, disponibles: null, precio: 1, visitas: null, preguntas: null } });
  assert.equal(cerr.x.estado, 'vendida');
  assert.equal(cerr.x.disponibles, null);
  assert.equal(cerr.x.visitas, null);
  assert.equal(cerr.x.preguntas, null);
});

await testA('Worker: el seguimiento y las preguntas cubren cada talle y no pasan de 30 ítems con visitas', async () => {
  const { default: worker } = await import('./worker.js');
  const llamadas = [];
  const fetchOriginal = globalThis.fetch;
  const muchos = Array.from({ length: 12 }, (_, i) => ({ talle: String(36 + i), id: `MLA5${String(i).padStart(2, '0')}` }));
  const todos = ['MLA1', 'MLA2', 'MLA3', ...muchos.map(m => m.id)];
  globalThis.fetch = async (url, init = {}) => {
    const ruta = String(url).replace('https://api.mercadolibre.com', '');
    llamadas.push(`${init.method || 'GET'} ${ruta}`);
    const r = (status, cuerpo) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
    if (ruta === '/users/me') return r(200, { id: 77, nickname: 'prueba' });
    if (ruta.startsWith('/items?ids=')) return r(200, ruta.split('ids=')[1].split('&')[0].split(',').map(id => ({ code: 200, body:
      { id, status: id === 'MLA3' ? 'paused' : 'active', sold_quantity: id === 'MLA2' ? 2 : 0, available_quantity: 3, price: 1000 } })));
    if (ruta.startsWith('/visits/items')) { const id = ruta.split('ids=')[1]; return r(200, { [id]: 4 }); }
    if (ruta.startsWith('/my/received_questions/search')) return r(200, { questions: [{ id: 10, item_id: 'MLA3', text: '¿Tenés el 41?', date_created: 'x' }, { id: 11, item_id: 'MLA1', text: 'Hola', date_created: 'y' }] });
    return r(404, { message: `ruta no simulada: ${ruta}` });
  };
  try {
    const kv = fakeKV();
    await kv.put('ml:tokens', JSON.stringify({ access_token: 't', refresh_token: 'r', user_id: 77, vence: Date.now() + 3600e3 }));
    const indice = [
      { id: 'a', estado: 'publicada', mlId: 'MLA1', titulo: 'Uno', actualizado: '2026-11-14T10:00:00Z' },
      { id: 'b', estado: 'publicada', mlId: 'MLA2', titulo: 'Zapas', actualizado: '2026-11-14T11:00:00Z', mlItems: [{ talle: '40', id: 'MLA2' }, { talle: '41', id: 'MLA3' }] },
      { id: 'c', estado: 'publicada', mlId: muchos[0].id, titulo: 'Doce talles', actualizado: '2026-11-14T12:00:00Z', mlItems: muchos }
    ];
    await kv.put('regs', JSON.stringify(indice));
    const env = { KV: kv, APP_SECRET: 'secreto' };
    const pedir = async ruta => {
      const res = await worker.fetch(new Request(`https://w.test${ruta}`, { method: 'GET', headers: { origin: 'http://localhost:5610', 'x-clave': 'secreto' } }), env);
      return { status: res.status, ...(await res.json()) };
    };

    const s = await pedir('/api/seguimiento?forzar=1');
    assert.equal(s.status, 200);
    assert.equal(s.registros.a.mlId, 'MLA1');
    assert.equal(s.registros.a.talles, undefined, 'el de un ítem no cambia');
    assert.equal(s.registros.b.estado, 'activa');
    assert.equal(s.registros.b.vendidas, 2);
    assert.equal(s.registros.b.disponibles, 6);
    assert.equal(s.registros.b.visitas, 8);
    assert.equal(s.registros.b.preguntas, 1, 'la pregunta del talle 41 cuenta en su registro');
    assert.deepEqual(s.registros.b.talles.map(t => [t.talle, t.estado]), [['40', 'activa'], ['41', 'pausada']]);
    assert.equal(s.registros.c.talles.length, 12);
    // se consultaron los ítems de todos los talles (una sola vez cada uno) y las visitas no pasan de 30
    const idsPedidos = llamadas.filter(l => l.startsWith('GET /items?ids=')).flatMap(l => l.split('ids=')[1].split('&')[0].split(','));
    assert.deepEqual([...new Set(idsPedidos)].sort(), [...todos].sort());
    assert.equal(idsPedidos.length, todos.length);
    const visitasPedidas = llamadas.filter(l => l.startsWith('GET /visits/items'));
    assert.equal(visitasPedidas.length, todos.length, `${todos.length} ítems < 30: todos tienen visitas`);

    // las preguntas llevan al registro del talle, sea cual sea
    const p = await pedir('/api/preguntas');
    assert.equal(p.status, 200);
    assert.equal(p.preguntas.find(q => q.mlId === 'MLA3').registroId, 'b');
    assert.equal(p.preguntas.find(q => q.mlId === 'MLA1').registroId, 'a');
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

await testA('Worker: con más de 30 ítems publicados, las visitas se piden solo para los primeros 30 (límite de pedidos)', async () => {
  const { default: worker } = await import('./worker.js');
  const visitas = [];
  const fetchOriginal = globalThis.fetch;
  const ids = Array.from({ length: 40 }, (_, i) => `MLA7${String(i).padStart(2, '0')}`);
  globalThis.fetch = async (url) => {
    const ruta = String(url).replace('https://api.mercadolibre.com', '');
    const r = (status, cuerpo) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
    if (ruta === '/users/me') return r(200, { id: 77, nickname: 'prueba' });
    if (ruta.startsWith('/items?ids=')) return r(200, ruta.split('ids=')[1].split('&')[0].split(',').map(id => ({ code: 200, body: { id, status: 'active', sold_quantity: 0, available_quantity: 1, price: 1 } })));
    if (ruta.startsWith('/visits/items')) { visitas.push(ruta); return r(200, { [ruta.split('ids=')[1]]: 1 }); }
    if (ruta.startsWith('/my/received_questions/search')) return r(200, { questions: [] });
    return r(404, { message: `ruta no simulada: ${ruta}` });
  };
  try {
    const kv = fakeKV();
    await kv.put('ml:tokens', JSON.stringify({ access_token: 't', refresh_token: 'r', user_id: 77, vence: Date.now() + 3600e3 }));
    await kv.put('regs', JSON.stringify([{ id: 'z', estado: 'publicada', mlId: ids[0], titulo: 'Muchos', actualizado: '2026-11-14T12:00:00Z', mlItems: ids.slice(0, 12).map((id, i) => ({ talle: String(i), id })) },
      ...ids.slice(12).map((id, i) => ({ id: `r${i}`, estado: 'publicada', mlId: id, titulo: `P${i}`, actualizado: '2026-11-14T10:00:00Z' }))]));
    const res = await worker.fetch(new Request('https://w.test/api/seguimiento?forzar=1', { headers: { origin: 'http://localhost:5610', 'x-clave': 'secreto' } }), { KV: kv, APP_SECRET: 'secreto' });
    assert.equal(res.status, 200);
    assert.equal(visitas.length, 30);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

console.log(`\n${n} tests en verde`);
