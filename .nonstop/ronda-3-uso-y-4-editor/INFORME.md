# Informe — ronda 3: 10 mejoras de uso (26/10/2026)

## Qué se hizo
Diez mejoras, solo en el front (`app.js`, `index.html`, `styles.css`):

1. **Hacer otra igual.** ⧉ en cada ítem del historial y un botón en "Publicada": crea un borrador nuevo con las fotos y los datos, sin los ids de foto de MercadoLibre ni el link. El original no se toca.
2. **Reordenar las fotos arrastrando** (en la compu). La primera sigue siendo la portada.
3. **Mi cierre de descripción.** Se guarda en Configuración y el botón "+ Mi cierre" lo suma al final, una sola vez.
4. **Nota privada** ("no se publica"), guardada con el borrador.
5. **Precio: −5 %, +5 % y Redondear.**
6. **Prolijar el título:** saca emojis, espacios dobles y signos repetidos, y pasa a minúsculas lo que está todo en mayúsculas.
7. **Sin conexión:** aviso arriba y Armar/Publicar bloqueados. Al volver la señal se saca el aviso y se refresca la cuenta.
8. **Aviso de cuenta en el inicio** (sin conectar, faltan secretos o falta la clave), con botón a Configuración.
9. **Instalar la app** desde Configuración, cuando el navegador lo permite.
10. **Descripción corta:** contador de caracteres y aviso en el checklist (menos de 80), que no frena el Publicar.

Cómo probarlo: `py -3 -m http.server 5612` en la carpeta y abrir `http://localhost:5612/?demo=1`.

## Verificación
| Criterio | Resultado |
|---|---|
| 1. Hacer otra igual | original publicado con id de foto: intacto. Copia: otro id, borrador, 2 fotos sin id, sin `ml`, con nota y miniatura. Abre la revisión. Desde "Publicada" suma un registro |
| 2. Arrastrar | la foto 3 pasa a primera con "Portada"; un archivo soltado desde afuera sigue agregando fotos |
| 3. Cierre | se agrega al final; el segundo toque avisa "ya está" y no duplica |
| 4. Nota | se guarda en `publicacion.nota`, vuelve al reabrir. `worker/logica.js` no la usa |
| 5. Precio | 45.000 → 42.750 → 44.888 → 45.000; 1.234 → 1.200; vacío sigue vacío; la barra se actualiza |
| 6. Prolijar | "TALADRO  PERCUTOR!!! 🔥" → "Taladro Percutor!"; "Black+Decker KR504 500W" intacto; sin cambios no aparece |
| 7. Sin conexión | aviso, Armar y Publicar bloqueados (también con fotos cargadas); al volver, todo habilitado |
| 8. Aviso de cuenta | demo sin cuenta: aviso visible y el botón abre Configuración; reconectada: se va |
| 9. Instalar | con un `beforeinstallprompt` simulado aparece, llama a `prompt()` una vez y se oculta |
| 10. Descripción corta | 14 caracteres: aviso "!" y Publicar habilitado; larga: sin aviso |
| 11. Pantallas | 1440×800: revisión sin scroll de página ni desbordes. 375×812: sin scroll horizontal. Prueba final sin errores no capturados |
| 12. Worker | 18 tests en verde; sin `alert()` en `app.js` |

## Decisiones propias
- "43,5 mejoras" era un error de tipeo: Nico confirmó en la ventana de preguntas **10 mejoras de uso**.
- La nota privada va dentro de `publicacion`: el Worker arma el ítem solo con los campos que conoce, así que no se publica.
- El cierre se guarda en el navegador (por dispositivo).
- Reordenar fotos arrastrando es solo para la compu; en el celu sigue la ★.

## Desvíos de la SPEC
- Un bug propio durante el desarrollo: "Prolijar" y "+ Mi cierre" usaban la clase `.volver-ia`, que `marcarPropuesta()` recorre buscando `data-campo`, y eso rompía la apertura de la revisión. Se corrigió con una clase propia (`.mini-enlace`) y se volvió a probar todo.
- Fuera de eso, no hubo desvíos. La consola del panel conserva los errores de ese bug (corridas anteriores a la corrección).

## Bloqueados
Ninguno.

## Iteraciones
13 de 20.
