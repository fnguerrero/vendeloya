# SPEC — 10 mejoras estéticas de VendeloYa

## Objetivo
Pulir lo visual de la app (sobre todo la pantalla de revisión en tres columnas) para que publicar se sienta lo más fácil y prolijo posible, a partir de la captura del 23/10/2026: diez mejoras concretas, cada una verificable en el modo demo.

## Alcance
Entra: `index.html`, `styles.css`, `app.js` (presentación y normalización de datos para mostrar). El modo demo puede ampliarse para poder verificar.
No entra: cambios en la API (`worker/`), en la lógica de publicación ni en el flujo de MercadoLibre. No se despliega nada sin confirmación de Nico.

## Stack y decisiones
- Sin dependencias nuevas: vanilla JS + CSS, igual que hoy.
- Verificación en el preview local (`localhost:5610/?demo=1`) con JS (medidas, estados) y capturas, en 1440×800 y en celu (375×812).
- Cada mejora sube la versión de caché (`?v=` y `VERSION` del service worker) una sola vez, al final.

## Supuestos
- "Mejoras estéticas" incluye arreglar cosas que se ven mal en la captura (desalineados, campos que no deberían aparecer como obligatorios), no solo colores.
- El código universal (GTIN) que aparece como obligatorio en un borrador viejo se normaliza en la app: los borradores analizados antes del 22/10 no pasaron por `aplicarDefaults` del Worker.
- El precio se muestra con separador de miles y sin las flechitas del navegador; por dentro sigue siendo un número.
- Nada de cambiar la paleta ni el logo, que Nico ya aprobó.

## Criterios de aceptación
1. En 1440×800 la revisión sigue sin scroll de página y las tres columnas no se desbordan.
2. "Categoría" y "Condición" quedan alineadas a la misma altura.
3. El precio se ve como "380.000" y el número que se guarda/publica es 380000.
4. Un borrador con GTIN marcado obligatorio no lo muestra en "Falta completar".
5. El vacío de la columna derecha lo ocupa un resumen de "listo para publicar" que refleja lo que falta.
6. La foto principal se ve grande en la columna izquierda y las miniaturas la cambian.
7. Sin errores en consola en demo; sin scroll horizontal en celu.
8. Los 18 tests del Worker siguen en verde.

## Presupuesto
20 iteraciones.
