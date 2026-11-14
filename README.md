# VendeloYa

Publicador personal de MercadoLibre. Sacás 1 a 6 fotos, la IA identifica el producto y arma la publicación (título, condición, categoría, ficha técnica, descripción y precio sugerido). La revisás, MercadoLibre la valida sin publicar, y recién ahí aparece el botón Publicar, con una confirmación más.

Es de uso personal: una sola cuenta de MercadoLibre, sin multiusuario.

## Cómo está armado

```
index.html, app.js, styles.css   PWA en vanilla JS, sin build (Worker de estáticos vendeloya-app)
config.js                        URL del Worker (no es secreta)
wrangler-app.toml, .assetsignore deploy de la app y lo que NO se publica
sw.js, manifest.webmanifest      instalable desde Chrome Android
worker/worker.js                 backend en Cloudflare Workers: OAuth, MercadoLibre y rutas
worker/registros.js              historial y borradores en el KV (reg:<id> + índice regs)
worker/ia.js                     las dos llamadas a Claude (claude-opus-5-5)
worker/logica.js                 lógica pura: atributos, armado del ítem, precio, errores
worker/test.mjs                  tests de logica.js sin red:  node worker/test.mjs
NOTAS-API.md                     lo verificado de la API de MercadoLibre (17/10/2026)
```

El flujo de punta a punta:

1. **Fotos.** Se redimensionan en el celu a 1200 px, lo que recomienda MercadoLibre.
2. **`/api/analizar`.** Una llamada a Claude con las fotos devuelve qué es, el título, la condición, la descripción y un precio estimado. Después, el predictor de MercadoLibre (`domain_discovery`) da 3 categorías posibles. Se traen los atributos de la primera y una segunda llamada a Claude, sin fotos y con poco esfuerzo, completa la ficha técnica. El precio se intenta sacar de la búsqueda de MercadoLibre; si está cerrada, queda el de la IA marcado como estimado.
3. **Revisión.** Todo es editable. Al cambiar de categoría se trae la ficha nueva.
4. **`/api/revisar`.** Sube las fotos (y no las vuelve a subir después) y llama a `POST /items/validate`. **No publica nada.**
5. **`/api/publicar`.** Solo se habilita si la última revisión dio OK y no se tocó nada después, y pide confirmación. Hace `POST /items` y después la descripción.

### Historial y borradores

Cada análisis es un registro guardado en el KV del Worker (`reg:<id>`, con fotos, análisis, lo editado y el estado), más un índice `regs` para la lista. Lo que se edita en la revisión se autoguarda a los 1,2 segundos. El registro abierto se recuerda en el navegador, así que al recargar se retoma. Estados: borrador, revisada (pasó el validador) y publicada (con el link). Como está en la nube, se ve igual desde el celu y la PC. Borrar del historial usa Deshacer y no despublica nada en MercadoLibre.

### Seguridad

- El token de MercadoLibre vive en KV, porque el refresh token es de un solo uso y rota en cada renovación.
- Las claves (MercadoLibre y Claude) son secretos del Worker: nunca bajan al navegador.
- Todo `/api/*` pide el header `x-clave` igual a `APP_SECRET`. El Origin solo no alcanza, porque se falsifica con curl, y esta app publica en una cuenta real. La clave se carga una vez en **Ajustes** de la app y queda solo en ese dispositivo.
- El OAuth usa PKCE y `state` de un solo uso que vence a los 10 minutos.

## Puesta en marcha (una sola vez)

1. **App de MercadoLibre** en https://developers.mercadolibre.com.ar/devcenter, con la cuenta principal:
   - Redirect URI: `https://vendeloya.fnguerrero.workers.dev/oauth/callback`
   - PKCE activado.
   - Permisos: Usuarios y Publicación y sincronización, con lectura y escritura.
2. **KV**: `npx wrangler kv namespace create KV` dentro de `worker/`, y pegar el `id` en `wrangler.toml`.
3. **Secretos**: `powershell -ExecutionPolicy Bypass -File "W:\Working Folder Personal\Apps\VendeloYa\tools\cargar-secretos.ps1"` pide uno por uno `ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ANTHROPIC_API_KEY` y `APP_SECRET` (una clave inventada por vos), muestra cuáles quedaron cargados y abre la app. Mientras falte alguno, la app muestra **Falta configurar** arriba y dice cuáles.
4. **Deploy del Worker**: `npx wrangler deploy` dentro de `worker/`.
5. **La app**: `npx wrangler deploy --config wrangler-app.toml` desde esta carpeta. Queda en https://vendeloya-app.fnguerrero.workers.dev. Es un Worker de solo estáticos, separado de la API: **no usar el nombre `vendeloya`, que es la API**. Ojo: `wrangler pages ...` en wrangler 4.151+ ya no crea un Pages clásico, despliega un Worker con la config de la carpeta. GitHub Pages no se llegó a activar. Si la app se publica en otro lado, sumar el origen a `ORIGENES` en `worker/worker.js`.
6. En la app: **Ajustes** → cargar la misma `APP_SECRET`. Después **Conectar MercadoLibre** (el botón de arriba) y autorizar.

