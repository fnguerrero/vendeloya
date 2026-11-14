# SPEC — ronda 6 (14/11/2026): varios talles + editar lo publicado

## Objetivo
1. **Varios talles en una publicación de ropa/calzado.** Con User Products (la cuenta de Nico es `user_product_seller`) MercadoLibre NO acepta el arreglo `variations` (error); cada talle es un ítem propio con el mismo `family_name`. Entonces "varios talles" = un campo "Talles a publicar" y la app/Worker revisan y publican un ítem por talle (cada uno con su fila de la guía), con un solo botón.
2. **Editar lo ya publicado, más allá de precio/pausar/cerrar**: cambiar la descripción y el stock (cantidad disponible) desde el panel de la publicada.

## Alcance
Entra: Worker (`logica.js`, `worker.js`, tests), app (campo de talles, resultado por talle, panel con otros talles, editar descripción y stock, demo), README/NOTAS.
NO entra: variaciones reales (`variations`, no existen en UP), editar el título (en UP el nombre es `family_name` y no se edita), editar fotos/atributos, seguimiento (visitas/estado) de los talles extra (solo se listan con link), cola persistente, Gemini.

## Reglas duras (de Nico y de ★ Emprendimientos)
- Nada contra publicaciones reales de ML: sin POST real a `/api/publicar`, sin PUT real a publicaciones, sin responder preguntas ni cambiar precios reales. Todo se prueba con ML simulado en `test.mjs` y con `?demo`. La única llamada real permitida es `/api/revisar` (validate) de `tools/validar-lote.mjs`, que no publica.
- Nunca se crea una guía de talles en la cuenta.
- Sin secretos en pantalla ni en archivos. No tocar % ni ClickUp.
- Commits sin atribución de IA. Push solo a `fnguerrero/vendeloya` (permitido). **Deploy con wrangler: pide OK de Nico** (settings del proyecto); no se despliega solo.

## Supuestos (decididos sin preguntar)
- Un talle = un ítem con el mismo título, precio, fotos y descripción; `cantidad` es por talle. Máximo 12 talles por publicación.
- Si hay lista de talles, el atributo SIZE del formulario se ignora (el Worker lo pisa por talle); 1 talle en la lista = publicación normal de ese talle.
- Revisión por talle: cada uno pasa por `/items/validate` con su fila de guía; `ok` global solo si todos pasan. Los errores se prefijan «Talle X: …». La guía se busca una sola vez por revisión (misma guía para todos los talles).
- Publicación por talle: si uno falla se sigue con los demás y se informa; no hay rollback (lo ya publicado queda). La app deja en el campo solo los talles que fallaron.
- El Worker devuelve `id`/`permalink` del primer talle publicado (compatibilidad) y `items:[{talle,id,permalink,estado}]`; el registro guarda `ml:{id, permalink, items}`.
- Editar descripción: `PUT /items/{id}/description {plain_text}`, con respaldo a `POST` si la publicación no tenía descripción (404). Se limpia con `limpiarDescripcion`. Editar stock: `PUT /items/{id} {available_quantity}` entero 1–999999 (para 0 está "Marcar vendida"/pausar).
- El panel de editar usa `POST /api/publicaciones/<mlId>` con `accion: 'descripcion' | 'stock'` (misma ruta que precio/pausar).

## Criterios de aceptación
1. `cambioPublicacion('stock', 5)` → `{available_quantity:5}`; rechaza 0, negativos, decimales y no numéricos. `descripcion` se valida y limpia (vacía = error).
2. `limpiarTalles` deduplica, recorta, descarta vacíos, máx 12; acepta coma, punto y coma, salto de línea.
3. Worker `/api/revisar` con 3 talles: 3 llamadas a validate, cada ítem con su `SIZE_GRID_ROW_ID` y `SIZE`; `ok` true; `porTalle` con 3 resultados; la guía se busca una vez.
4. Un talle que no está en la guía → `ok:false`, error «Talle X: …», y los demás se validan igual.
5. `/api/publicar` con 3 talles: 3 POST a `/items` con SIZE distinto y el mismo `family_name`; devuelve `items` con 3 ids; con talles no revisados → 412 sin publicar nada.
6. Publicar con un talle que falla en ML: los otros salen, `fallaron` lista el que falló y el motivo.
7. Worker: `descripcion` hace PUT y cae a POST si da 404; `stock` hace PUT; ninguna otra llamada de escritura.
8. Mutantes: cada pieza nueva tiene un mutante que rompe algún test.
9. App en `?demo`: categoría con SIZE muestra "Talles a publicar"; con `40, 41, 42` Publicar revisa y confirma "3 publicaciones"; publicar deja el listo con los 3 links; el panel de la publicada muestra los otros talles.
10. App en `?demo`: el panel permite cambiar descripción y stock y se ve el cambio.
11. 0 errores de consola; celu 375 sin scroll horizontal; `node test.mjs` en verde; `node --check` limpio en los JS tocados; `sw.js` VERSION y `?v=` subidos.
12. `tools/validar-lote.mjs` sigue dando 8 de 8 (no se reejecuta: lo corre Nico) — el cambio no toca el camino de un solo talle sin lista.

## Presupuesto
30 iteraciones.
