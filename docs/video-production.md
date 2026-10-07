# Fábrica de videos

El estudio ahora puede producir un MP4 a partir de una producción guardada: guion → voz → recursos → subtítulos → escenas → render → revisión → subida privada opcional. El backend es independiente del Radar; la investigación y los guiones siguen funcionando con un servidor estático.

La implementación toma como referencia el flujo de [MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo/blob/main/README-en.md) y la edición por escenas de [ShortGPT](https://github.com/RayVentura/ShortGPT). Es código propio integrado con el formato editorial existente. No ejecuta esos repositorios ni exige sus dependencias completas.

## Instalar y empezar

Requisitos: Python **3.12**, FFmpeg/FFprobe en `PATH` y FFmpeg compilado con **libx264, AAC y libass**. Se recomiendan las fuentes DejaVu Sans. Node solo hace falta para las pruebas del frontend y la edición opcional con Remotion.

Linux (Debian/Ubuntu):

```bash
sudo apt-get update
sudo apt-get install ffmpeg fonts-dejavu-core python3-venv
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
python -m backend
```

Windows, desde PowerShell en la carpeta del repositorio, con FFmpeg instalado y disponible en `PATH`:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements.txt
python -m backend
```

Puedes obtener FFmpeg desde sus [enlaces oficiales de descarga](https://ffmpeg.org/download.html). Comprueba `ffmpeg -version` y `ffprobe -version`. En macOS instala también esos binarios antes de crear el entorno Python.

Abre **http://127.0.0.1:8787**. El servidor muestra un código temporal en la terminal si no definiste `YT_RENDER_TOKEN`. En **Estudio de crecimiento y producción → Fábrica de videos**, coloca ese código y pulsa **Conectar motor**. El código permanece en memoria durante la sesión del navegador.

1. Genera una producción completa o recupera su JSON desde el estudio.
2. Selecciona los bloques que quieres producir. Puedes hacer una prueba de un bloque antes del video completo.
3. Elige horizontal, vertical o cuadrado, y 720p o 1080p.
4. Usa **Tarjetas gráficas** para una primera prueba, recursos propios, Pixabay o Replicate. Las tarjetas son composiciones originales simples con texto; revisa su presentación antes de publicar.
5. Usa Edge TTS, voz Replicate o sube tu narración. Con audio propio, el texto del guion debe corresponder a lo que se escucha.
6. Pulsa **Generar MP4**. La cola continúa mientras usas el estudio. Al terminar, revisa el video y descarga MP4, SRT o proyecto editable.

La duración se calcula a partir del audio, no del presupuesto del guion. Una producción escrita para nueve minutos puede durar más o menos con tu voz. El resultado muestra la duración real y si alcanza ocho minutos; esto no confirma elegibilidad ni inserta anuncios.

### Continuar un guion incompleto

El botón **Continuar guion y producción** permanece visible debajo de los avisos del estudio. Se habilita cuando hay un borrador pendiente y muestra cuántos bloques pasaron la validación. Repara los bloques pendientes, conserva los aceptados y completa la publicación cuando sea lo único que falta. Por ejemplo, si el bloque 5 tiene 447 palabras y su máximo es 441, la continuación corrige ese bloque y mantiene los otros cinco.

El avance se guarda después de cada respuesta en **este navegador y este origen**; recargar la página recupera el tema, empaquetado y bloques, sin llamar automáticamente a la IA. Debes volver a configurar Gemini o DeepSeek si su clave ya no está disponible y pulsar Continuar. El borrador es independiente de la última producción completa, que sigue disponible para exportar o renderizar. Al completar y guardar el nuevo guion, se elimina el borrador pendiente.

Los respaldos del borrador solo incluyen campos editoriales admitidos: no guardan claves, tokens, informes privados ni texto de transcripciones. Las referencias recuperadas se indican como metadatos; verifica sus afirmaciones. Cambiar tema, perfil, muestra del Radar o propuesta de título descarta el borrador del contexto anterior y borra los avisos que ya no correspondan. Si el navegador no puede guardar, el panel indica que el avance solo permanece en esa página. No puede recuperar bloques perdidos al recargar una versión anterior que solo los conservaba en memoria. Abrir otro dispositivo u otro dominio tampoco transfiere el borrador.

### Actualizar una instalación ZIP en Windows

Detén el servidor con **Ctrl+C** antes de cambiar archivos. Conserva tu JSON editorial y, para un respaldo completo, la carpeta `render-data`. No necesitas recrear `.venv` ni reinstalar FFmpeg. El script `scripts/update-replicate-studio.ps1` descarga todos los archivos de ejecución de **un commit exacto** antes de reemplazarlos, guarda copias en `update-backups` y restaura los archivos si falla la copia. Actualiza también las correcciones anteriores de guiones y Pixabay. No toca `render-data`, `.venv` ni `.env`, ni ejecuta generaciones o subidas.

Descarga el script desde el mismo commit del PR que deseas instalar (sustituye el marcador por los 40 caracteres del commit) y ejecuta desde la carpeta actual del proyecto:

```powershell
$revision = 'COMMIT_DE_40_CARACTERES_DEL_PR'
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/alexplus369-coder/YTBResearchV3.0/$revision/scripts/update-replicate-studio.ps1" -OutFile '.\update-replicate-studio.ps1'
.\update-replicate-studio.ps1 -Revision $revision
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe -m backend
```

Actualizar solo JavaScript **no es suficiente**: el catálogo, las rutas, la cola y la nueva dependencia `jsonschema` están en Python. Los comandos explícitos de `.venv` evitan el error `No module named uvicorn` por usar otro intérprete. Tras reiniciar, usa **Ctrl+F5** y conecta con el código nuevo de la terminal. Mantén esta misma ventana de PowerShell si ya contiene tus variables de Pixabay/Replicate.

El actualizador sobrescribe esos archivos de código, conservando las versiones anteriores en la ruta que muestra al terminar. Si tienes personalizaciones, revísalas en esa copia antes de reemplazarlas; no sobrescribe archivos ajenos a su lista. Un check de CI en Windows prueba sintaxis, descarga completa, respaldo y restauración con archivos/descargas simulados; no sustituye probar el render y los proveedores en tu equipo. Para instalaciones Git sin cambios propios, después de integrar el PR actualiza `main`, instala de nuevo `backend/requirements.txt` y reinicia.

### Docker opcional

```bash
cp .env.example .env
docker compose up --build
```

Los archivos y la cola se conservan en `render-data/`. El puerto se publica únicamente en `127.0.0.1`. Consulta el código temporal con `docker compose logs video`, o configura uno estable de al menos 24 caracteres en `.env`. `python -m backend` lee variables exportadas; **no carga `.env` automáticamente**. Compose sí usa ese archivo para interpolación. Whisper.cpp requiere añadir el binario/modelo y sus montajes al contenedor; la imagen básica no los incluye. NVIDIA requiere un runtime de GPU y una compilación compatible, y no está habilitado por defecto.

## Sistemas integrados y alcance

| Sistema | Integración |
|---|---|
| MoneyPrinterTurbo / ShortGPT | Flujo equivalente escrito para este estudio: trabajos, escenas, voz, recursos, subtítulos y MP4. |
| FFmpeg | Motor principal real: recortes, escala/crop, zoom de imágenes, unión, mezcla de música, volumen, subtítulos ASS y H.264/AAC. Procesa segmentos sin mantener el video completo en RAM. |
| Edge TTS | Voces español/inglés, audio por bloque y marcas de palabra cuando el servicio las entrega. Requiere internet; no requiere una API key. Puedes usar audio propio. |
| Pixabay | Búsqueda oficial de videos e imágenes de stock, caché de búsquedas de 24 horas y créditos con autor, enlace y licencia por recurso. |
| Replicate Studio | Catálogo de FrameShift, formularios del esquema real y generación de imagen, video, música y voz. Recursos individuales reutilizables o modelos independientes para el MP4; pago confirmado y predicciones reanudables. |
| Whisper.cpp | Transcripción local opcional, unión de subpalabras y marcas de tiempo. No instala ni descarga modelos automáticamente. |
| Remotion | Composición React editable alimentada por `remotion-input.json`, con recursos, voz, subtítulos y barras de datos opcionales. Es una alternativa de edición/render separada del motor principal. |
| YouTube Data API | Subida manual privada con OAuth, sesión reanudable y prevención de duplicados por trabajo. |
| Telegram Bot API | Avisos opcionales de éxito/error cuando el usuario activa la casilla del trabajo. No se envía el guion ni las claves en el mensaje. |
| FunClip / LosslessCut | Se incorpora su función útil de selección textual y recorte con FFmpeg; no se incluyen ni se ejecutan esos proyectos. El recorte se recodifica para reencuadrar y ajustar subtítulos. |
| Kdenlive / Shotcut | MP4, audio, recursos y SRT exportados para edición manual. No se genera un archivo de proyecto nativo de esos editores. |

El estudio existente ya coordina Gemini/DeepSeek para el empaquetado y el guion JSON. CrewAI, MoviePy y ffmpeg-python no son dependencias de este motor: FFmpeg se ejecuta directamente y la selección editorial queda en el estudio. WhisperX tampoco se incorpora; la opción local implementada es Whisper.cpp.

## Proveedores y configuración

Las claves de proveedores se configuran en el **servidor**, nunca en el panel de producción ni en el ZIP. Por ejemplo en Bash:

```bash
export PIXABAY_API_KEY='tu-clave'
export YT_RENDER_TOKEN='un-codigo-propio-largo-de-al-menos-24-caracteres'
python -m backend
```

En PowerShell usa `$env:PIXABAY_API_KEY = 'tu-clave'`. `.env.example` enumera las variables. Cambios de proveedor requieren reiniciar el servidor; vuelve a conectar el panel para actualizar capacidades.

En **Recursos visuales** elige **Pixabay: videos (imágenes si no hay clips)** o **Pixabay: solo imágenes**. El primer modo busca clips; si no hay candidatos adecuados, busca fotografías. Los errores de autenticación o cuota no se ocultan con una búsqueda adicional. Se prefieren clips cercanos a 720p y se excluyen variantes mayores de 1920 píxeles por lado para reducir descargas. El render puede reencuadrar el material al formato elegido.

Las búsquedas se guardan 24 horas en `render-data/provider-cache/pixabay`, siguiendo la [documentación de Pixabay](https://pixabay.com/api/docs/). Un recurso ya descargado en un trabajo se reutiliza sin otra descarga, también al reintentar. No se garantiza que una primera consulta sea más rápida que otro proveedor: depende de tu conexión y de Pixabay. La clave no se guarda en la caché ni en los créditos. Se conservan los créditos históricos de Pexels y los trabajos pendientes con su antiguo selector se migran a Pixabay; requieren la nueva clave para buscar recursos nuevos. `PEXELS_API_KEY` ya no se utiliza.

### Habilitar Replicate

Para el selector nuevo solo necesitas `REPLICATE_API_TOKEN`. No hace falta rellenar `REPLICATE_MODEL_VERSION` ni `REPLICATE_INPUT_JSON`: quedan disponibles únicamente para el adaptador visual antiguo. Desde la misma ventana de PowerShell donde arrancarás el backend, introduce el token como contraseña, sin escribirlo en el comando ni compartirlo en el chat:

```powershell
$replicateCredential = Get-Credential -UserName 'Replicate' -Message 'Introduce tu token de Replicate en el campo de contraseña'
$env:REPLICATE_API_TOKEN = $replicateCredential.GetNetworkCredential().Password
Remove-Variable replicateCredential
.\.venv\Scripts\python.exe -m backend
```

Detén primero cualquier instancia anterior. La variable solo existe en ese proceso de PowerShell y sus hijos: si abres otra ventana tendrás que definirla allí. El código local de acceso al panel es distinto del token de Replicate. El navegador recibe un catálogo y esquemas, nunca el token del proveedor.

### Usar Replicate Studio

1. Conecta el motor y pulsa **Abrir Replicate Studio** en la Fábrica de videos.
2. Selecciona **Imagen**, **Video**, **Música** o **Voz / narración**, y después el modelo del menú. Se consultan sus parámetros a Replicate sin iniciar una predicción. Si el modelo se retiró, tu cuenta no tiene acceso o no publica un esquema compatible, se muestra el error y no se genera a ciegas.
3. Completa los campos. El **formato de imagen**, relación de aspecto, resolución, duración, semilla, etc. se muestran solo cuando ese modelo los admite; no hay un formato universal. Los campos de referencia permiten elegir recursos subidos a tu biblioteca o URLs HTTPS. Los arrays/objetos genéricos usan JSON. Los campos secretos no se aceptan.
4. **Copiar prompt / guion** usa la producción actual: prompt de imagen/video de la escena de destino, prompt de miniatura, texto de narración o propuesta de música. Edita el texto y comprueba límites y derechos.
5. Elige uno de estos dos flujos:
   - **Recurso individual**: selecciona biblioteca, escena, miniatura, música o narración; confirma el coste y pulsa **Generar recurso individual**. La cola guarda el resultado en **Mis recursos**, con descarga y uso sin repetir la predicción. La miniatura se descarga para revisión, no se sube automáticamente. Si cambias la producción mientras se genera, el recurso se guarda pero no se asigna automáticamente al proyecto nuevo.
   - **MP4 automático**: pulsa **Usar modelo en MP4** para cada tarea deseada. Puedes combinar un modelo de imagen **o** video para escenas, otro de voz y otro de música. Configurar no genera contenido. La voz usa el guion de cada bloque seleccionado; las imágenes/videos usan su prompt por escena; la música mantiene el prompt que configuraste. Después confirma las generaciones en el formulario principal y pulsa **Generar MP4**. Los campos se validan antes de poner el trabajo en cola. Un modelo sin campo de texto compatible se utiliza como recurso individual.
6. Revisa el resultado y sus créditos antes de publicar. Los modelos de restauración, postproducción y avatar suelen necesitar recursos de referencia adicionales; no son reemplazos directos de un generador texto→imagen/video. No uses voces, rostros o recursos de terceros sin permiso.

El catálogo contiene **96 entradas**, a partir de FrameShift y diez modelos solicitados: **87 habilitadas** (29 imagen/restauración/SVG, 47 video/postproducción/avatar, 5 música, 6 voz). Las otras 9 —3D, LLM y transcripción— permanecen identificadas fuera de este flujo. Cada identificador aparece una sola vez; actualizar un identificador sustituye su registro. No hay sincronización automática con FrameShift. Los parámetros se consultan al seleccionar un modelo y se reutilizan hasta 24 horas. **Recargar parámetros** consulta directamente a Replicate, conserva el prompt y restablece las demás opciones y referencias para revisarlas. Los modelos comunitarios conservan su versión exacta; los modelos marcados como oficiales, incluidos **GPT Image 2 y GPT Image 1.5**, usan el endpoint oficial con la versión o huella del esquema para detectar cambios de formulario, sin prometer fijar la versión interna del proveedor.

**Si aparece HTTP 422:** el servidor indica los nombres de los campos rechazados cuando Replicate los identifica, junto con sus opciones o límites. No muestra tu prompt, claves, URLs privadas ni el cuerpo original de la respuesta. El esquema guardado se invalida; pulsa **Recargar parámetros**, revisa las opciones y referencias y vuelve a generar con los parámetros corregidos. Los valores opcionales cuyo predeterminado es `null` se omiten para que Replicate aplique su valor predeterminado. Un rechazo se conserva como tal: **Reintentar** muestra la explicación y no vuelve a enviar esa predicción. Los trabajos antiguos marcados como inciertos mantienen su protección; no se borran automáticamente.

Para una primera prueba con **GPT Image 2**, escribe un prompt, elige una imagen, calidad `low`, formato `png` y fondo `auto` si esas opciones aparecen en el formulario actual. `User Id` es un identificador opcional del usuario, no el número de imágenes; puedes dejarlo vacío. No necesitas referencias para generar desde texto. El endpoint utilizado corresponde a la [API oficial del modelo](https://replicate.com/openai/gpt-image-2); las demás opciones se validan según el esquema que publique Replicate.

| Modelos añadidos | Tipo |
|---|---|
| `alibaba/wan-3`, `prunaai/p-video-2-pro`, `bytedance/seedance-2.5`, `google/gemini-omni-1.1`, `lightricks/ltx-2.5-fast` | Generación de video |
| `prunaai/p-video-edit` | Edición de un clip existente |
| `openai/gpt-image-2.5-flare`, `openai/gpt-image-2.5-sunburst`, `black-forest-labs/flux-3-image` | Imagen |
| `recraft-ai/recraft-v4-styles-pro-svg` | Imagen vectorial SVG |

Los tres modelos Recraft SVG del catálogo producen un PNG de hasta 2048 píxeles por lado para las escenas. El trabajo individual ofrece **Descargar SVG original**; el proyecto editable conserva los vectores usados. Se rechazan SVG con scripts, recursos externos, HTML o entidades XML. La conversión usa `resvg_py`, con ruedas de instalación para Windows y sin exigir Cairo. Las referencias locales de modelos multimodales admiten hasta 30 recursos por campo y 60 en total, siempre que el esquema específico del modelo también lo permita.

### Comparar rendimiento por dólar

El panel permanece visible fuera de las pestañas: lateral en pantallas grandes y al pie en pantallas pequeñas. Muestra **las dos listas** con desplazamiento propio, sin conectar el motor ni consultar Replicate al cargar la página. Cambia el presupuesto, busca por nombre/autor y filtra generación o edición. Al conectar el motor con Replicate configurado, pulsa un modelo para abrir su formulario. Esto **no genera ni cobra**, ni cambia automáticamente los parámetros al perfil más barato.

Cada modelo se ordena por la configuración **de menor coste verificado** disponible en esta instantánea. Se calcula `imágenes = floor(presupuesto / coste por imagen)` y `segundos = presupuesto / coste por segundo de salida`. Son estimaciones: no equivalen a un video continuo de esa duración, y los clips mínimos y redondeos pueden dejar saldo sin usar. La resolución, calidad, audio, referencias y cantidad de salidas cambian el coste. La edición y ampliación se identifican como tales; no se presentan como creación desde cero. No se comparan imágenes y segundos en la misma clasificación.

Precios consultados el **2026-10-06**, en USD. Se conserva la condición y enlace a la ficha oficial de Replicate en `backend/replicate_catalog.json`. Tarifas por GPU/ejecución sin duración de salida comprobada y precios sin verificar quedan al final con «Por verificar», sin ratios inventados. Los precios no se actualizan en vivo. No se usan precios de otro proveedor, modalidades con clave propia como si fueran gratuitas, ni la tarifa de respaldo de Nano Banana como si fuera Pro.

**Wan 3:** su [tabla](https://replicate.com/alibaba/wan-3) todavía muestra la mitad del precio de su README y el banner limita el descuento al 30 de agosto. Como esa fecha ya pasó, el catálogo usa la tarifa base (480p: US$0,05/s), identifica la discrepancia y pide confirmar el precio vigente antes de generar.

Para mantener las tarifas, edita el registro del modelo, su `pricing.variants` con `usd`, `conditions` y campos `match` cuando estén verificados, `source` y `checked_at`. Marca `unverified` cuando no se pueda comparar. Actualiza `pricing_checked_at`, ejecuta `node scripts/build-replicate-catalog.cjs` y `npm run check`. El archivo público generado solo contiene el catálogo; no contiene claves. Mantén los importes y las condiciones respaldados por las fichas oficiales, sin reutilizar descuentos vencidos.

**Monetización y licencias:** figurar en FrameShift o pagar Replicate no acredita permiso comercial. Se muestra la ficha del modelo para revisar licencia y precios. MusicGen tiene una advertencia específica de pesos **CC-BY-NC 4.0**, según su [ficha oficial](https://replicate.com/meta/musicgen) y la [licencia de pesos](https://github.com/facebookresearch/audiocraft/blob/main/LICENSE_weights); no se recomienda para monetización sin permisos adicionales. Las demás opciones también requieren revisión, no una presunción de licencia comercial. No se copian estimaciones de precios del catálogo antiguo.

Al generar, las referencias locales seleccionadas se **envían a Replicate** con su API de archivos. Solo se usan recursos existentes en tu biblioteca; no se aceptan rutas locales arbitrarias del cliente. Se conserva temporalmente su URL privada en la carpeta del trabajo para recuperarlo. No selecciones archivos confidenciales y no publiques `render-data`. Los resultados admitidos son URLs de recursos en `replicate.delivery` (una URL, lista o campos `image`/`video`/`audio`/`url`); si un modelo devuelve varias, se guarda la primera compatible. No se admiten salidas de texto, archivos 3D ni descargas de hosts desconocidos.

| Variable | Uso |
|---|---|
| `YT_RENDER_DIR` | Carpeta privada de archivos y SQLite; `render-data` por defecto. Conserva la carpeta entera para respaldar trabajos. |
| `YT_RENDER_TOKEN` | Acceso a la API local, mínimo 24 caracteres. Si se omite, se genera uno nuevo al arrancar. |
| `YT_RENDER_ORIGINS` | Orígenes CORS exactos separados por comas. Por defecto localhost y 127.0.0.1 en 8787. |
| `YT_FFMPEG`, `YT_FFPROBE` | Rutas alternativas a los ejecutables. |
| `YT_ENCODER` | `libx264` por defecto; `h264_nvenc` y `h264_videotoolbox` opcionales si tu instalación los soporta. No se presume disponibilidad de hardware. |
| `PIXABAY_API_KEY` | Clave de la [API oficial](https://pixabay.com/api/docs/). Se utilizan hasta cinco candidatos por búsqueda. |
| `REPLICATE_API_TOKEN` | Token de la cuenta que pagará las generaciones. |
| `REPLICATE_MODEL_VERSION` | Solo adaptador visual antiguo: ID exacto de versión, 64 caracteres hexadecimales. El selector no lo necesita. |
| `REPLICATE_INPUT_JSON` | Solo adaptador antiguo: parámetros de ese modelo; se añade/reemplaza `prompt`. El selector envía campos validados por el esquema. |
| `WHISPER_CPP_BINARY`, `WHISPER_CPP_MODEL` | Ejecutable `whisper-cli` y modelo GGML ya instalado. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Bot y chat de destino para trabajos con avisos activados. |

### Recursos y costes

Sube imágenes PNG/JPG/WebP, videos MP4/MOV/WebM y audio WAV/MP3/M4A. El servidor comprueba el recurso con FFprobe. Máximo **200 MB por subida**, **150 MB por descarga**, **17 megapíxeles por imagen/frame**, **20 minutos de narración/recurso** y **20 GB de almacenamiento**. La cola admite diez trabajos activos y procesa uno a la vez. El historial visible contiene los últimos 50 y todos los trabajos activos, aunque sean anteriores; elimina renders terminados desde el panel cuando ya los respaldaste.

Marca imágenes/videos propios para formar un conjunto; se distribuyen entre escenas. También puedes asignar un recurso concreto a cada escena. La asignación tiene prioridad sobre el proveedor automático. Si no marcas un conjunto en modo propio, asigna todas las escenas de los bloques elegidos. Selecciona por separado narración y música; la música se repite, se mezcla a volumen reducido y la salida se normaliza.

Pixabay y Replicate generan/descargan hasta el **límite de recursos visuales nuevos** configurado (1–8). Las escenas posteriores reutilizan recursos disponibles. La voz Replicate añade **una predicción por bloque seleccionado** y la música **una por trabajo**, si las activas. Un recurso individual envía una predicción, pero algunos modelos producen varias salidas o cobran por duración. Estos límites no fijan un presupuesto monetario: los precios y permisos dependen del proveedor/modelo. El manifiesto conserva modelo, versión y predicción para revisar procedencia.

Si se recibió un ID de predicción, un reintento consulta **esa misma predicción**. Si el POST quedó sin confirmación, el trabajo falla y requiere que revises tu cuenta; no repite automáticamente una solicitud de cobro incierta. Una solicitud idéntica de pago reutiliza también el trabajo fallido/cancelado: pulsa **Reintentar** sobre él para consultarlo de nuevo. Una predicción ya fallida o cancelada en Replicate no se sustituye por otra al reintentar. Para volver a generar después de revisar tu cuenta, envía parámetros distintos o elimina el trabajo anterior conscientemente; perder su registro y crear otro puede cobrar otra vez. No se configuran proveedores ni se realizan llamadas de pago durante las pruebas.

### Subtítulos

**Desde voz** usa las marcas de Edge cuando están disponibles. **Estimados** reparte palabras según longitud del texto sobre el audio; no es una transcripción ni sincronización exacta. Con narración propia o voz Replicate, la opción desde voz también es estimada. El manifiesto distingue los orígenes, incluido `estimated-from-replicate-voice`. Whisper.cpp es una alternativa de transcripción sobre el audio ya generado.

Para mayor ajuste con audio propio, instala [Whisper.cpp](https://github.com/ggml-org/whisper.cpp), su modelo multilingüe y configura sus dos variables. Se convierte el audio a 16 kHz, se ejecuta `whisper-cli -l es -ojf -ml 1` y se leen offsets en milisegundos. La alineación por palabra es experimental; revisa los tiempos. Si solo hay segmentos, se indica `estimated-from-whisper-segments`. Actualmente la transcripción se ejecuta en español. Edge permite elegir voces de otros idiomas, pero para su transcripción usa marcas TTS o estimaciones.

Todos los videos incluyen subtítulos quemados; se exportan **SRT**, **ASS** y **words.json**. ASS destaca palabras con karaoke y preserva un margen mayor en vertical.

## Recortes desde la transcripción

En un render original terminado pulsa **Transcripción / recortar**. Selecciona una palabra para fijar el inicio, ajusta el final y envía un recorte de **1–180 segundos**. Puedes cambiar a vertical, horizontal o cuadrado.

El recorte usa el video limpio del render original, reutiliza su audio final y reconstruye los subtítulos con tiempos relativos al recorte. No duplica los subtítulos quemados del video largo. La selección es temporal: no analiza automáticamente el mejor momento, rostros ni silencios. El reencuadre es centrado; comprueba que el contenido importante siga visible. Los metadatos se copian del original para que los edites antes de publicarlo. Un recorte no permite generar recortes adicionales; selecciona siempre el render original.

## Proyecto editable y Remotion

El ZIP incluye narración WAV, música opcional, recursos utilizados, línea de tiempo por frames, subtítulos, créditos, metadatos y `remotion-input.json`. La composición conserva el volumen de música elegido y el punto de inicio de cada recurso de video. Es un paquete de montaje; conserva además el JSON editorial del estudio para recuperar el guion completo y sus fuentes.

El manifiesto distingue los tiempos de subtítulos de los tiempos por bloque. Edge TTS y voz Replicate miden cada bloque al generar su voz; con narración propia, los límites de bloques se estiman según el guion aunque Whisper mida los subtítulos. Los recortes expresan ambos tiempos respecto al inicio del clip.

Desde la raíz:

```bash
npm ci --prefix remotion
```

Extrae el ZIP en **`remotion/public/`**, conservando la carpeta `media/` y `remotion-input.json` en ese nivel. Luego:

```bash
cd remotion
npm run studio -- --props=public/remotion-input.json
npm run render
```

La composición `StudioVideo` adapta duración, FPS y dimensiones a los datos. `src/index.tsx` permite modificar tipografías, animaciones, subtítulos y escenas. Puedes añadir `metrics` a tu JSON para barras animadas con `{ "label": "Etiqueta", "value": 12, "unit": "" }`, usando datos comprobados. No se inventan estadísticas. El diseño usa estilos React locales sin CDN; Tailwind no es necesario para este módulo.

Remotion requiere su navegador de render compatible; su CLI puede descargarlo. **Remotion tiene licencia propia**, no una licencia de uso comercial gratuita universal. Revisa sus [condiciones y precios](https://www.remotion.dev/docs/license/pricing) antes de automatizarlo para una organización. El motor FFmpeg principal funciona sin Remotion. El ZIP comparte recursos y tiempos; sus animaciones y mezcla no son una réplica exacta del MP4 FFmpeg.

## Subida privada a YouTube

Habilita YouTube Data API v3 y configura un OAuth Client ID Web con el origen `http://127.0.0.1:8787` (o tu origen real). Introduce el ID en el campo OAuth del Radar. En la fábrica pulsa **Autorizar subida**, que solicita exclusivamente `youtube.upload`; el permiso de Analytics no sustituye este permiso.

Autorizar no sube ningún video. En el MP4 elegido pulsa **Subir privado a YouTube**. Define si es contenido dirigido a niños y si contiene material sintético realista que requiera divulgación. La [API de videos](https://developers.google.com/youtube/v3/docs/videos#status.containsSyntheticMedia) documenta esos campos. El título y descripción provienen de tu producción; se conserva categoría Educación. Revisa la descripción y los metadatos antes de enviarlos. El comentario fijado se exporta para colocarlo manualmente; no se publica por la API.

El token OAuth permanece en memoria y se entrega al backend solo para esa acción. El servidor guarda la sesión reanudable y, al terminar, el ID confirmado; no guarda el token. Mantén abierta la página durante la subida. Si hay una interrupción, vuelve a autorizar y repite sobre **el mismo trabajo**: se consulta la posición confirmada. Una sesión expirada falla sin iniciar otra automáticamente para evitar duplicados; revisa YouTube Studio. Al confirmar el ID, se elimina la URL de sesión del registro.

Las subidas son siempre **privadas**, sin programación ni publicación automática. Revisa el archivo en Studio antes de hacerlo público. La API no configura miniaturas, anuncios, patrocinio, comentarios ni acuerdos comerciales.

## Cola, seguridad local y recuperación

`backend/store.py` guarda solicitudes inmutables y estados en SQLite. Solicitudes idénticas reutilizan trabajos en cola, en ejecución o terminados con la misma configuración. **Reintentar** conserva el ID, voz por bloque, predicciones, recursos y segmentos terminados. Al reiniciar, los trabajos interrumpidos vuelven a la cola; los cancelados permanecen cancelados. Cancelar detiene procesos locales y pide cancelar predicciones pendientes; una solicitud de red puede tardar hasta su timeout en atenderlo.

Ejecuta **una instancia por directorio**, sin `--reload` ni varios workers Uvicorn. Un bloqueo del sistema impide que dos workers recuperen y procesen la misma cola. El servidor local escucha en 127.0.0.1; CORS y hosts son explícitos, todas las rutas de producción exigen un código y no se sirve el directorio de datos. Las llamadas a FFmpeg usan listas de argumentos sin shell. Descargas remotas admiten solo HTTPS de los proveedores autorizados, con límites y comprobación de red privada.

La aplicación está pensada para un creador. El código compartido es una credencial, no autenticación multiusuario. Para un despliegue personal remoto, consulta [la guía de Render](render-personal.md): el proxy de Render proporciona HTTPS y una sola instancia mantiene la cola y los archivos temporales. Para varias personas necesitas aislamiento de cuentas/archivos. No publiques `render-data/`: contiene guiones, voces, recursos y sesiones de subida pendientes. Con un frontend HTTPS y backend local HTTP, el navegador puede bloquear contenido mixto; servir ambos desde el mismo origen evita esa combinación.

**Eliminar temporales** solicita confirmación y elimina los trabajos terminados/fallidos/cancelados y los recursos del motor conectado mediante sus rutas autenticadas. Se bloquea si hay trabajos activos. Descarga antes los archivos que quieras conservar; la acción no comprueba que hayas guardado una descarga. La limpieza es manual, no se ejecuta al descargar ni al cerrar la página. No modifica tus guiones/perfiles guardados en el navegador ni tus archivos locales. Después de limpiar, otra generación de IA vuelve a consumir créditos.

## Calidad y monetización

El sistema reduce tareas de producción. No garantiza RPM, CTR, retención, aprobación de monetización ni ingresos. Guiones, demostraciones, fuentes, patrocinios y derechos de recursos requieren revisión editorial. Usar stock o IA no convierte por sí solo un video en contenido original y rentable. Las [políticas de monetización de YouTube](https://support.google.com/youtube/answer/1311392?hl=es) exigen contenido original y auténtico y contemplan el contenido repetitivo o producido en masa.

## Verificar

```bash
npm ci
npm run check
npm test
python -m pip install -r backend/requirements-dev.txt
python -m pytest backend/tests -q
npm ci --prefix remotion
npm run check --prefix remotion
npm run bundle --prefix remotion
```

Las pruebas incluyen renders **reales** FFmpeg con audio WAV de prueba, H.264/AAC, SRT/ASS, ZIP editable con música, recursos propios, selección de bloques, recorte vertical y reanudación tras un fallo. Replicate Studio prueba filtros de catálogo, formularios tipados, referencias, opt-in, versiones, recursos de los cuatro tipos, voz por bloque, música y reutilización de predicciones. Los adaptadores online, OAuth, avisos y subida se prueban con respuestas simuladas: no gastan créditos, no suben videos y no envían mensajes. No acreditan disponibilidad, precio, licencia ni calidad de cada modelo real.

Con Chrome/Chromium compatible instalado, ejecuta también `npm run test:production`. Puedes indicar el ejecutable mediante `YT_BROWSER_BIN`. Este check crea recursos originales de prueba, abre la interfaz con `agent-browser`, conecta el motor, carga voz/video/música, genera un MP4, comprueba su vista previa y crea un recorte vertical desde la transcripción. Captura el panel en escritorio y móvil y comprueba errores del navegador. Después renderiza el ZIP con Remotion y verifica dimensiones, duración, audio y presencia de la música elegida.

GitHub Actions ejecuta el flujo completo en los pull requests y en los cambios de `main`. El artefacto `production-verification` conserva capturas, informes y el MP4 de Remotion durante 14 días. El check usa recursos locales; solo necesita acceso a los CDN de estilos de la interfaz. Docker, proveedores reales y encoders de hardware requieren validación en tu equipo.
