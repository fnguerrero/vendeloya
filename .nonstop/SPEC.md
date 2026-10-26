# SPEC — ronda 3: 10 mejoras de uso de VendeloYa

## Objetivo
Otras diez mejoras de uso, solo en el front: publicar más rápido cosas parecidas (duplicar, cierre de descripción), ordenar las fotos con el mouse, cuidar el precio y el título, y que la app avise cuando no hay conexión, cuenta o algo que instalar. Rondas anteriores: `ronda-1-esteticas/` y `ronda-2-uso/`.

## Alcance
Entra: `index.html`, `styles.css`, `app.js` y el modo demo, que se puede ampliar para verificar.
No entra: el Worker (`worker/`) ni el flujo con MercadoLibre. No se despliega ni se commitea sin el OK de Nico. La paleta y el logo no se tocan.

## Stack y decisiones
- Vanilla JS + CSS, sin dependencias.
- Verificación en el preview local (`py -3 -m http.server`, puerto propio, `?demo=1`) con JS (estado, DOM, eventos simulados) y capturas en 1440×800 y 375×812.
- La versión de caché (`?v=` y `VERSION` del service worker) sube una sola vez, al final.

## Supuestos
- "43,5 mejoras" era un error de tipeo: Nico confirmó **10** y de **uso** en la ventana de preguntas.
- La nota privada vive dentro de `publicacion.nota`: el Worker arma el ítem de MercadoLibre solo con los campos que conoce (`armarItem`), así que no se publica. Se verifica que `leerPublicacion` la incluya y que el borrador la guarde.
- "Hacer otra igual" copia análisis, publicación y fotos a un registro nuevo en borrador, sin los ids de foto de MercadoLibre (así se vuelven a subir) y sin el link de la publicación.
- El cierre de la descripción se guarda en el navegador (localStorage), por dispositivo.
- "Prolijar" el título saca emojis, espacios dobles y signos repetidos, y pasa a mayúsculas y minúsculas lo que está todo en mayúsculas.

## Criterios de aceptación
1. En el historial, "Hacer otra igual" crea un borrador nuevo con las mismas fotos y datos, sin id de MercadoLibre ni link, y lo abre.
2. Las miniaturas del inicio se reordenan arrastrando y la primera es la portada.
3. En Configuración se puede guardar un cierre de descripción y un botón lo agrega al final de la descripción (una sola vez).
4. Una nota privada se guarda con el borrador y no aparece en el ítem que arma el Worker.
5. Botones de precio −5 %, +5 % y Redondear dejan el precio como número válido y actualizan la barra.
6. "Prolijar" aparece solo si el título cambia y lo deja bien.
7. Sin conexión, la app muestra un aviso arriba y bloquea Armar y Publicar. Al volver, lo saca.
8. Con la cuenta sin conectar (y no demo), el inicio muestra un aviso con botón a Configuración.
9. En Configuración hay "Instalar app" cuando el navegador lo permite.
10. Descripción corta: aviso en el checklist que no frena, con contador de caracteres.
11. Sin errores en consola en demo, sin scroll horizontal en celu, revisión en 1440×800 sin scroll de página, y los 18 tests del Worker en verde.

## Presupuesto
20 iteraciones.
