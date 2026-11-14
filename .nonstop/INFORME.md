# INFORME — ronda 7 (14/11/2026): cola persistente, colores con fotos, condicionales, escáner

Estado: **hecho, verificado con ML simulado y con el demo, y desplegado** (API `10b1d958-171f-4e07-b066-cdc61cf0e292`, app `df9b3ef9-4778-4df3-9fcc-d51c986f78d1`; commit `f89153e`). 11 de 11 ítems en 11 iteraciones sobre un presupuesto de 40.

## Qué se construyó
1. **Cola persistente**: "Varios productos a la vez" se guarda en IndexedDB (`vendeloya-cola`). Al cerrar o recargar vuelve con sus fotos; lo que estaba armándose pasa a pendiente y lo ya armado queda como borrador del historial. Si el navegador no deja guardar, avisa.
2. **Colores con fotos por color**: cada fila de la tabla de variantes puede traer talle y/o color, cantidad, precio y fotos propias (miniaturas por toque). Un ítem por talle×color, con `COLOR` y `SIZE` (con su fila de guía). Botón ＋ "otro color de este talle". Categorías sin talle (taladro) funcionan solo con colores. Panel y pantalla final muestran "Talle 40 · Rojo".
3. **Atributos condicionales**: la app pregunta a ML (solo lectura) qué datos pasan a ser obligatorios con lo ya cargado y lo avisa antes de revisar. Ver "Qué queda": el contrato del endpoint no está confirmado.
4. **Escáner de código de barras**: botón junto al GTIN, cámara trasera, `BarcodeDetector`; un código vale con 2 lecturas seguidas y dígito de control válido.

## Cómo probarlo
- Demo local (`py -3 -m http.server 5610 --directory "W:\Working Folder Personal\Apps\VendeloYa"`): `?demo&moda` (talle × color), `?demo&color` (solo color), `?demo` (condicionales: con Potencia cargada pide Peso; `&falla=condicionales-404` lo apaga).
- `node worker/test.mjs` (92 en verde). Sonda real y de solo lectura: `node tools/probar-condicionales.mjs`.

## Verificación (números)
- 92 tests en verde (+10 nuevos en esta ronda con los anteriores), 33 mutantes nuevos más 8 viejos actualizados: todos mueren.
- Demo por JS: cola (2 productos sobreviven a recargar, armando→pendiente, lista sin fotos, vaciar borra, aviso si no se puede guardar); tabla (talle×color, fotos 2 y 3 de una fila, confirmación con detalle, 3 links, panel con "Talle 40 · Rojo"); solo color; condicionales (aviso, se va al completar, 404 y fallo de red no molestan); escáner (lee tras 5 cuadros, ignora inválidos, apaga la cámara al leer/cerrar/Esc/permiso tardío, sin soporte avisa).
- 375 px sin scroll horizontal; consola sin errores propios (queda un 401 de un recurso externo, Google Fonts).
- `tools/validar-lote.mjs --seco`: 8 borradores, 0 faltantes (el camino de un solo talle sin lista no cambió).

## Decisiones tomadas por criterio propio
- Cola: tope 10, IndexedDB por modo (real/demo); no se guarda nada hasta terminar de leer lo guardado (bug propio hallado y corregido al verificar).
- Variantes: máximo 12 contando talle×color; fotos por índice de la tira (si se reordenan, hay que revisar); lo vacío usa los valores comunes.
- Condicionales: no frenan el Publicar (ML sigue decidiendo al validar); se apagan solas con 404/405.
- Escáner: formatos `ean_13/ean_8/upc_a/upc_e` según lo que soporte el navegador.

## Desvíos de la SPEC
- Ninguno de alcance. Dos hallazgos que cambian expectativas: (1) la documentación de ML **no confirma** `POST /categories/{id}/attributes/conditional`; se implementó defensivo y apagable en vez de dar el contrato por cierto. (2) `colaPorPerder` quedó solo para el caso en que no se pueda guardar.

## Qué queda / bloqueado
- **Condicionales sin validar contra ML real**: correr una vez `node tools/probar-condicionales.mjs` (pide la clave por teclado). Si da 404/405, la función no aporta y se puede sacar; la etiqueta `conditional_required` ya se cubre.
- **Escáner**: solo probado con cámara y detector simulados; falta probarlo en un celular real (Chrome). En escritorio Windows `BarcodeDetector` casi nunca existe: avisa y se escribe a mano.
- Colores/fotos y cola: sin prueba contra la cuenta real (regla: no publicar ni tocar nada real).
- Seguimiento de más de 30 ítems y el título editable siguen fuera.
- Nada pendiente de deploy: API y app ya están en vivo.
