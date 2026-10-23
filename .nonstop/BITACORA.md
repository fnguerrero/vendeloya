# Bitácora — 10 mejoras estéticas

#0 — Bootstrap: SPEC, TODO (12 ítems: 10 mejoras + demo + verificación), settings del proyecto; .nonstop y .claude excluidos del deploy — n/a
#1 — Demo con GTIN y impuesto obligatorios vacíos, 3 fotos y más consejos de la IA — en demo 'Falta completar' muestra MODEL, GTIN, IMPORT_DUTY (como la captura)
#2 — Categoría y Condición alineadas: la regla :first-child pegaba en el primer label de la grilla, ahora es > .campo:first-child — labels en Y=175 los dos (la primera medición falló por CSS en caché: versión subida a v=5)
#3 — Precio en texto con puntos de miles y cursor estable; leerPublicacion lo devuelve como número — demo: 45.000 inicial, Máximo carga 52.000, tipeado 1234567 se ve 1.234.567 y se lee 1234567
#4 — normalizarAtributos en la app (GTIN opcional, Modelo NA, IVA Exento, impuesto 0 %) para borradores viejos — demo: Falta completar queda vacío y oculto, GTIN en Opcionales como Código de barras (solo si tiene)
#5 — Foto principal grande (4:3, contain) con miniaturas en botones que la cambian — demo: click en la 3.ª cambia el src y marca activa=2; sin scroll de página
#6 — Panel de la IA: etiqueta 'Lo que vio la IA', estado como cita con borde azul, consejos con ícono ámbar y separadores — captura 1440×800 ok; la columna scrollea por dentro con 6 fotos
#7 — Resumen 'listo para publicar' en chips (fotos, título, categoría, precio, obligatorios) que se actualiza al editar — demo: con Modelo vacío marca 'Falta 1 dato obligatorio'; completo, todo en verde
#8 — Botón Publicar con ícono y estado: 'Completá lo que falta' (claro) lleva al campo, abre su grupo y lo resalta sin llamar a la API — demo: foco en MODEL, grupo abierto, sin espera; completo vuelve a 'Publicar'
#9 — Header compacto: 52 px de alto (logo 30 px, chip y engranaje más chicos) — medido en 1440×800
#10 — Inicio: zona grande punteada con ícono de cámara, 'Agregar más fotos · N de 6', arrastrar y soltar; botón de cámara solo en pantallas táctiles — demo: drop de un File agrega la foto y habilita Armar
#11 — Historial en tarjetas de 2 columnas en la compu, hover, miniatura 60 px, título en 2 líneas y estado abajo; main a 760 px — demo: 2 columnas de 343 px, título sin cortar
#12 — Detalles: contador del título en ámbar desde 55/60, foco visible, transiciones — demo: 56/60 con clase cerca
#13 — Celu: Publicar fijo abajo (el sticky solo valía dentro de su tarjeta), foto más baja, chips en una fila; grupo sin corte; foto más baja con poca altura — celu: botón visible arriba y abajo, nada tapado, sin scroll horizontal
#14 — Verificación final: 1440×800 sin scroll y sin desbordes, alineados, precio, GTIN, checklist, foto, celu y 18 tests ok; en 1366×680 los consejos scrollean 74 px por dentro (anotado como desvío) — INFORME escrito
