# Bitácora — ronda 3: 10 mejoras de uso

#0 — Bootstrap: ronda 2 archivada en ronda-2-uso/; Nico confirmó 10 mejoras de uso (solo front); SPEC y TODO de 11 ítems — n/a
#1 — Ganchos __vy ampliados (hacerOtraIgual, moverFoto, prolijar, redondear, actualizarRed, cierre) — presentes en __vy
#2 — Reordenar miniaturas arrastrando (dragstart/over/drop, un drop de archivo externo no se confunde) — foto 3 → primera con "Portada"; drop externo agrega la 4ª
#3 — Falló: al escribir el código, "Prolijar" y "+ Mi cierre" quedaron con la clase .volver-ia, y marcarPropuesta() las recorre buscando data-campo: TypeError en la consola y la revisión ni se abría. Era un bug del código, no de la prueba — se renombró la clase a .mini-enlace
#4 — Hacer otra igual (⧉ en cada ítem del historial y botón en "Publicada"): borrador nuevo con las fotos sin id de ML, sin ml, nota incluida; el original no se toca — original publicado con id de foto: intacto; copia sin id ni ml, abre la revisión; desde Publicada suma un registro
#5 — Cierre de descripción (Configuración + "+ Mi cierre"), una sola vez — se agrega al final, el segundo toque avisa que ya está
#6 — Nota privada (publicacion.nota, "tiene una nota") — se guarda en el borrador, vuelve al reabrir; worker/logica.js no la usa
#7 — Precio −5 %, +5 %, Redondear (paso 10/100/500/1000 según el monto) — 45.000 → 42.750 → 44.888 → 45.000; 1.234 → 1.200; vacío sigue vacío
#8 — Prolijar el título (emojis, espacios, signos repetidos, TODO MAYÚSCULAS → Título) — "TALADRO  PERCUTOR!!! 🔥" → "Taladro Percutor!"; sin cambios no aparece; "KR504 500W" intacto
#9 — Sin conexión: aviso arriba y Armar/Publicar bloqueados, vuelve al reconectar y refresca cuenta/historial — offline/online simulados
#10 — Aviso de cuenta en el inicio (conectar / faltan secretos / clave) con botón a Configuración; Instalar app (beforeinstallprompt) — demo sin cuenta: aviso visible y abre Configuración; reconectada: se va; instalar llama a prompt() una vez
#11 — Descripción corta: contador y aviso "!" que no frena (menos de 80) — 14 caracteres: aviso y Publicar habilitado; larga: sin aviso
#12 — Versión de caché (css 15, app 13, sw vendeloya-10), sintaxis, sin alert() y 18 tests del Worker
#13 — Verificación final: 1440×800 sin scroll ni desbordes, celu sin scroll horizontal, prueba sin errores no capturados, 18 tests — INFORME escrito
