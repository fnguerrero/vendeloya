# Informe — ronda 5: 20 mejoras (02/11/2026)

## Qué se construyó
Cinco mejoras grandes y quince chicas sobre VendeloYa, en el Worker y en la app:

**Grandes**
1. **Preguntas**: tocar una publicada en el historial abre su panel; abajo están las preguntas sin responder, con "✨ Sugerir respuesta" (Claude, con la publicación y la nota privada) y "Enviar" (va a MercadoLibre). Rutas `GET /api/preguntas`, `POST /api/preguntas/<id>/borrador`, `POST /api/preguntas/<id>/responder`.
2. **Parecidos**: en la revisión, bajo el rango de precio, los 5 artículos más cercanos al sugerido con precio y link.
3. **Editar lo publicado**: en el mismo panel, cambiar precio, Pausar / Reactivar y Marcar vendida (doble toque; cierra la publicación). Ruta `POST /api/publicaciones/<mlId>`.
4. **Mejorar con un toque** en el editor de fotos: niveles, balance de blancos, saturación y nitidez calculados de la foto; "👁 Antes" para comparar; la original queda guardada.
5. **Totales** arriba del historial: activas, vendidas, $ vendido, visitas y preguntas sin responder.

**Chicas**: fechas relativas (hoy, ayer, hace N días); filtro Vendidas; Copiar link y WhatsApp desde el panel; cuenta de fotos N/6 y aviso con menos de 3; posición del precio en palabras (por debajo / dentro / por encima); chips "+ Marca" y "+ Modelo" que faltan en el título; "+ Medidas" en la descripción; atajos Esc, "/" y Ctrl+S; pantalla Publicada con portada, precio y botón al historial; arrastrar fotos sobre toda la página; tema claro / oscuro / como el sistema; descargar el historial en JSON; "actualizado hace N min" y botón Actualizar girando; aviso si ya hay una publicada muy parecida.

## Cómo correrlo
- Local: `py -3 -m http.server 5610 --directory "W:\Working Folder Personal\Apps\VendeloYa"` y abrir `http://localhost:5610/?demo` (todo simulado, sin cuenta).
- Tests del Worker: `node test.mjs` en `worker/`.
- Producción: `npx wrangler deploy` en `worker/` y `npx wrangler deploy --config wrangler-app.toml` en la raíz (con el OK de Nico).

## Verificación
- 23 tests del Worker en verde (3 nuevos: `cambioPublicacion`, `validarRespuesta`, `elegirParecidos`; 2 de la víspera para el seguimiento).
- `node --check` limpio en los 7 archivos JS.
- Cada ítem verificado en el demo por JS (DOM y eventos simulados), con consola sin errores en todas las corridas; capturas en escritorio y 375×812 sin scroll horizontal (inicio con totales, panel de publicación, revisión con chips y parecidos, Publicada).
- Los 21 criterios de la SPEC pasan, con el criterio 4 leído según el desvío de abajo.

## Decisiones tomadas por criterio propio
- Una publicada se abre en su panel (no va directo a MercadoLibre); "Ver en MercadoLibre" está en el panel.
- Marcar vendida pide doble toque en 6 segundos en vez de otro diálogo.
- El precio que muestra el historial es el real de MercadoLibre cuando llegó el seguimiento (manda sobre el guardado).
- Las respuestas se validan como MercadoLibre: sin links, mails ni teléfonos; hasta 2000 caracteres.
- Publicadas = las que siguen en venta; Vendidas = lo que dice MercadoLibre (vendida o finalizada).

## Desvíos de la SPEC
- **Mejorar con IA → Mejorar con un toque, sin IA.** `wrangler ai models` no tiene segmentación ni quita-fondo; lo único que edita imágenes es FLUX.2 klein, generativo, que puede cambiar el producto. Se hizo en el cliente con canvas. Sin binding AI ni ruta nueva.
- **Ítem 17 (Publicar fijo abajo en celu)** ya existía desde la ronda 2 (`.col-datos .acciones` sticky). Se reemplazó por **WhatsApp desde el panel**.
- **Ítem 8 (Copiar link)** quedó en el panel de la publicación, no como botón suelto en cada fila.
- "Borradores en la nube" ya existía (KV) y "sugerencia de precio" también (rango): se reemplazaron por totales y parecidos, como decía la SPEC desde el bootstrap.
- `?v=` de app.js, styles.css y editor.js se subieron antes del final (hacía falta para verificar sin caché), no una sola vez al cierre.

## Bloqueado
Nada quedó `[!]`.

## Pendiente de Nico
- Push y deploy de los dos Workers (la skill no lo hace sola).
- Probar con la cuenta real: responder una pregunta de verdad y cambiar un precio. En demo está todo simulado; en producción cada acción va a MercadoLibre.

## Iteraciones
9 de 40.
