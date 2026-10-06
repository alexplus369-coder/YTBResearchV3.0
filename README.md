# YT SEO Pro Suite — Investigación y producción

Aplicación estática en español para investigar temas de YouTube, descubrir oportunidades y preparar videos originales: empaquetado, guion completo, storyboard, prompts visuales, edición y publicación. La investigación y los guiones funcionan en el navegador. El motor opcional Python/FFmpeg convierte la producción en MP4 y guarda una cola en SQLite. YouTube proporciona datos públicos; Gemini y DeepSeek redactan los contenidos con IA cuando los configuras.

## Inicio rápido

1. Conserva juntos `index.html`, `research-core.js`, `research-workspace.js`, `creator-core.js`, `creator-studio.js` y `video-production.js`. Puedes abrir `index.html` directamente; para almacenamiento consistente y OAuth, usa un servidor estático:

   ```bash
   python -m http.server 8000
   ```

2. Abre `http://localhost:8000` y coloca tu **YouTube Data API v3 Key** en **Configuración APIs**. **Guardar Configuración** verifica YouTube con una consulta de regiones, sin gastar una búsqueda. La configuración del canal acepta `@handle` o ID.
3. Usa el **Radar de Temas & Canales**. No necesitas una clave de IA para buscar, puntuar, filtrar, guardar referencias o exportar planes.
4. Define el nicho y audiencia en **Estudio de crecimiento y producción**. Tendrás referencias, palabras clave e ideas editoriales sin IA. Configura Gemini o DeepSeek para personalizar las ideas y generar títulos, miniaturas y guiones. Vision AI requiere Gemini.

El frontend estático no necesita paquetes de Node. La fábrica de videos requiere el backend Python y FFmpeg; la edición alternativa con Remotion requiere Node. El diseño conserva Tailwind y Font Awesome desde sus CDN; necesitas conexión para cargar estos recursos y consultar APIs.

## Las cuatro herramientas de creación

| Herramienta | Datos y resultado |
|---|---|
| Videos destacados | Referencias del Radar, comparación con otros videos del mismo canal, evidencia del rendimiento atípico y propuestas de adaptación original. Guarda la referencia y el ángulo en el tablero. |
| Palabras clave de tendencia | Menciones en títulos/etiquetas, recencia, velocidad media, sugerencias y cohortes. Cada palabra muestra la evidencia de la muestra; se puede llevar al estudio. |
| Ideas diarias personalizadas | Cinco ideas por día, nicho, audiencia, objetivo y zona horaria. Funciona con propuestas editoriales locales; **Personalizar con IA** produce un lote específico y lo guarda. |
| Guion y producción | Tres empaquetados para elegir antes de generar un guion de 8, 9 o 10 minutos, con seis bloques, escenas y prompts en inglés, locución en español, hoja de edición, monetización y materiales de publicación. |

### Videos destacados y tendencia: evidencia disponible

Un video se etiqueta como **Atípico en esta muestra** cuando su velocidad media desde publicación es al menos 2× la mediana de **otros tres videos** del mismo canal y grupo de duración (menos de 4 min o 4 min en adelante). Solo se comparan videos con duración y vistas disponibles, publicados entre 2 y 365 días atrás. Si faltan pares, se muestra **Comparación insuficiente**, sin adjudicar un outlier.

**Ampliar comparación de canales** consulta las listas de subidas de hasta tres canales y un máximo de 20 publicaciones por canal, reutilizando la caché. Hace como máximo una consulta de canales, tres de listas y dos de detalles de videos, sin nuevas búsquedas. No es un censo del canal; las edades de los videos y los cambios de audiencia pueden afectar la comparación. El formato de duración no identifica Shorts. Adaptar una referencia significa crear una prueba, caso y enfoque propios; el generador no recibe instrucciones de copiarla.

Las palabras se ordenan por menciones en videos (30 puntos), proporción publicada en 30 días (25), velocidad media logarítmica relativa a la muestra (25), presencia en autocomplete (10) y aceleración observada en cohortes (10). Cada video cuenta una sola vez por término. Las cohortes necesitan lecturas separadas en el tiempo; sin ellas se muestran señales actuales y se omite la aceleración. **Ni la puntuación ni autocomplete representan volumen de búsquedas o crecimiento medido de una palabra clave.**

### Ideas diarias

Completa nicho, audiencia y resultado que quieres enseñar. El día se calcula con la zona horaria elegida (Ciudad de México por defecto). Las ideas se renuevan al abrir el panel, volver a la página o cambiar de perfil/muestra; no hay notificaciones ni ejecución en segundo plano. Un lote de IA se reutiliza para el mismo día, perfil y datos, evitando consultas pagadas al abrir el panel. Los cambios de audiencia, objetivos o evidencia lo invalidan. Puedes descargar las cinco ideas en Markdown o elegir una para producir.

