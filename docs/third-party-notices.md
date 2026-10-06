# Referencias y componentes

Esta ampliación contiene una implementación propia de producción por escenas. No incorpora código fuente, pesos de modelos ni recursos multimedia de los repositorios sugeridos. Los paquetes se instalan con sus gestores y mantienen sus licencias originales.

- **MoneyPrinterTurbo**, Harry, MIT: [repositorio y licencia](https://github.com/harry0703/MoneyPrinterTurbo/blob/main/LICENSE). Referencia del flujo tema/guion → voz → recursos → video; no se copia su código.
- **ShortGPT**: [repositorio](https://github.com/RayVentura/ShortGPT). Referencia de edición por escenas y subtítulos; no se ejecuta ni se incluye.
- **FFmpeg**: [licencias por compilación](https://ffmpeg.org/legal.html). Dependencia ejecutable externa; libx264 puede hacer que una distribución esté sujeta a GPL. Conserva los avisos/licencias de tu build, incluida la del paquete del sistema usado por Docker.
- **FastAPI**, **Starlette**, **Uvicorn**, **Pydantic**, **HTTPX**, **jsonschema**, **python-multipart**, **edge-tts** y **Pillow**: dependencias declaradas en `backend/requirements.txt`; sus distribuciones incluyen sus propios avisos. [edge-tts](https://github.com/rany2/edge-tts) utiliza un servicio online externo; la licencia del cliente no sustituye las condiciones del servicio.
- **Whisper.cpp**: [repositorio](https://github.com/ggml-org/whisper.cpp), instalado por el creador. No se distribuyen binario ni modelos.
- **React** y **Remotion**: dependencias opcionales del subproyecto `remotion/`. Remotion usa [condiciones propias](https://www.remotion.dev/docs/license/pricing); no se presupone gratuidad para todas las organizaciones.
- **Pixabay**, **Replicate**, **Google/YouTube** y **Telegram**: APIs externas. Las licencias de imágenes, clips, música, modelos y contenido generado se revisan por separado. Los manifiestos conservan la procedencia disponible.
- **FrameShift**, del mismo propietario de este repositorio: se importa únicamente una lista de identificadores, etiquetas y categorías desde `frontend/src/App.jsx` del [commit 1255f06](https://github.com/alexplus369-coder/frameshift/blob/1255f06f55b41940d5430b7e65f83490f8187499/frontend/src/App.jsx). No se incluye su aplicación ni su backend. El catálogo conserva esa procedencia en `backend/replicate_catalog.json`.
- **Meta MusicGen**: el [modelo en Replicate](https://replicate.com/meta/musicgen) declara pesos [CC-BY-NC 4.0](https://github.com/facebookresearch/audiocraft/blob/main/LICENSE_weights). La opción se conserva para experimentación con una advertencia; no se presenta como autorización para monetizar música. Pagar una predicción no sustituye los permisos comerciales necesarios.

La lista distingue referencias arquitectónicas de integraciones activas. No se afirma afiliación ni respaldo por parte de estos proyectos o proveedores.
