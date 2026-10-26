# SPEC — ronda 2: 10 mejoras de uso de VendeloYa

## Objetivo
Diez mejoras que hagan más cómodo y más seguro armar y publicar con VendeloYa: menos cartelitos que frenan, fotos más fáciles de acomodar, que no se pierda nada de lo editado y que la app avise antes de que MercadoLibre rechace algo. La ronda 1 (estética) está en `ronda-1-esteticas/`.

## Alcance
Entra: `index.html`, `styles.css`, `app.js` y el modo demo, que se puede ampliar para verificar.
No entra: cambios en el Worker (`worker/`) ni en el flujo con MercadoLibre. No se despliega ni se commitea nada sin el OK de Nico. La paleta y el logo no se tocan.

## Stack y decisiones
- Sin dependencias nuevas: vanilla JS + CSS.
- Verificación en el preview local (`localhost:5610/?demo=1`) con JS (estado, DOM, eventos simulados) y capturas, en 1440×800 y en celu (375×812).
- La versión de caché (`?v=` y `VERSION` del service worker) sube una sola vez, al final.

## Supuestos
- "10 mejoras" sin más detalle: como la ronda 1 fue estética, esta es de **uso** (funcionalidad chica y comodidad). Decidido sin preguntar.
- Solo front: así no hace falta tocar el Worker ni sus tests.
- Las fotos que ya subió MercadoLibre (con `id`) se pueden reordenar, porque el id viaja con su foto. Rotar una foto le borra el `id` para que se vuelva a subir.
- El chequeo de teléfonos, mails y links es un aviso que frena el Publicar (MercadoLibre rechaza los datos de contacto) y te lleva al campo. Las palabras como "envío gratis" u "oferta" en el título son solo un aviso que no frena.
- El filtro y el buscador del historial aparecen recién con 5 registros o más.

## Criterios de aceptación
1. No queda ningún `alert()` en el flujo normal: los errores se ven en la pantalla y el análisis se puede reintentar sin perder las fotos.
2. En el inicio se puede elegir la portada y rotar cada foto. El orden y la rotación llegan a la revisión.
3. Ctrl+V con una imagen en el portapapeles la agrega.
4. Si se oculta o se cierra la pestaña con un cambio pendiente, se guarda en el acto. "No se pudo guardar" ofrece reintentar.
5. Un teléfono, mail o link en el título o la descripción aparece en el checklist y frena el Publicar.
6. Ctrl+Enter publica (pasa por la misma lógica que el botón).
7. El historial filtra por estado y busca por título.
8. Se puede volver al título y a la descripción que propuso la IA.
9. La pantalla de publicada permite compartir o copiar el link.
10. La revisión puede cambiar la portada.
11. Sin errores en consola en demo, sin scroll horizontal en celu y la revisión en 1440×800 sin scroll de página.
12. Los tests del Worker siguen en verde.

## Presupuesto
20 iteraciones.