### Flujo de guion y producción

1. Escanea el nicho en el Radar y elige una referencia, palabra o idea, o escribe un tema propio. Las referencias elegidas tienen prioridad entre las seis fuentes enviadas al generador.
2. Define audiencia, objetivo, tono, duración, estilo visual y metas de CTR/retención. El RPM se toma del Radar. Los rangos de nichos de la metodología del creador son hipótesis orientativas etiquetadas, no mediciones financieras ni RPM aplicados automáticamente.
3. Añade hechos y enlaces verificables propios. Configura solo las ofertas reales que quieras integrar: sponsor, sus prestaciones, afiliado, URL y recurso propio. Estos campos se guardan localmente como parte del trabajo editorial.
4. **Crear títulos y miniaturas** solicita tres propuestas. Se validan títulos de menos de 50 caracteres, hasta tres elementos visuales y texto que no duplique el título. Los prompts son en inglés, con composición 16:9. Elige una propuesta.
5. **Generar guion y producción** realiza normalmente dos solicitudes de IA (bloques 1–3 y 4–6), conservando la continuidad. Escribe locución completa, no solo un esquema. Se validan todos los bloques, su longitud respecto a un presupuesto de 145 palabras/min y los prompts de cada escena. Si algo falla, se permiten hasta dos reparaciones selectivas por tramo: se envían solo los bloques pendientes con su conteo real y su objetivo; los bloques validados se conservan. Si únicamente falla la extensión, se corrige la locución manteniendo edición y recursos. El paquete de publicación tiene una reparación separada. Si aún falla, **Continuar guion y producción** retoma lo pendiente sin repetir los bloques aceptados. El borrador se mantiene en esta página hasta completarlo, recargar, cambiar el perfil/tema/evidencia o elegir otro empaquetado. Una respuesta incompleta no sustituye la última producción válida. Se muestra la duración estimada de locución para ajustar pausas y demostraciones en el ensayo.
6. Revisa y descarga Markdown o JSON. Markdown incluye la hoja de edición con cambios orientativos cada 5 s (3 s en el gancho), prompts de imagen y clips de video de 5 s, negativos, fuentes, monetización, descripción, comentario fijado y verificaciones. El JSON permite recuperar la producción; se valida y solo incluye campos editoriales autorizados.

El esquema temporal mantiene gancho/re-hook en los primeros 30 s, victoria rápida, núcleo con integración comercial opcional, transición natural de 15 s, revelación y recurso/cierre invisible. En 10 minutos las transiciones principales son 0:30, 3:00, 5:30, 5:45 y 8:00; en 8 o 9 minutos se ajustan al total. El gancho debe iniciar la locución, durar aproximadamente cinco segundos y aparecer con el re-hook en el guion. El cierre rechaza despedidas directas y peticiones de suscripción.

La hoja de edición propone b-roll, gráficos, cambios de plano, zoom 10–15%, SFX sutil y música dinámica. Las escenas se distribuyen dentro de cada bloque: los prompts describen clips cortos que hay que ensamblar o variar para cubrir su duración. El estudio prepara el guion y los prompts; la **Fábrica de videos** opcional puede generar voz, usar recursos propios/stock/Replicate, ensamblar el MP4 y crear recortes. La subida a YouTube se realiza con una acción separada y siempre como privado.

Las transcripciones son opcionales y de mejor esfuerzo para hasta tres referencias. Si no hay transcripción, solo se usan títulos/descripciones, sin considerarlos prueba de afirmaciones. Las notas y las transcripciones también requieren revisión humana; el paquete incluye las comprobaciones pendientes. No se inventan acuerdos de patrocinio, uso personal de productos ni recursos descargables en las instrucciones al modelo.

### Fábrica de videos y recortes

El motor opcional conecta la producción con voz Edge TTS o narración propia, recursos por escena, subtítulos karaoke y render FFmpeg H.264/AAC en 720p/1080p horizontal, vertical o cuadrado. Incluye cola persistente, avances, cancelación, reintentos que conservan recursos, música, vista previa, MP4/SRT y proyecto editable para Remotion. Puedes seleccionar palabras para recortar clips de 1–180 segundos con subtítulos ajustados.

Desde la raíz, con Python 3.12 y FFmpeg/FFprobe instalados:

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
python -m backend
```

Abre `http://127.0.0.1:8787`, conecta el motor con el código que aparece en la terminal y genera una producción en el estudio. **Tarjetas gráficas + narración propia** permite probar sin servicios de IA. Pixabay, Replicate, Whisper.cpp, avisos Telegram y subida privada con OAuth son opciones configurables. Replicate requiere activar explícitamente las generaciones de pago.

