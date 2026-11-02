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

# Ronda 4 (28/10/2026): editor de fotos
#1 — editor.js nuevo (recorte con proporciones, giro, brillo/contraste/saturación/nitidez manuales, mover/portada/sacar, volver a la original) + "+" para sumar fotos en la revisión. Sin IA: Nico eligió Gemini pero se corrigió que Gemini no tiene capa gratis para imágenes (US$ 0,034 por imagen), y decidió dejar solo el editor; la mejora NUNCA es automática
#2 — Bug propio: los botones del editor usaban la clase .filtro, que el historial recorría con querySelectorAll('.filtro') (rompía el historial: "Cannot set properties of null"). Se acotó el selector a #historial-filtros .filtro
#3 — Verificación del editor en el demo (compu y celu 375×812): recorte libre (arrastrar esquina y mover, sin salirse de la foto), 1:1 con el aspecto trabado (539×539 real), girar (600×900 → 900×600), brillo (135 → 231), nitidez/contraste/saturación, restablecer, doble clic a 0, volver a la original (1000×600), mover ◀▶ / portada / sacar, "✎ Editar foto" y "+" en la revisión, guardado con las fotos y sus originales en la nube, última foto no se puede sacar; sin errores no capturados, sin scroll horizontal; 18 tests del Worker
