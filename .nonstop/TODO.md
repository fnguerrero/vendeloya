# TODO — ronda 7

- [x] 1. Cola: helpers puros `colaParaGuardar` / `colaRestaurada` en el bloque compartido de app.js · verif: tests nuevos (criterio 1)
- [x] 2. Cola: guardado en IndexedDB (con fallback), carga al arrancar, aviso nuevo, `beforeunload` solo si no se pudo guardar · verif: `?demo` por JS (criterio 2)
- [x] 3. Variantes con color y fotos: `limpiarVariantes`, `conVariante`, etiqueta · verif: tests puros + mutantes (criterio 3)
- [x] 4. Worker revisar/publicar con color y fotos por variante, y solo-color sin guía · verif: test con ML simulado (criterios 3 y 4)
- [x] 5. App: columna de color y fotos por fila, confirmación, listo y panel con "Talle · Color", demo · verif: `?demo&moda` por JS (criterio 5)
- [x] 6. Condicionales: `leerCondicionales` + `/api/condicionales` + `tools/probar-condicionales.mjs` · verif: tests con formas de respuesta y ML simulado (criterio 6)
- [x] 7. Condicionales en la app: consulta con pausa, aviso y campo obligatorio, demo · verif: `?demo` por JS (criterio 7)
- [x] 8. Escáner: `gtinFront` en el bloque compartido y tests contra `gtinValido` · verif: tests (criterio 8, parte pura)
- [x] 9. Escáner: botón, diálogo con cámara, lectura confirmada en 2 cuadros, apagado, mensaje sin soporte · verif: `?demo` con `BarcodeDetector` y `getUserMedia` simulados (criterio 8)
- [x] 10. Mutantes de todo lo nuevo · verif: todos mueren (criterio 9)
- [ ] 11. Cierre: versiones, README/NOTAS-API, consola, 375 px, tests, `--seco`, commit, push, intento de deploy, INFORME y REVISION.html · verif: criterio 10
