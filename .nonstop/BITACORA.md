# Bitácora — ronda 2: 10 mejoras de uso

#0 — Bootstrap: ronda 1 archivada en ronda-1-esteticas/, SPEC y TODO de 10 mejoras de uso (solo front) — n/a
#1 — Ganchos: window.__vy en demo y ?falla=<ruta> (o FALLAS.add) para simular errores — __vy.estado accesible; analizar falla con FALLAS
#2 — Errores en pantalla: aviso del inicio con Reintentar para el análisis; fotos que no se leen, de más o chicas, categoría, abrir y desconectar avisan sin alert — falla simulada: aviso visible, 3 fotos intactas, Reintentar llega a la revisión
#3 — Portada (★, etiqueta "Portada" en la primera) y rotar 90° (le borra el id de ML) — la foto 3 pasa a primera; 800×600 → 600×800 sin id
#4 — Pegar fotos con Ctrl+V en el inicio — ClipboardEvent con un File: de 3 a 4 fotos
#5 — Guardado seguro: al ocultar la pestaña o en pagehide guarda ya (keepalive si no lleva fotos); lo extra de un guardado fallido viaja en el siguiente; "No se pudo guardar · Reintentar"; beforeunload solo si falló — visibilitychange guarda a los 500 ms (antes del timer de 1200); con falla, Reintentar guarda
#6 — Datos de contacto (teléfono, mail, link, WhatsApp) en título o descripción: pendiente que frena y lleva al campo; palabras de promoción en el título: aviso "!" que no frena — 11 casos del detector bien (EAN de 13 dígitos, medidas y precios no cuentan); Publicar enfoca la descripción
#7 — Ctrl/Cmd+Enter = Publicar (no corre con un diálogo abierto ni esperando) — con pendiente enfoca y resalta el campo; completo abre el confirmar. La primera prueba falló por la prueba: el Modelo ya venía "NA" por defecto, no había pendiente
#8 — Historial: chips Todas/Borradores/Publicadas con cantidades y buscador sin acentos, desde 5 registros — 7 registros: 4 borradores, 3 publicadas; "lampara" encuentra "Lámpara de pie"; sin resultados muestra "No hay nada con ese filtro."
#9 — "↺ Propuesta de la IA" en título y descripción, solo si cambiaron — se ve al editar; restaura, se oculta, contador 38/60 y autoguarda
#10 — Publicada: Compartir (Web Share, oculto si no hay) y Copiar link con toast — stubs: share con título y URL, portapapeles con el link
#11 — Revisión: "★ Usar de portada" sobre la foto grande cuando no es la primera — la foto 2 pasa a primera, se guarda con miniatura nueva, botón oculto
#12 — Versión de caché (css 14, app 12, sw vendeloya-9) y verificación final: 1440×800 sin scroll ni desbordes, celu sin scroll horizontal, consola limpia, 18 tests — INFORME escrito
