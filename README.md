# YT SEO Pro Suite — Research Workspace

Aplicación estática en español para investigar temas de YouTube y convertir las referencias encontradas en un plan editorial. Funciona en el navegador, sin servidor de aplicación ni base de datos. YouTube proporciona datos públicos; Gemini y DeepSeek son opcionales para la redacción y el análisis con IA.

## Inicio rápido

1. Conserva juntos `index.html`, `research-core.js` y `research-workspace.js`. Puedes abrir `index.html` directamente; para almacenamiento consistente y OAuth, usa un servidor estático:

   ```bash
   python -m http.server 8000
   ```

2. Abre `http://localhost:8000` y coloca tu **YouTube Data API v3 Key** en **Configuración APIs**. **Guardar Configuración** verifica YouTube con una consulta de regiones, sin gastar una búsqueda. La configuración del canal acepta `@handle` o ID.
3. Usa el **Radar de Temas & Canales**. No necesitas una clave de IA para buscar, puntuar, filtrar, guardar referencias o exportar planes.
4. Si deseas usar AI Studio, Vision AI, minería de comentarios o desarrollo del tema, configura Gemini o DeepSeek. Vision AI requiere Gemini.

Los paquetes de Node son exclusivamente para desarrollo y pruebas. La aplicación publicada no necesita ejecutar `npm install` ni un proceso de Node. El diseño conserva Tailwind y Font Awesome desde sus CDN; necesitas conexión para cargar estos recursos y consultar APIs.

## Investigación y filtros

| Tipo | Consulta |
|---|---|
| Tema | Una búsqueda amplia, hasta 25 resultados por relevancia. |
| Nicho | Una búsqueda centrada en la especialidad, hasta 25 resultados. |
| Keyword | Una búsqueda por frase concreta, por vistas totales salvo que elijas otra prioridad. |
| Long-tail | La frase original y hasta tres variantes del autocomplete; respaldo con IA o plantillas. Cada variante genera una búsqueda de Data API. |

Los IDs se deduplican y sus detalles se consultan en lotes de hasta 50. La muestra depende de la búsqueda de YouTube; no es un censo del mercado.

| Filtro | Alcance |
|---|---|
| Disponible en | `regionCode`: videos disponibles en ese país. No limita las vistas a espectadores de ese país. México es el valor inicial. |
| Idioma preferido | `relevanceLanguage`: preferencia por idioma, sin excluir necesariamente otros. Español es el valor inicial. También afecta al autocomplete. |
| Publicado en | Últimos 7, 30, 90 o 365 días; corte calculado al inicio del día UTC. |
| Duración | Categorías de la API: menos de 4 minutos, 4–20 minutos o más de 20 minutos. No identifica si un video es un Short. |
| Prioridad | Relevancia, publicaciones recientes o vistas totales; afecta a la búsqueda en YouTube. |
| Vistas mínimas | Refina la muestra localmente, sin nuevas consultas. |
| Máximo de suscriptores | Refina la muestra localmente. Los canales con suscriptores ocultos o no disponibles se excluyen al activar un máximo; un cero público sí cuenta como dato. |

Cambiar un filtro de país, idioma, fecha, duración o prioridad requiere volver a escanear. Los filtros numéricos actualizan la tabla, los canales y las oportunidades de inmediato. Las últimas 12 búsquedas quedan guardadas con sus filtros; pulsar una repite la consulta.

El detalle de canal busca el mismo tema con los filtros actuales. Si no encuentra resultados, no incorpora videos populares de temas diferentes. Una nueva búsqueda elimina las referencias temporales del detalle y descarta resultados de IA que lleguen tarde desde la investigación anterior.

## Caché y uso de APIs

