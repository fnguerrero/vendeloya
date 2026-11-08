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
  leerPaquete, paqueteParaML, aCentimetros, aGramos, parsearNumero, parsearMonto, validarPaquete,
  huellaItem, paraHuella, marcarValidado, estaValidado, gastarValidacion
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
      const obligatorios = c.atributos.filter(a => { const t = a.tags || {}; return (t.required || t.catalog_required || t.conditional_required || (condicion === 'nuevo' && t.new_required)) && !t.read_only && !t.fixed && !t.inferred && !['ITEM_CONDITION', 'EMPTY_GTIN_REASON', 'SELLER_SKU'].includes(a.id); });
      const ids = new Set(el.map(a => a.id));
      assert.ok(obligatorios.every(a => ids.has(a.id)), `${c.busqueda}/${condicion}: falta un obligatorio`);
    }
  }
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

console.log(`\n${n} tests en verde`);
