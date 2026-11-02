# TODO — ronda 3: 10 mejoras de uso

- [x] 0. Ganchos: exponer en `__vy` lo nuevo (duplicar, prolijar, estado de red) y poder simular offline · verif: `__vy` tiene las funciones
- [x] 1. Hacer otra igual: botón en cada ítem del historial y en la pantalla de publicada · verif: crea registro con otro id, mismas fotos, sin `id` de foto, sin `ml`, estado borrador, y abre la revisión
- [x] 2. Reordenar miniaturas del inicio arrastrando · verif: eventos dragstart/drop mueven la foto 3 al primer lugar y se ve "Portada" en ella
- [x] 3. Cierre de descripción: campo en Configuración y botón "+ Mi cierre" en la descripción · verif: guardar, tocar el botón agrega al final una sola vez
- [x] 4. Nota privada ("no se publica") en la revisión · verif: se guarda en el registro dentro de publicacion.nota y vuelve al reabrir; armarItem del Worker no la usa
- [x] 5. Precio: botones −5 %, +5 % y Redondear · verif: 45.000 → 42.750 / 47.250 / redondeo a 100; barra y botón activo se actualizan
- [x] 6. "Prolijar" el título · verif: "TALADRO  PERCUTOR!!! 🔥" pasa a "Taladro Percutor!"; sin cambios, el botón no aparece
- [x] 7. Aviso sin conexión y bloqueo de Armar/Publicar · verif: eventos offline/online muestran y sacan el aviso, y el botón queda deshabilitado
- [x] 8. Cuenta no conectada: aviso en el inicio con botón a Configuración · verif: en el demo desconectado el aviso aparece y el botón abre el diálogo
- [x] 9. Instalar app en Configuración (beforeinstallprompt) · verif: con un evento simulado aparece el botón y llama a prompt()
- [x] 10. Descripción corta: contador de caracteres y aviso en el checklist que no frena · verif: con 20 caracteres hay aviso "!" y Publicar sigue habilitado; con 120 desaparece
- [x] 11. Versión de caché + verificación final contra la SPEC (compu, celu, consola, tests del Worker) · verif: checklist en INFORME