Consulta [instalación en Windows/Linux, Docker, proveedores, recuperación y Remotion](docs/video-production.md) y los [avisos de terceros](docs/third-party-notices.md). La automatización no garantiza monetización; revisa originalidad, fuentes, derechos y calidad del resultado antes de publicarlo.

### Monetización y auditoría

El estudio permite calcular un escenario de publicidad, afiliación, patrocinio y producto propio. Solo la publicidad usa el RPM elegido; clics, conversiones, comisiones, leads e ingresos acordados son supuestos manuales que parten de cero. No predice ingresos reales. Las URLs configuradas y la divulgación de afiliación se añaden al inicio de la descripción y al comentario fijado; el patrocinio incluye divulgación y una verificación del acuerdo.

La transición se propone como pausa mid-roll natural en un video monetizado elegible de **8 minutos o más**. La app no inserta anuncios y YouTube decide si los sirve; consulta las [reglas de pausas mid-roll](https://support.google.com/youtube/answer/6175006?hl=es).

La auditoría compara métricas del mismo video y periodo con tus metas editables. Distingue una lectura preliminar antes de 48 h, CTR bajo con muchas impresiones, caída inicial mayor de 40%, retención media baja y valles anotados. Son reglas editoriales, no umbrales universales de éxito.

Con Analytics conectado, **Leer AVD y retención** consulta `averageViewDuration`, `averageViewPercentage` y `audienceWatchRatio` de un video del canal autorizado. Se indica el periodo consultado y se aproxima la caída a 30 s con el punto más cercano de la curva. El ratio puede superar 100% por repeticiones. **CTR de impresiones e impresiones se introducen desde Studio**, porque no se sustituyen por CTR de tarjetas o anotaciones. Los [reportes de canal](https://developers.google.com/youtube/analytics/channel_reports#user-activity-reports) y las [definiciones de métricas](https://developers.google.com/youtube/analytics/metrics) explican esta distinción.

La disponibilidad de informes puede tener retrasos o datos insuficientes. Los reportes privados solo permanecen en memoria; se descartan si cambias el video, el periodo, la búsqueda o desconectas Analytics. No se incluyen en las exportaciones de producción.

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

El tablero, historial, cohortes, perfil editorial, último lote diario de IA y última producción son locales. Los CDN de diseño, Google Identity Services, autocomplete y los servicios de transcripción también reciben las solicitudes que les corresponden. El perfil y las referencias seleccionadas se envían al proveedor de IA cuando pides una generación; las exportaciones no añaden claves ni tokens. El HTML y las respuestas de IA se escapan al renderizarlos en los módulos modificados.

Código:

- `index.html`: interfaz y módulos de análisis existentes.
- `research-core.js`: cliente público de YouTube, filtros, cohortes, CSV y validación de respaldos.
- `research-workspace.js`: tablero editorial, historial y enlace de las herramientas con la interfaz.
- `creator-core.js`: perfiles, evidencia de outliers/tendencias, ideas, presupuestos temporales, validación de guiones, escenarios y exportación.
- `creator-studio.js`: cuatro herramientas, generación por etapas, persistencia y auditoría privada opcional.
- `video-production.js`: conexión optativa con el motor, recursos, cola, vista previa, recortes y subida privada.
- `backend/`: API FastAPI, cola SQLite, voz/recursos, FFmpeg, subtítulos y sesiones reanudables de YouTube.
- `remotion/`: composición React opcional alimentada por el proyecto exportado.

## Pruebas

Con Node 20+:

```bash
npm ci
npm run check
npm test
```

Las pruebas cubren caché, solicitudes concurrentes, límites de espera, errores, filtros, cohortes, respaldos, CSV, outliers, tendencias, calendario local, guiones incompletos, monetización y flujos completos del DOM con jsdom. Simulan YouTube, IA y OAuth: no gastan cuota ni validan esas conexiones reales. Las pruebas del backend incluyen renders FFmpeg reales con audio de prueba, subtítulos, proyecto editable con música, recortes y recuperación tras fallos; proveedores y subidas usan respuestas simuladas.

GitHub Actions ejecuta estos checks en los pull requests y los cambios de `main`. También prueba el panel en Chrome, carga recursos propios, genera un MP4, reproduce su vista previa, crea un recorte y captura el diseño en escritorio y móvil. El proyecto exportado se renderiza con Remotion y se comprueban duración, dimensiones y mezcla de audio. Las capturas, informes y el MP4 de prueba quedan en el artefacto `production-verification`.

Para los checks del backend y Remotion consulta la [guía de producción](docs/video-production.md#verificar). Antes de publicar una versión, revisa la interfaz en un navegador real y prueba tus claves y consentimiento OAuth en tu origen autorizado.
