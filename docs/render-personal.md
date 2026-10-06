# Render para uso personal desde computadora o tablet

Este despliegue sirve el panel y el motor Python/FFmpeg desde la misma dirección HTTPS. Una sola instancia procesa un trabajo a la vez. No requiere la computadora encendida ni una GPU propia: FFmpeg usa `libx264` y los modelos de Replicate se ejecutan en el proveedor.

No se crea disco permanente, PostgreSQL, Redis ni otro worker. La cola SQLite, las predicciones pendientes, voces y recursos se guardan **temporalmente** en el disco del servicio porque el proceso los necesita para producir y descargar. No significa que los archivos nunca pasen por el servidor. Los perfiles, ideas y producciones editoriales siguen en el navegador de cada dispositivo; usa sus respaldos JSON para trasladarlos. No se añade sincronización de esos datos.

## Elegir capacidad y coste

El `render.yaml` empieza con `plan: free` para abrir y probar el panel sin contratar una instancia de pago. **No es la configuración recomendada para producción de videos.** El plan Free tiene poca CPU/RAM, se suspende después de 15 minutos sin tráfico y puede reiniciarse. Si cierras la tablet, el trabajo no garantiza que llegue a terminar. Los archivos locales se pierden al reiniciar, suspender o redeplegar.

Para generar regularmente, una instancia **1 CPU / 2 GB RAM (`1c-2g`, antes Standard)** cuesta **US$25/mes** según la tarifa consultada el 2026-10-06. La instancia de US$7/mes tiene solo 512 MB de RAM y no se propone como capacidad suficiente para tus renders. Prueba primero un fragmento a 720p y después tu video completo; no se garantiza que 2 GB alcancen para cualquier duración o recurso. Una instancia 2 CPU / 4 GB cuesta US$85/mes si necesitas más capacidad.

Estas cifras son de cómputo; Replicate, consumo de otros proveedores, impuestos y tráfico adicional se cobran aparte. No se necesitan los US$5/mes del disco de 20 GB del ejemplo anterior. Si cambias el plan en Render, actualiza también `plan` en tu Blueprint antes de una futura sincronización para conservar la elección. Mantén el workspace Hobby si sus límites te bastan; no hace falta contratar un workspace Pro para este despliegue.

