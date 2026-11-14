# SPEC — ronda 5: 20 mejoras (5 grandes + 15 chicas)

## Objetivo
Que VendeloYa sirva también después del botón Publicar: ver y responder preguntas, retocar precio o pausar sin entrar a MercadoLibre, comparar con artículos parecidos, mejorar la foto con un toque, y un panel de totales. Más quince mejoras de uso chicas en el historial, la revisión y la configuración. Rondas anteriores en `ronda-1-esteticas/`, `ronda-2-uso/` y `ronda-3-uso-y-4-editor/`; el seguimiento del historial (estado, visitas, preguntas) se hizo el 31/10 fuera de nonstop (commit 40618b2).

## Alcance
Entra: `worker/` (rutas nuevas, lógica pura en `logica.js` con tests), `index.html`, `styles.css`, `app.js`, `editor.js`, `sw.js` y el modo demo (`?demo`), que se amplía para poder verificar sin la cuenta real.
No entra: publicar nada nuevo en MercadoLibre (pedido explícito de la sesión Emprendimientos), tocar la paleta o el logo, dependencias nuevas. Commit sí (CLAUDE.md: no pide confirmación); **push y deploy solo con el OK de Nico al final**.

## Stack y decisiones
- Vanilla JS + CSS, sin dependencias. Lógica nueva del Worker en `logica.js` (pura, testeable con `node test.mjs`).
- Acciones sobre publicaciones vía la API de MercadoLibre: `PUT /items/{id}` (price, status), `POST /answers` (responder), `GET /my/received_questions/search` (preguntas).
- IA para fotos con Workers AI (binding `AI` en `wrangler.toml`, cuota gratis 10.000 neurons/día). Nunca automática: botón "Mejorar con IA", antes/después, y la original queda guardada (ya lo hace el editor).
- Borrador de respuesta a preguntas con Claude (`ia.js`), a partir de título, descripción, nota privada y la pregunta. Nico siempre aprueba antes de enviar.
- Verificación: `node test.mjs`, `node --check`, y el demo en el preview local (puerto 5610 si sigue vivo, si no `py -3 -m http.server 5611`) con JS (DOM, eventos simulados) y capturas en escritorio y 375×812.
- `?v=` de app.js/styles.css y `VERSION` del service worker suben una sola vez, al final.

## Supuestos
- "Fondo limpio" depende de que Workers AI tenga un modelo de segmentación o quita-fondo. Si no lo hay, la mejora con IA pasa a ser **recorte automático al producto** (detección de objetos `@cf/facebook/detr-resnet-50`) + auto-niveles en canvas, con el mismo botón y antes/después. Se decide al llegar al ítem mirando `npx wrangler ai models`.
- **Decidido en la iteración 4:** `wrangler ai models` no tiene ningún modelo de segmentación ni quita-fondo; lo único que edita imágenes es FLUX.2 klein (generativo), que puede cambiar el producto y para una venta eso es engañar al comprador. Así que "Mejorar con IA" pasa a ser **"Mejorar con un toque"** en el cliente: auto-niveles, balance de blancos y nitidez suave en canvas, con antes/después y la original guardada. Sin Worker ni binding AI. Es un desvío de la SPEC y va al informe.
- "Borradores en la nube" ya existe (los registros viven en KV): la quinta grande pasa a ser el **panel de totales** del historial.
- "Sugerencia de precio" ya existe como rango de mercado: la grande es mostrar los **parecidos** (título, precio, link) que ese rango usa, para comparar a ojo.
- Marcar vendida = cerrar la publicación en MercadoLibre (`status: closed`), irreversible: pide confirmación en la app.
- Las respuestas a preguntas se envían solo al tocar "Enviar"; el borrador de la IA es editable.
- En demo, preguntas, parecidos, acciones e IA se simulan en `apiDemo` con datos fijos.

## Criterios de aceptación
1. Preguntas: desde el historial se abren las preguntas sin responder de una publicación, se puede pedir un borrador a la IA, editarlo y enviarlo; la enviada desaparece de la lista.
2. Parecidos: en la revisión, debajo del rango de precio, se ven hasta 5 artículos parecidos con precio y link (o nada, sin error, si MercadoLibre no los da).
3. Editar lo publicado: desde el historial, una publicada permite cambiar el precio, pausar/reactivar y marcar vendida (con confirmación); el chip y el seguimiento se actualizan.
4. Mejorar con IA: en el editor hay un botón que mejora la foto (fondo o recorte automático según el modelo disponible), muestra antes/después y permite descartar; la original sigue disponible.
5. Totales: arriba del historial, activas, vendidas, $ vendido, visitas y preguntas sin responder, calculados del seguimiento.
6. Fechas relativas en el historial (hoy, ayer, hace N días, luego dd/mm).
7. Filtro "Vendidas" en el historial, con su cuenta.
8. Copiar link de cada publicada desde el historial, con toast.
9. Contador de fotos en la revisión y aviso (no bloqueante) con menos de 3 fotos.
10. Texto de posición del precio frente al mercado (por debajo / dentro / por encima).
11. Chips para sumar al título la marca o el modelo que la IA vio y faltan.
12. Botón "+ Medidas" en la descripción que inserta alto/ancho/largo/peso cargados.
13. Atajos: Esc vuelve o cierra, "/" enfoca la búsqueda, Ctrl+S guarda ya.
14. Pantalla "Publicada" con miniatura, precio y botón al historial.
15. Arrastrar fotos sobre toda la página con un velo "Soltá acá".
16. Exportar historial como JSON desde Configuración.
17. En celu, el botón Publicar queda fijo abajo en la revisión.
18. Tema claro / oscuro / automático en Configuración, recordado por dispositivo.
19. "Actualizado hace N min" junto al botón Actualizar del historial, que gira mientras carga.
20. Aviso antes de publicar si ya hay una publicación activa con título muy parecido.
21. Sin errores en consola en demo, sin scroll horizontal en celu, todos los tests del Worker en verde, `node --check` limpio.

## Presupuesto
40 iteraciones.
