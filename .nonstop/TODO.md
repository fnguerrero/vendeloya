# TODO — ronda 2: 10 mejoras de uso

- [x] 0. Ganchos de verificación: `window.__vy` en demo (estado, pendientes, agregarFotos) y error simulado del análisis con `?demo=1&falla=analizar` · verif: `__vy.estado` accesible y el análisis demo falla con ese parámetro
- [x] 1. Errores en pantalla, sin alert(): aviso del inicio con "Reintentar" para el análisis; fotos chicas, categoría y abrir registro también avisan en la pantalla · verif: con falla=analizar aparece el aviso, las fotos siguen y Reintentar vuelve a llamar; grep sin alert(
- [x] 2. Portada y rotación en el inicio: ★ para hacerla portada (pasa al primer lugar) y ⟳ para rotarla 90° · verif: después de ★ la foto 3 queda primera; después de ⟳ ancho y alto se intercambian
- [x] 3. Pegar fotos con Ctrl+V en el inicio · verif: un evento paste con un File de imagen agrega la foto
- [x] 4. Guardado seguro: guardar en el acto al ocultar la pestaña o en pagehide; "No se pudo guardar · Reintentar" · verif: cambio + visibilitychange (hidden) guarda sin esperar el timer; con la falla simulada el botón Reintentar guarda
- [x] 5. Datos de contacto: un teléfono, mail o link en el título o la descripción va al checklist y frena el Publicar; "envío gratis" u "oferta" en el título es un aviso que no frena · verif: la descripción con "11 5555-1234" marca pendiente y Publicar lleva al campo
- [x] 6. Ctrl+Enter (o Cmd+Enter) en la revisión = Publicar · verif: el keydown dispara la misma lógica (con pendientes, el foco va al campo)
- [x] 7. Historial: chips Todos / Borradores / Publicadas y buscador con 5 registros o más · verif: demo con 6 registros, el filtro y la búsqueda reducen la lista
- [x] 8. "↺ Propuesta de la IA" para el título y la descripción, visible solo si cambiaron · verif: editar el título muestra el link; tocarlo restaura y lo oculta
- [x] 9. Publicada: botones Compartir (Web Share) y Copiar link · verif: con navigator.share simulado se llama con la URL; sin share, copia al portapapeles (stub)
- [x] 10. Revisión: botón "Usar de portada" sobre la foto grande cuando no es la primera · verif: elegir la miniatura 2 y usarla de portada la deja primera en estado.fotos y se guarda
- [x] 11. Versión de caché + verificación final contra la SPEC (compu, celu, consola, tests del Worker) · verif: checklist de criterios en INFORME
