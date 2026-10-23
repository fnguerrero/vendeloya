# Informe — 10 mejoras estéticas (23/10/2026)

## Qué se hizo
Pulido visual de VendeloYa, sobre todo en la pantalla de revisión:

1. **Categoría y Condición alineadas.** La regla `:first-child` también agarraba al primer label de la grilla.
2. **Precio con puntos de miles** ("380.000") y sin las flechitas del navegador. Por dentro sigue siendo un número.
3. **Borradores viejos normalizados.** El código universal ya no aparece como obligatorio (pasa a "Código de barras, solo si tiene"), y se aplican Modelo NA, IVA Exento e impuesto interno 0 %.
4. **Foto principal grande**, con miniaturas que la cambian.
5. **Panel de la IA más prolijo.** Etiqueta "Lo que vio la IA", el estado como cita y los consejos con ícono.
6. **Resumen "listo para publicar"** en chips: fotos, título, categoría, precio y datos obligatorios. Llena el hueco que quedaba en la columna derecha.
7. **Botón Publicar con ícono y estado.** Si falta algo dice "Completá lo que falta" y te lleva al campo sin llamar a MercadoLibre.
8. **Header más compacto**: 52 px de alto.
9. **Inicio**: zona grande para elegir o arrastrar fotos. El botón de cámara aparece solo en pantallas táctiles.
10. **Historial en tarjetas** de dos columnas en la compu, con hover y título en dos líneas.
11. **Detalles**: el contador del título se pone ámbar cerca del límite, el foco es visible y hay transiciones.
12. (extra) **Celu**: la barra de Publicar queda fija abajo en toda la revisión, y la foto es más baja.

Cómo probar: `py -3 -m http.server 5610` en la carpeta del proyecto y abrir http://localhost:5610/?demo=1. El modo demo ahora reproduce el caso de la captura: el GTIN obligatorio y el impuesto vacío.

## Verificación (criterios de la SPEC)
1. 1440×800 sin scroll de página, y ninguna de las tres columnas se desborda: **ok** (scrollHeight 800 = alto).
2. Categoría y Condición a la misma altura: **ok** (las dos en Y=175).
3. Precio "45.000" y `leerPublicacion().precio === 45000`. Tipeando 1234567 se ve 1.234.567: **ok**.
4. Un borrador con GTIN obligatorio no lo muestra en "Falta completar": **ok** (pasa a Opcionales).
5. El resumen refleja lo que falta: **ok** (Modelo vacío → "Falta 1 dato obligatorio"; completo → todo en verde).
6. La foto grande cambia con las miniaturas: **ok**.
7. Sin scroll horizontal en el celu: **ok**. En la consola solo aparecen dos 401 de la primera carga sin `?demo` y sin clave, que es lo esperado; el demo no genera errores.
8. Tests del Worker: **18 en verde**.

## Decisiones por criterio propio
- La normalización de borradores viejos se duplicó en la app (`normalizarAtributos`) en vez de reanalizar, para no gastar llamadas a la IA.
- Si falta algo, el botón Publicar lleva directo al campo en vez de preguntarle a MercadoLibre: es más rápido y no consume la API.
- La cámara se ofrece solo en pantallas táctiles: en la compu abre el mismo selector de archivos que la zona grande.

## Desvíos de la SPEC
- Se agregó el ítem 13 (celu), que no estaba previsto: en la verificación final apareció que el botón sticky solo se veía dentro de su tarjeta.
- En una notebook de 1366×680, la lista de consejos de la IA scrollea por dentro de su columna (74 px). La página no scrollea. Se achicó la foto en pantallas bajas, pero no alcanzó para todo; se dejó así porque es lo menos importante de la pantalla.

## Bloqueados
Ninguno.

## Iteraciones
14 de 20.
