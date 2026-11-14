# SPEC — ronda 7 (14/11/2026): cola persistente, colores con fotos, atributos condicionales, escáner

## Objetivo
Cerrar los cuatro pendientes que Nico marcó en la ventana de preguntas ("todo"):
1. **Cola persistente**: "Varios productos a la vez" vive hoy en memoria; que sobreviva a cerrar/recargar la pestaña y a perder señal.
2. **Colores con fotos por color**: la tabla de variantes suma color y qué fotos usa cada fila; sale una publicación por color (y talle).
3. **Atributos condicionales**: consultar a ML qué datos pasan a ser obligatorios según lo ya cargado y avisarlo antes de revisar.
4. **Escáner de código de barras con la cámara** para el GTIN.

## Alcance
Entra: `worker/logica.js`, `worker/worker.js`, `worker/test.mjs`, `app.js`, `index.html`, `styles.css`, demo (`?demo`), `tools/` (sonda de solo lectura), README/NOTAS-API, versiones de `sw.js`/`?v=`.
NO entra: catálogo (`catalog_product_id`), clave de Gemini, precios por búsqueda con token, variaciones reales (`variations`: UP no las admite), editar título, seguimiento de más de 30 ítems, cualquier prueba contra la cuenta real.

## Reglas duras (de Nico y de ★ Emprendimientos)
- Nada contra publicaciones reales de ML: sin POST real a `/api/publicar`, sin editar lo publicado, sin responder preguntas, sin cambiar precios. Todo con ML simulado (`test.mjs`) y `?demo`.
- Nunca se crea una guía de talles en la cuenta. Sin secretos en pantalla ni en archivos. No tocar % ni título de ClickUp.
- Commits sin atribución de IA. Push solo a `fnguerrero/vendeloya`. Deploy con wrangler: Nico dio OK para esta línea de trabajo, pero hoy wrangler está logueado en otra cuenta de Cloudflare (error 10000): si sigue así, se deja constancia y no se toca el login (credenciales de Nico).

## Stack y decisiones
- Cola persistente: **IndexedDB** del navegador (las fotos son dataURL grandes; localStorage no alcanza). Una base por modo (`vendeloya-cola` y `vendeloya-cola-demo`). Lo que está `armando` vuelve a `pendiente`; lo `lista` pierde las fotos (ya están guardadas en su borrador del historial) y conserva `id`/`titulo`.
- Colores: cada variante = `{ talle?, color?, cantidad?, precio?, fotos? }`. `fotos` son **índices** de la tira de fotos de la publicación (vacío = todas). Clave de repetido = talle + color. Se pone el atributo `COLOR` (y `SIZE` con su fila de guía si hay talle) en cada ítem. En categorías sin `SIZE` pero con `COLOR` la tabla se usa solo con colores.
- Condicionales: `POST /categories/{id}/attributes/conditional` con los atributos cargados (solo lectura). El contrato real no está validado: el parser es tolerante (ids de cualquier lista de objetos con `id`) y se deja `tools/probar-condicionales.mjs` para que Nico lo corra una vez.
- Escáner: `BarcodeDetector` + `getUserMedia` (cámara trasera). Sin soporte → mensaje claro y el campo sigue escribible. Una lectura vale solo si pasa el dígito verificador y se repite en 2 cuadros seguidos.

## Supuestos (decididos sin preguntar)
- Tope de la cola: el actual (10). Se guardan solo los estados `pendiente`, `error` y `lista`.
- Los colores salen de las opciones del atributo `COLOR` de la categoría (lista sugerida), pero se acepta texto libre; ML valida al revisar.
- Máximo 12 variantes por publicación (el actual), contando talle×color.
- El panel de la publicada lista cada variante como "Talle 40 · Rojo".
- Los atributos condicionales nuevos se marcan como obligatorios en la pantalla y se suman al "Falta completar"; no frenan el Publicar por sí solos (ML sigue siendo el que valida).

## Criterios de aceptación
1. `colaParaGuardar`/`colaRestaurada`: `armando` → `pendiente`; `lista` sin fotos; forma inválida o más de 10 se descarta sin romper; ida y vuelta conserva `pendiente` con fotos.
2. En `?demo`: sumar 2 productos a la cola, recargar → vuelven los 2 con sus fotos; vaciar la cola la borra del dispositivo; sin IndexedDB la app anda y avisa.
3. `limpiarVariantes` acepta color y fotos; repetido por talle+color; valida índices de fotos; `conVariante` pone `COLOR` y `SIZE`; test con ML simulado: revisar y publicar mandan a cada ítem su color, su talle con fila de guía y solo sus fotos.
4. Categoría con `COLOR` y sin `SIZE`: variantes de solo color funcionan (sin guía de talles).
5. Tabla de la app en `?demo&moda`: columna de color, selector de fotos por fila, confirmación con el detalle; la pantalla final y el panel listan "Talle 40 · Rojo".
6. `leerCondicionales` entiende las formas conocidas y descarta lo raro; `/api/condicionales` con ML simulado devuelve ids requeridos nuevos (los que no estaban ya requeridos); nunca escribe en ML.
7. En `?demo`: al cargar un dato que dispara una condición aparece el aviso y el campo pasa a obligatorio; sin conexión o con error de ML no molesta.
8. `gtinFront` valida igual que `gtinValido` del Worker (mismos casos); el escáner con `BarcodeDetector` simulado completa el campo con un GTIN válido, ignora uno inválido y una lectura suelta, y apaga la cámara al cerrar; sin `BarcodeDetector` muestra el mensaje.
9. Mutantes: cada pieza nueva tiene un mutante que rompe algún test.
10. 0 errores propios en consola; 375 px sin scroll horizontal; `node test.mjs` en verde; `node --check` limpio; `sw.js` VERSION y `?v=` subidos; el camino de un solo talle sin lista no cambia (`validar-lote --seco` igual).

## Presupuesto
40 iteraciones.
