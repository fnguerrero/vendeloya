# Informe — ronda 2: 10 mejoras de uso (25/10/2026)

## Qué se hizo
Diez mejoras de uso, solo en el front (`app.js`, `index.html`, `styles.css`):

1. **Errores en pantalla, sin `alert()`.** Si falla el análisis, aparece un aviso con "Reintentar" y las fotos quedan. Las fotos que no se leen, las que sobran y las chicas también avisan en la pantalla.
2. **Portada y rotación en el inicio.** Con ★ una foto pasa a ser la portada (primer lugar) y con ⟳ se gira 90°.
3. **Pegar fotos con Ctrl+V** en la compu.
4. **Guardado seguro.** Al cambiar de pestaña o cerrar, lo pendiente se guarda en el acto. Si falla, "No se pudo guardar · Reintentar", y lo que no llegó (fotos, miniatura) viaja en el próximo guardado.
5. **Datos de contacto.** Un teléfono, mail, link o WhatsApp en el título o la descripción frena el Publicar y te lleva al campo. Las palabras de promoción en el título ("oferta", "envío gratis") son un aviso que no frena.
6. **Ctrl+Enter publica** desde cualquier campo de la revisión.
7. **Historial con filtros.** Chips Todas / Borradores / Publicadas con cantidades y un buscador sin acentos, desde 5 registros.
8. **"↺ Propuesta de la IA"** para volver al título o la descripción originales.
9. **Publicada: Compartir y Copiar link.**
10. **"★ Usar de portada" en la revisión**, sobre la foto grande. Se guarda con la miniatura nueva.

Cómo probarlo: `py -3 -m http.server 5611` en la carpeta y abrir `http://localhost:5611/?demo=1`. Con `&falla=analizar` o `&falla=guardar` se simulan los errores.

## Verificación
| Criterio | Resultado |
|---|---|
| 1. Sin alert y Reintentar | `grep alert(` sin resultados; con la falla, aviso visible, 3 fotos intactas y Reintentar llega a la revisión |
| 2. Portada y rotación | foto 3 → primera; 800×600 → 600×800 sin el id de ML |
| 3. Ctrl+V | de 3 a 4 fotos con un ClipboardEvent |
| 4. Guardado al salir y reintento | guardado a los 500 ms del visibilitychange (el timer es de 1200); con la falla, Reintentar guarda |
| 5. Contacto | 11 casos bien: el EAN de 13 dígitos, las medidas y los precios no cuentan; Publicar enfoca el campo |
| 6. Ctrl+Enter | con pendiente, foco y resaltado; completo, abre el confirmar; con un diálogo abierto no hace nada |
| 7. Historial | 7 registros: 4 borradores y 3 publicadas; "lampara" encuentra "Lámpara de pie" |
| 8. Propuesta de la IA | aparece al editar; restaura, se oculta y autoguarda |
| 9. Compartir / copiar | stubs: share con título y URL, portapapeles con el link |
| 10. Portada en la revisión | la foto 2 queda primera, guardada con miniatura nueva |
| 11. Pantallas | 1440×800: revisión sin scroll de página ni desbordes. 375×812: sin scroll horizontal. Consola sin errores |
| 12. Tests del Worker | 18 en verde |

## Decisiones propias
- "10 mejoras" sin más detalle: como la ronda 1 fue estética, esta fue de uso.
- Solo front, para no tocar el Worker ni su despliegue.
- El teléfono se detecta por cantidad de dígitos (de 8 a 13). Si son 12 o 13 seguidos sin separar, se toma como código de barras.
- `keepalive` solo cuando el guardado no lleva fotos, por el tope de 64 KB.
- Los atajos (Ctrl+V, Ctrl+Enter) no se muestran en pantallas táctiles.

## Desvíos de la SPEC
- El preview de `.claude/launch.json` no arrancó (tope de 5 servidores por carpeta, ocupados por otras sesiones), así que se probó con un `http.server` propio en el puerto 5611.
- Fuera de eso, no hubo desvíos.

## Bloqueados
Ninguno.

## Iteraciones
12 de 20.
