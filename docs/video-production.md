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
4. Usa **Tarjetas gráficas** para una primera prueba, recursos propios, Pexels o Replicate. Las tarjetas son composiciones originales simples con texto; revisa su presentación antes de publicar.
5. Usa Edge TTS o sube tu narración. Con audio propio, el texto del guion debe corresponder a lo que se escucha.
6. Pulsa **Generar MP4**. La cola continúa mientras usas el estudio. Al terminar, revisa el video y descarga MP4, SRT o proyecto editable.

La duración se calcula a partir del audio, no del presupuesto del guion. Una producción escrita para nueve minutos puede durar más o menos con tu voz. El resultado muestra la duración real y si alcanza ocho minutos; esto no confirma elegibilidad ni inserta anuncios.

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
| Pexels | Búsqueda oficial de videos de stock y créditos con autor, enlace y licencia por recurso. |
| Replicate | Adaptador configurable para modelos que devuelven una URL de imagen/video. Generación de pago activada por el usuario y limitada a un máximo de recursos distintos por trabajo. |
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
export PEXELS_API_KEY='tu-clave'
export YT_RENDER_TOKEN='un-codigo-propio-largo-de-al-menos-24-caracteres'
python -m backend
```

En PowerShell usa `$env:PEXELS_API_KEY = 'tu-clave'`. `.env.example` enumera las variables. Cambios de proveedor requieren reiniciar el servidor; vuelve a conectar el panel para actualizar capacidades.

| Variable | Uso |
|---|---|
| `YT_RENDER_DIR` | Carpeta privada de archivos y SQLite; `render-data` por defecto. Conserva la carpeta entera para respaldar trabajos. |
| `YT_RENDER_TOKEN` | Acceso a la API local, mínimo 24 caracteres. Si se omite, se genera uno nuevo al arrancar. |
| `YT_RENDER_ORIGINS` | Orígenes CORS exactos separados por comas. Por defecto localhost y 127.0.0.1 en 8787. |
| `YT_FFMPEG`, `YT_FFPROBE` | Rutas alternativas a los ejecutables. |
| `YT_ENCODER` | `libx264` por defecto; `h264_nvenc` y `h264_videotoolbox` opcionales si tu instalación los soporta. No se presume disponibilidad de hardware. |
| `PEXELS_API_KEY` | Clave de la [API oficial](https://www.pexels.com/api/documentation/). Se utilizan hasta cinco candidatos por búsqueda. |
| `REPLICATE_API_TOKEN` | Token de la cuenta que pagará las generaciones. |
| `REPLICATE_MODEL_VERSION` | ID exacto de versión del modelo, 64 caracteres hexadecimales. |
| `REPLICATE_INPUT_JSON` | Objeto de parámetros específicos del modelo; el servidor añade/reemplaza `prompt`. |
| `WHISPER_CPP_BINARY`, `WHISPER_CPP_MODEL` | Ejecutable `whisper-cli` y modelo GGML ya instalado. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Bot y chat de destino para trabajos con avisos activados. |

### Recursos y costes

Sube imágenes PNG/JPG/WebP, videos MP4/MOV/WebM y audio WAV/MP3/M4A. El servidor comprueba el recurso con FFprobe. Máximo **200 MB por subida**, **150 MB por descarga**, **17 megapíxeles por imagen/frame**, **20 minutos de narración/recurso** y **20 GB de almacenamiento**. La cola admite diez trabajos activos y procesa uno a la vez. El historial visible contiene los últimos 50; elimina renders terminados desde el panel cuando ya los respaldaste.

Marca imágenes/videos propios para formar un conjunto; se distribuyen entre escenas. También puedes asignar un recurso concreto a cada escena. La asignación tiene prioridad sobre el proveedor automático. Si no marcas un conjunto en modo propio, asigna todas las escenas de los bloques elegidos. Selecciona por separado narración y música; la música se repite, se mezcla a volumen reducido y la salida se normaliza.

Pexels y Replicate generan/descargan hasta el **límite de recursos nuevos** configurado (1–8). Las escenas posteriores reutilizan recursos disponibles. Esto limita las solicitudes, no fija un presupuesto monetario: los precios y permisos dependen del proveedor/modelo. El adaptador Replicate acepta modelos por versión cuyo input incluya `prompt` y cuya salida sea una URL o lista de URLs; no sirve para todo modelo alojado sin ajustar su contrato. Devuelve créditos y versión para revisión.

Si se recibió un ID de predicción, un reintento consulta **esa misma predicción**. Si el POST quedó sin confirmación, el trabajo falla y requiere que revises tu cuenta; no repite automáticamente una solicitud de cobro incierta. Crear otro trabajo nuevo sí puede generar un cobro adicional. No se configuran proveedores ni se realizan llamadas de pago durante las pruebas.

### Subtítulos

**Desde voz** usa las marcas de Edge cuando están disponibles. **Estimados** reparte palabras según longitud del texto sobre el audio; no es una transcripción ni sincronización exacta. Con narración propia, la opción desde voz también es estimada. El manifiesto distingue los orígenes, incluido un bloque de TTS sin marcas.

Para mayor ajuste con audio propio, instala [Whisper.cpp](https://github.com/ggml-org/whisper.cpp), su modelo multilingüe y configura sus dos variables. Se convierte el audio a 16 kHz, se ejecuta `whisper-cli -l es -ojf -ml 1` y se leen offsets en milisegundos. La alineación por palabra es experimental; revisa los tiempos. Si solo hay segmentos, se indica `estimated-from-whisper-segments`. Actualmente la transcripción se ejecuta en español. Edge permite elegir voces de otros idiomas, pero para su transcripción usa marcas TTS o estimaciones.

Todos los videos incluyen subtítulos quemados; se exportan **SRT**, **ASS** y **words.json**. ASS destaca palabras con karaoke y preserva un margen mayor en vertical.

## Recortes desde la transcripción

En un render original terminado pulsa **Transcripción / recortar**. Selecciona una palabra para fijar el inicio, ajusta el final y envía un recorte de **1–180 segundos**. Puedes cambiar a vertical, horizontal o cuadrado.

El recorte usa el video limpio del render original, reutiliza su audio final y reconstruye los subtítulos con tiempos relativos al recorte. No duplica los subtítulos quemados del video largo. La selección es temporal: no analiza automáticamente el mejor momento, rostros ni silencios. El reencuadre es centrado; comprueba que el contenido importante siga visible. Los metadatos se copian del original para que los edites antes de publicarlo. Un recorte no permite generar recortes adicionales; selecciona siempre el render original.

## Proyecto editable y Remotion

El ZIP incluye narración WAV, recursos utilizados, línea de tiempo por frames, subtítulos, créditos, metadatos y `remotion-input.json`. Es un paquete de montaje; conserva además el JSON editorial del estudio para recuperar el guion completo y sus fuentes. La música opcional se mezcla en el MP4 pero no se incluye en la composición Remotion.

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

La aplicación está pensada para un creador con acceso local. El código compartido es una credencial, no autenticación multiusuario. Para alojarla remotamente necesitas HTTPS, un proxy y aislamiento de cuentas/archivos. No publiques `render-data/`: contiene guiones, voces, recursos y sesiones de subida pendientes. Con un frontend HTTPS y backend local HTTP, el navegador puede bloquear contenido mixto; abrir la interfaz desde el servidor local evita esa combinación.

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

Las pruebas incluyen renders **reales** FFmpeg con audio WAV de prueba, H.264/AAC, SRT/ASS, ZIP editable, recursos propios, selección de bloques, recorte vertical y reanudación tras un fallo. Los adaptadores online, OAuth, avisos y subida se prueban con respuestas simuladas: no gastan créditos, no suben videos y no envían mensajes. Remotion se valida con TypeScript y su bundle; un render de Remotion y el diseño de la web necesitan verificación en un navegador compatible. Docker y los encoders de hardware requieren validación en tu equipo.