Fuentes: [precios](https://render.com/pricing), [planes de cómputo](https://render.com/docs/compute-plans), [límites del plan gratuito](https://render.com/docs/free) y [almacenamiento efímero](https://render.com/docs/disks).

## Desplegar después de fusionar este cambio

1. Comprueba que `render.yaml` y `docs/render-personal.md` ya están en la rama `main` de GitHub.
2. En tu cuenta de Render, abre **New → Blueprint** y conecta `alexplus369-coder/YTBResearchV3.0`, rama `main`. También puedes abrir [la configuración del Blueprint](https://dashboard.render.com/blueprint/new?repo=https://github.com/alexplus369-coder/YTBResearchV3.0).
3. Revisa la vista previa: debe crear solo **ytb-research-personal**, un Web Service Docker, una instancia y ningún disco o base de datos. El plan inicial del archivo es Free. Revisa el coste en Render antes de seleccionar una instancia de pago.
4. Aplica el Blueprint y espera a que el despliegue indique **Live**. Render construye el Dockerfile con Python, FFmpeg, FFprobe y las fuentes necesarias. El comando de arranque es `python -m backend` y `/healthz` es el chequeo público de salud, sin claves ni detalles de tus recursos.
5. El Blueprint te pide las claves de Pixabay y Replicate al crearlo. Introduce las que usarás; para un proveedor que no quieras activar, deja el valor vacío. También puedes añadirlas después en **Environment** y guardar/redeplegar **antes de generar**:

   | Variable | Valor |
   | --- | --- |
   | `PIXABAY_API_KEY` | Tu clave de Pixabay para videos e imágenes de stock. |
   | `REPLICATE_API_TOKEN` | Tu token de Replicate para imágenes, videos, música o voz. |
   | `YT_RENDER_TOKEN` | Render lo genera al aplicar el Blueprint. Copia su valor desde Environment; será tu código personal del panel. |
   | `YT_SITE_PRIVATE` | `true` en el Blueprint: exige contraseña para abrir el sitio completo. |
   | `YT_SITE_USER` | `alejandro` por defecto: usuario de la ventana de acceso del navegador. |
   | `YT_RENDER_ORIGINS` | Solo si usas un dominio propio u otro frontend: su origen HTTPS exacto. La dirección `onrender.com` se configura automáticamente. |

   No escribas los valores reales en GitHub ni en el chat. Las claves que configuraste en PowerShell no se transfieren automáticamente a Render. El código del panel es diferente del token de Replicate.

6. Si vas a producir videos, cambia en **Settings → Instance Type** a una instancia de pago con la capacidad que elegiste. Espera a que esté Live. Mantén **una instancia** y **Auto-Deploy: Off**. No ejecutes varios procesos Uvicorn: cada instancia tiene su propia cola y, sin disco compartido, repartiría tus solicitudes entre datos distintos.
7. Abre la dirección HTTPS que Render muestra para el servicio en tu tablet. El navegador solicitará usuario **alejandro** y contraseña **el valor de `YT_RENDER_TOKEN`**. En **Estudio → Fábrica de videos**, la dirección del motor ya será la del sitio. Introduce ese mismo código y pulsa **Conectar**. Debe aparecer `Motor conectado · cola activa · libx264`.
8. Para la primera prueba, importa o prepara una producción, sube tu propia narración y usa **Tarjetas gráficas**. Selecciona solo un bloque breve a 720p. Esto verifica el servidor sin gastar créditos de generación. Comprueba el MP4 antes de producir un video completo. Conecta tus servicios de IA solo cuando quieras usarlos; Replicate mantiene la confirmación explícita de pago.

Render proporciona `PORT` y `RENDER_EXTERNAL_URL` automáticamente. El servidor escucha en `0.0.0.0:PORT`; admite únicamente el origen HTTPS del servicio y los orígenes que configuraste, además de localhost para uso local. Para Docker fuera de Render, el puerto sigue siendo 8787. `python -m backend` no carga `.env` por sí mismo.

Las claves de YouTube y de los proveedores de guiones se introducen en el panel como en tu instalación local; no se trasladan con los respaldos JSON. Si tu clave de Google tiene restricciones de sitio web, añade tu dirección HTTPS de Render a los referentes permitidos. Para Analytics o subida a YouTube, configura también ese origen en el OAuth Client ID Web; consulta [la guía de producción](video-production.md#subida-a-youtube) y [las instrucciones de Google](https://developers.google.com/youtube/v3/getting-started).

## Generar, descargar y eliminar

1. Genera el recurso o el MP4. En una instancia de pago activa, una tarea ya enviada a la cola sigue en el servidor aunque cierres la tablet; un reinicio o redeploy puede interrumpirla.
2. Pulsa **Descargar recurso**, **Descargar MP4**, **Descargar SVG original**, SRT o el proyecto editable que necesites. En la tablet, revisa **Descargas** o la app **Archivos**, según el navegador.
3. Abre el archivo guardado y comprueba que quedó completo. La web puede iniciar la descarga, pero no confirmar que aceptaste guardarla en el dispositivo.
4. Pulsa **Eliminar temporales** y confirma. Se eliminan todos los trabajos terminados/fallidos/cancelados y los recursos del **motor conectado**, aunque excedan los últimos 50 trabajos/100 recursos visibles. El botón se bloquea mientras haya tareas activas. Esta limpieza no borra tus descargas ni la producción editorial del navegador y no se ejecuta automáticamente al descargar.

Con `YT_SITE_PRIVATE=true`, el HTML, catálogo, scripts y documentación también exigen tu usuario y código mediante la ventana de acceso del navegador (HTTP Basic sobre HTTPS). La API de producción sigue exigiendo su código explícito, incluso si ya abriste el sitio: el panel lo envía en `X-YT-Render-Token`, independiente de la cabecera de acceso del navegador. Los clientes existentes pueden seguir usando Bearer. No se añade registro de cuentas ni permisos multiusuario. `/healthz` queda público para los chequeos de Render y solo devuelve el estado mínimo del servicio. Para cerrar el acceso en un dispositivo, cierra sus ventanas o pestañas privadas; algunos navegadores conservan la sesión HTTP Basic. Cambia `YT_RENDER_TOKEN` y redepliega sin trabajos activos si necesitas revocar el código anterior.

Sin disco permanente, **un reinicio, suspensión o redeploy puede borrar trabajos y recursos que todavía no descargaste**. La recuperación de la cola funciona mientras sus archivos existan; no sobrevive a la pérdida del disco efímero. No redepliegues durante una generación o subida. Los créditos ya consumidos no se devuelven por perder un trabajo, y volver a generarlo puede volver a cobrarse. Las actualizaciones automáticas se deshabilitan para reducir interrupciones, pero Render aún puede reiniciar el servicio. Si más adelante necesitas reanudar predicciones tras reinicios, haría falta persistir al menos sus registros.

## Validar el despliegue

Abre `https://TU-SERVICIO.onrender.com/healthz`: debe responder `{"status":"ok"}`. Comprueba que el panel rechaza un código incorrecto y acepta el tuyo, que un MP4 breve se reproduce y descarga, y que **Eliminar temporales** vacía la cola y los recursos después de guardar tu copia. Una prueba local o de CI no acredita el rendimiento de tu plan contratado ni la disponibilidad de un modelo de pago real.

Para validar el Blueprint con Render CLI instalado y autenticado, ejecuta `render blueprints validate render.yaml`. Su instalación y uso están en la [documentación de Render CLI](https://render.com/docs/cli). La vista previa de New → Blueprint también valida el archivo antes de aplicar los recursos.