- Caché **en memoria por sesión y clave**: 15 minutos para búsquedas; 5 minutos para videos, canales, comentarios y otras lecturas públicas.
- Las consultas simultáneas idénticas comparten una petición. Las respuestas fallidas no se guardan.
- **Actualizar desde YouTube sin reutilizar caché** fuerza nuevas lecturas para el escaneo. **Vaciar caché de sesión** elimina las respuestas reutilizables.
- El encabezado cuenta búsquedas, otras consultas, respuestas reutilizadas y fallos de esta página. No consulta la cuota del proyecto ni incluye otros navegadores, aplicaciones o sesiones.
- Las llamadas públicas tienen un límite de espera de 15 segundos. No se reintentan automáticamente los errores de YouTube, para evitar multiplicar consultas cuando una clave o cuota falla.
- Gemini tiene un máximo de dos reintentos para HTTP 429/5xx si no hay respaldo DeepSeek. Las llamadas de IA tienen un límite de espera de 30 segundos por intento. Los errores permanentes y JSON inválidos fallan sin repetir la solicitud.

Consulta la [tabla oficial de cuotas](https://developers.google.com/youtube/v3/determine_quota_cost) y la consola de Google Cloud para conocer los límites de tu proyecto. El contador de la app expresa llamadas observadas, no una estimación de dinero o de cuota restante.

## Tablero editorial y briefs sin IA

Pulsa **+ Guardar** junto a un video del Radar. Cada referencia conserva el tema, enlace, canal, métricas y fecha de lectura, y admite:

- Estado: **Idea → Guion → Producción → Publicado**.
- Fecha prevista de publicación y notas sobre tu enfoque propio.
- **Descargar brief sin IA**: plantilla Markdown con referencia, métricas, tres borradores de título, esquema de producción y pendientes de publicación.
- **Exportar plan .md**: briefs de todas las referencias, ordenados por fecha prevista.
- **Respaldar JSON / Importar respaldo**: hasta 100 referencias y 1 MB por archivo. Se validan formato, versión, IDs y fechas. Al importar duplicados, se conservan las notas y estados que ya tienes.

El tablero se guarda en `localStorage` del navegador y origen actuales. Exporta un respaldo para trasladarlo o recuperarlo en otro dispositivo. Las métricas guardadas son una lectura histórica, no se actualizan al abrir el tablero. Los briefs son plantillas editables; no reproducen ni resumen el contenido completo de la referencia.

## Interpretar las métricas

### Score público de video (0–100)

| Componente | Puntos máximos | Cálculo |
|---|---:|---|
| Velocidad media | 45 | Percentil de vistas/día desde publicación en la muestra, usando el punto medio de los empates. Los videos sin vistas no se clasifican como velocidad alta. |
| Interacción pública | 35 | `(likes + comentarios visibles) / vistas`, con tope al 8%. |
| Recencia | 20 | 20 puntos para menos de 45 días; 12 para menos de 120; 6 para el resto. |

Este score es una **heurística de selección**, no un predictor validado de éxito. Ya no usa likes/vistas como CTR ni la duración como retención. El score de canal es la media de los scores de sus videos presentes en la muestra.

La **dificultad** usa la mediana de suscriptores públicos de canales únicos, evitando ponderar varias veces al mismo canal. Si no hay datos de suscriptores, aparece sin dato. La **oportunidad** suma al score un bonus limitado por el ratio vistas/suscriptores y resta el 25% de la dificultad. El ratio es descriptivo; no demuestra distribución algorítmica ni conversión de abonados.

**Vistas/día** significa promedio desde la publicación. Las etiquetas de velocidad son relativas a la muestra, y la comparación de publicaciones recientes frente a antiguas no demuestra aceleración de un mismo video.

### Crecimiento medido: cohortes

Cada escaneo guarda una lectura de vistas por video, con un máximo de ocho y poda a 180 días. Las búsquedas dentro de 12 horas conservan la lectura anterior completa, sin sustituir sus vistas manteniendo una fecha vieja.

Con lecturas separadas al menos tres días, la columna **Real** calcula la diferencia observada de vistas por día. Para clasificar **Acelerando / Sostenido / Enfriando** hacen falta dos intervalos de al menos tres días. Una disminución se etiqueta como corrección de vistas. Esta evidencia no garantiza que el rendimiento continúe ni confirma por sí sola que el tema sea evergreen.

### Escenarios de ingresos

`Vistas / 1,000 × RPM elegido` es un escenario, no el ingreso real de un competidor. El escenario de 30 días de un canal extrapola la suma de la velocidad media de los videos de la muestra; no representa todo el canal ni ingresos mensuales medidos. Un RPM manual de cero se conserva y recalcula las tablas inmediatamente.

El CSV mantiene todos los resultados visibles y su orden, incluye BOM y separador `;` para Excel, y neutraliza celdas que podrían interpretarse como fórmulas. Su columna de horas a duración completa se etiqueta como máximo teórico; **no es watch time medido**.

## YouTube Analytics opcional

Configura un **OAuth Client ID de aplicación Web**, habilita YouTube Analytics API y autoriza el origen desde el que sirves la app. Conecta el canal para obtener un reporte de los últimos 90 días, incluyendo vistas, horas vistas, suscriptores netos y `estimatedRevenue`. Los ingresos son los reportados por Analytics, aún estimados por YouTube; no equivalen a pagos finalizados.

Se solicitan estos permisos de lectura:

- `youtube.readonly`
- `yt-analytics.readonly`
- `yt-analytics-monetary.readonly`, necesario para ingresos

La [documentación de Reports: Query](https://developers.google.com/youtube/analytics/reference/reports/query) explica los permisos y la disponibilidad de métricas.

Si hay un RPM reportado mayor que cero, la app recalcula los escenarios del Radar con ese valor. Aplicarlo a otros canales sigue siendo una hipótesis. El token OAuth permanece solo en memoria y expira según la respuesta de Google. **Desconectar** revoca el acceso, borra el reporte y restaura el RPM manual. Los tokens antiguos que una versión anterior guardó en `localStorage` se eliminan al abrir la app.

## Módulos existentes

Se conservan Resumen SEO, Competencia, AI Studio, Auditoría, Vision AI, Content Gaps, desarrollo del tema y minería de comentarios. El análisis cuantitativo del nicho también funciona sin IA; la interpretación estratégica requiere Gemini o DeepSeek.

El autocomplete devuelve sugerencias, **no volumen de búsqueda**. La minería solicita comentarios por relevancia y ordena la muestra devuelta por likes; no garantiza recuperar los comentarios más votados de todo el video ni identificar preguntas realmente sin respuesta.

Las transcripciones siguen siendo de mejor esfuerzo mediante Piped, Invidious y proxies CORS. Su disponibilidad depende de esos servicios y de YouTube. Puedes configurar un proxy público con `{url}` en opciones avanzadas. Si no se consigue una transcripción, el desarrollo usa metadatos y lo indica.

## Datos y mantenimiento

Las API keys no se guardan en almacenamiento persistente ni se incluyen automáticamente en los respaldos. Se envían al proveedor correspondiente desde el navegador. El token de Analytics no entra en la caché pública.

El tablero, historial, cohortes y preferencias son locales. Los CDN de diseño, Google Identity Services, autocomplete y los servicios de transcripción también reciben las solicitudes que les corresponden. El HTML y las respuestas de IA se escapan al renderizarlos en los módulos modificados.

Código:

- `index.html`: interfaz y módulos de análisis existentes.
- `research-core.js`: cliente público de YouTube, filtros, cohortes, CSV y validación de respaldos.
- `research-workspace.js`: tablero editorial, historial y enlace de las herramientas con la interfaz.

## Pruebas

Con Node 20+:

```bash
npm ci
npm run check
npm test
```

Las pruebas cubren caché, solicitudes concurrentes, límites de espera, errores, filtros, cohortes, respaldos, CSV y flujos del DOM con jsdom. Simulan YouTube, IA y OAuth: no gastan cuota y no validan conexiones reales ni el diseño visual. GitHub Actions ejecuta los mismos comandos en cada push y pull request.

Antes de publicar una versión, revisa la interfaz en un navegador real y prueba tus claves y consentimiento OAuth en tu origen autorizado.