## Correrlo local

- App: `py -3 -m http.server 5610` en esta carpeta, y abrir http://localhost:5610 (pega contra el Worker real).
- **Modo demo**: http://localhost:5610/?demo=1 recorre toda la pantalla con respuestas de mentira, sin Worker, sin gastar en la API y sin publicar.
- Tests: `node worker/test.mjs`.

## Pendientes

- **Catálogo**: las categorías con catálogo obligatorio (celulares, electrónica de marca) quedan fuera del MVP. Ahí hay que buscar el producto en `/products/search` y publicar con `catalog_product_id`, y ese endpoint da 403 sin permisos especiales.
- **Código de barras (GTIN)**: la IA lee los números de abajo del código si se ven en una foto, y solo se usan si pasan el dígito verificador (`gtinValido` en `logica.js`). Un GTIN que la IA complete sin haberlo leído se borra. Si la categoría lo pide y no hay, se manda `EMPTY_GTIN_REASON = "El producto no tiene código registrado"`. Falta probar la lectura con fotos reales. Además, en el campo hay un botón **Escanear con la cámara** (`BarcodeDetector`, hoy solo Chrome en el celular y algunos navegadores de escritorio): un código vale cuando es un GTIN válido y sale en dos lecturas seguidas; sin soporte, se avisa y se escribe a mano.
- **Precio**: la búsqueda pública de MercadoLibre da 403 sin token. Falta probar si con token anda. Si no, el precio es la estimación de la IA, que es lo más flojo de la app. Otra opción es `/suggestions/items/{id}/details` después de publicar, que solo anda sobre ítems existentes.
- **Atributos condicionales**: mientras se completa la ficha, la app le pregunta a ML (solo lectura, `POST /categories/{id}/attributes/conditional`, con una pausa de 0,9 s) qué datos pasan a ser obligatorios con lo ya cargado y los avisa antes de revisar (no frena el Publicar). **Ojo: la documentación de ML no confirma ese endpoint** (solo la etiqueta `conditional_required` de `/categories/{id}/attributes`, que ya se trata como obligatoria). Si ML contesta 404/405 se apaga solo para esa categoría y cualquier otro fallo se ignora; para saber si existe de verdad, correr una vez `tools/probar-condicionales.mjs`.
- **Envío**: no se manda `shipping`, así que queda lo configurado en la cuenta.
- **Variantes** (talles y colores): con la cuenta de User Products MercadoLibre no admite el arreglo `variations`. Los **talles** se resuelven como un ítem por talle con el mismo `family_name`: en la revisión, la tabla "Talles a publicar" (ropa y calzado) arma una publicación por talle, cada una con su fila de la guía de talles y, si querés, su propia cantidad y su propio precio (vacío = los comunes), y un solo botón las revisa y las publica. Si ML rechaza uno, los demás salen y la pantalla dice cuál no. Los **colores** funcionan igual: cada fila de la tabla puede traer talle y/o color (la lista sugerida sale del atributo `COLOR` de la categoría), su cantidad, su precio y **sus propias fotos** (por índice de la tira); sale un ítem por talle y color, con `COLOR` y `SIZE` (con su fila de guía) puestos, y en categorías sin talle alcanza con los colores. Máximo 12 variantes por publicación; si reordenás o sacás fotos después de elegir las de una fila, revisá la selección. El seguimiento cubre todos los talles: el historial suma visitas, ventas, stock y preguntas de cada ítem (estado = el más vivo) y el panel muestra cómo va cada talle; las visitas se piden para los primeros 30 ítems por el límite de pedidos de un Worker. Precio, stock y estado que se cambian desde el panel valen para el primer talle.
- **Editar lo publicado**: desde el panel de cada publicada se cambian precio, stock (`available_quantity`), descripción (`PUT /items/{id}/description`), pausar/reactivar y cerrar. El título no se edita (con User Products es el `family_name`).
- **Usuario de test**: MercadoLibre pide probar con usuarios de test, no con la cuenta personal. La prueba del MVP llega hasta el validador. Si hace falta probar la publicación real sin riesgo, se crea uno con `POST /users/test_user`.
- **Cola de varios productos**: se guarda en el dispositivo (IndexedDB, `vendeloya-cola`): al cerrar o recargar la pestaña vuelve con sus fotos, lo que estaba armándose pasa a pendiente y lo ya armado queda como borrador del historial. Si el navegador no deja guardar, la app avisa que se pierde al cerrar.
