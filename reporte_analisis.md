# Informe técnico de análisis de Big Data

## 1. Descripción del problema

La empresa ficticia DATASTORE S.A.C. necesita transformar datos históricos de ventas en información útil para tomar decisiones operativas y estratégicas. El objetivo principal del análisis es identificar patrones de comportamiento en la demanda, determinar la contribución de cada categoría y sede, y apoyar decisiones de inventario, promoción y distribución.

## 2. Fuente de datos

Los datos provienen de un sistema empresarial de ventas almacenado en un archivo CSV denominado `ventas.csv`. La fuente incluye registros con la siguiente estructura:

- Fecha
- Producto
- Categoría
- Cantidad
- Precio
- Ciudad

El conjunto de datos cuenta con 20 000 transacciones y representa un caso típico de Big Data orientado a análisis comercial.

## 3. Fundamentos del Big Data aplicados

### 5V del Big Data

- Volumen: 20 000 registros de ventas generados durante el período analizado.
- Velocidad: la información se procesa de forma continua como flujo operativo del negocio.
- Variedad: se manejan múltiples dimensiones como productos, categorías, fechas, precios y ciudades.
- Veracidad: se validan fechas, cantidades y precios para evitar errores de calidad.
- Valor: la información obtenida permite identificar tendencias, riesgos y oportunidades de negocio.

## 4. Procesamiento realizado

Se aplicó una limpieza y transformación básica a los datos:

1. Lectura del archivo CSV.
2. Validación de columnas y tipos de dato.
3. Conversión de fechas al formato correcto.
4. Cálculo del monto por transacción con la fórmula:
   Monto = Cantidad × Precio
5. Agregación por producto, categoría, ciudad y mes.
6. Generación de KPIs y gráficos para el tablero ejecutivo.

## 5. Resultados obtenidos

### 5.1. Resumen general

| Indicador | Resultado |
|---|---:|
| Total de ventas | S/ 225,900,472.50 |
| Número de transacciones | 20,000 |
| Cantidad total de productos vendidos | 209,290 |
| Promedio de venta | S/ 11,295.02 |

### 5.2. Principales resultados

| Indicador | Resultado |
|---|---|
| Producto más vendido | Disco SSD 2TB |
| Producto menos vendido | Impresora A |
| Categoría con mayor venta | Computadoras |
| Mes con mayor venta | Enero 2026 |
| Sede con mayor venta | Lima |

## 6. Gráficos estadísticos

Se generaron gráficos para:

- Ventas por mes
- Ventas por categoría
- Productos más vendidos
- Productos menos vendidos
- Ventas por sede o ciudad
- Evolución de las ventas
- Cantidad de productos vendidos por categoría
- Comparación de ventas entre sedes

Estos gráficos permiten visualizar el comportamiento comercial y detectar patrones más allá del volumen bruto de datos.

## 7. Análisis e interpretación

### Pregunta 1: ¿Qué producto debería recibir mayor stock?

- Resultado: Disco SSD 2TB vendió 11,293 unidades.
- Interpretación: Este producto presenta la mayor demanda y, por lo tanto, es la línea con mayor riesgo de desabastecimiento.
- Decisión propuesta: Incrementar el stock y reforzar la disponibilidad del producto para sostener la demanda y evitar pérdidas de venta.

### Pregunta 2: ¿Qué categoría genera mayores ingresos?

- Resultado: Computadoras generó S/ 178,757,192.50.
- Interpretación: La categoría de computadoras concentra el mayor valor en ventas y tiene un fuerte impacto en la rentabilidad del negocio.
- Decisión propuesta: Destinar mayor inversión a marketing, exhibición y logística para esta categoría.

### Pregunta 3: ¿Qué sede tiene mejor rendimiento?

- Resultado: Lima registró ventas por S/ 29,506,115.75.
- Interpretación: Lima lidera el comportamiento comercial y puede ser utilizada como referencia para replicar buenas prácticas en otras ciudades.
- Decisión propuesta: Estudiar la estrategia comercial de Lima y adaptarla a sedes con menor rendimiento.

### Pregunta 4: ¿Qué producto requiere una estrategia de promoción?

- Resultado: Impresora A vendió 9,874 unidades, siendo el producto de menor demanda.
- Interpretación: Aunque no es el producto estrella, su bajo volumen sugiere que necesita apoyo comercial para aumentar su rotación.
- Decisión propuesta: Aplicar promociones, paquetes y campañas específicas para impulsar su demanda.

## 8. Recomendaciones empresariales

1. Aumentar el inventario de Disco SSD 2TB para cubrir la mayor demanda del mercado.
2. Concentrar más inversión en la categoría de Computadoras, dado que es la de mayor valor financiero.
3. Estudiar el comportamiento de Lima como modelo de éxito y adaptar estrategias en otras ciudades.
4. Diseñar promociones para Impresora A para mejorar su demanda y evitar inventario lento.
5. Programar revisiones periódicas del dashboard para identificar cambios estacionales y reaccionar rápidamente a la demanda.

## 9. Conclusión

El análisis de ventas demuestra que los datos masivos, cuando se procesan y analizan correctamente, permiten convertir información operativa en decisiones empresariales estratégicas. En este caso, Big Data no solo cuantifica ventas, sino que también ayuda a prever demanda, optimizar inventario y mejorar la competitividad comercial de la empresa.
