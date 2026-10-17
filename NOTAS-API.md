# API de MercadoLibre: lo verificado (17/10/2026)

Leído de developers.mercadolibre.com.ar y probado contra api.mercadolibre.com.
La doc bloquea fetchers con 403; se baja con `curl -A "Mozilla/5.0 ..."`.

## OAuth
- Autorizar: `https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=..&redirect_uri=..&state=..&code_challenge=..&code_challenge_method=S256`
- Token: `POST https://api.mercadolibre.com/oauth/token` (form-urlencoded) con `grant_type=authorization_code`, `client_id`, `client_secret`, `code`, `redirect_uri`, `code_verifier`.
- El access token dura 6 h. El refresh token es de **un solo uso**: cada renovación trae uno nuevo y solo vale el último. Vence a los 6 meses, o a los 4 meses sin usar la app.
- El redirect_uri tiene que ser HTTPS y coincidir exacto, sin partes variables: lo que haga falta va en `state`.
- Tiene que autorizar la cuenta principal. Un colaborador da `invalid_operator_user_id`.

## Categoría y atributos
- Predictor: `GET /sites/MLA/domain_discovery/search?q=TITULO&limit=3`. **Anda sin token.**
- Atributos: `GET /categories/{id}/attributes`, también **sin token**. Los tags que importan:
  - `required`: obligatorio.
  - `catalog_required`: obligatorio para catálogo.
  - `new_required`: obligatorio solo si el producto es nuevo.
  - `conditional_required`: depende del caso; se consulta con `POST /categories/{id}/attributes/conditional`.
  - `read_only`: no se envía.
- GTIN (código de barras) suele ser `conditional_required`. Si no hay código va `EMPTY_GTIN_REASON`, con valores como "El producto no tiene código registrado".
- La condición pasa a ser el atributo `ITEM_CONDITION` (Nuevo / Usado / Reacondicionado). `condition` sigue andando por compatibilidad.
- `GET /categories/{id}` trae `settings.max_title_length` (60), el precio mínimo y `max_pictures_per_item`.

## Fotos
- `POST /pictures/items/upload` con multipart (`file=@...`) devuelve un `id`, que se usa en el ítem como `pictures:[{id}]`.
- Acepta JPG y PNG de hasta 10 MB. Lo ideal es 1200x1200; el mínimo es 500x500 y el máximo 1920.

## Publicar
- `POST /items` con: `category_id`, `price`, `currency_id: ARS`, `available_quantity`, `buying_mode: buy_it_now`, `listing_type_id`, `pictures`, `attributes`, y `sale_terms` si corresponde.
- **User Products**: si el usuario tiene el tag `user_product_seller` (en `GET /users/me`), se manda `family_name` y **no** `title`. Desde 2025 deberían tenerlo todos los vendedores.
- Tipos de publicación: `free`, `gold_special` (Clásica) y `gold_pro` (Premium). Los disponibles salen de `GET /users/{id}/available_listing_types?category_id=..`.
- Descripción: `POST /items/{id}/description` con `{ "plain_text": "..." }`, después de crear el ítem. Solo texto plano: nada de HTML ni emojis.
- **Validador**: `POST /items/validate` con el mismo cuerpo revisa todo **sin publicar**. Es lo que usa el botón "Revisar".

## Precio
- `GET /sites/MLA/search?q=` da **403 sin token** (probado). Falta probarlo con token. Si sigue cerrado, el precio lo estima la IA.
- `/products/search` también da 403.
- Las referencias de precio (`/suggestions/items/{id}/details`) solo andan sobre un ítem que ya existe.

## Pruebas
- No hay sandbox: se prueba en producción con usuarios de test (`POST /users/test_user`, hasta 10). La doc pide no usar la cuenta personal para pruebas. Por eso la prueba del MVP llega hasta el validador, y la primera publicación real la confirma Nico.
