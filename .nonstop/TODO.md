# TODO — 10 mejoras estéticas

- [x] 0. Demo que reproduzca la captura: GTIN obligatorio vacío, 6 obligatorios completos, 12 opcionales, descripción larga sin saltos · verif: en demo aparece el GTIN en "Falta completar" (antes del arreglo)
- [x] 1. Alinear "Categoría" y "Condición" (la regla :first-child pegaba en la grilla) · verif: misma coordenada Y de los dos labels
- [x] 2. Precio con separador de miles y sin flechitas · verif: input muestra "45.000", leerPublicacion().precio === 45000, botones de rango lo cargan formateado
- [x] 3. Normalizar borradores viejos: GTIN no obligatorio ("Código de barras, solo si tiene") y defaults (Modelo NA, IVA Exento, impuesto 0 %) · verif: en demo el GTIN pasa a Opcionales y "Falta completar" desaparece si no queda nada
- [x] 4. Foto principal grande en la columna izquierda, miniaturas debajo que la cambian · verif: click en miniatura cambia el src de la principal
- [x] 5. Panel de la IA más prolijo: estado como cita, consejos con ícono, jerarquía de tamaños · verif: captura en 1440×800
- [x] 6. Resumen "listo para publicar" arriba del botón (fotos, título, precio, categoría, datos obligatorios) que se actualiza al editar · verif: con un dato faltante muestra 1 pendiente; al completarlo, todo en verde
- [x] 7. Botón Publicar con ícono y texto según estado ("Publicar" / "Completá 1 dato") · verif: texto cambia al completar el dato
- [x] 8. Header más compacto y consistente (alto ~56 px) · verif: altura medida ≤ 58 px en compu y celu
- [x] 9. Inicio: zona de fotos grande con ícono y arrastrar y soltar en la compu · verif: evento drop con un File agrega la foto
- [x] 10. Historial: tarjetas en grilla en la compu, hover y miniatura más grande · verif: 2+ columnas en 1440 px y una en celu
- [x] 11. Detalles finos: contador del título en ámbar cerca del límite, foco visible, transiciones · verif: contador cambia de color en 55/60
- [x] 12. Verificación final contra los criterios de la SPEC (compu, notebook, celu, consola, tests) · verif: checklist de criterios en INFORME
- [x] 13. Celu: foto principal más baja y barra de Publicar fija abajo en toda la revisión (el sticky solo andaba dentro de la última tarjeta) · verif: botón visible arriba de todo y al final, sin scroll horizontal
