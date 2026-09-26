# YT SEO Pro Suite — Enterprise

Suite de investigación de YouTube 100% cliente (un solo `index.html`): semántica, análisis de competencia, Vision AI, content gaps y el nuevo **Radar de Temas & Canales**.

## Cómo usarla

1. Abre `index.html` en el navegador (o sírvelo con cualquier servidor estático, p. ej. `python -m http.server`).
2. En **Configuración APIs**, introduce:
   - **YouTube API Key** (Google Cloud → habilitar "YouTube Data API v3").
   - **Gemini API Key** (AI Studio) y, opcionalmente, **DeepSeek** como respaldo.
   - Tu canal (`@handle` o ID) para las funciones de Content Gaps.
3. Usa la barra principal ("Analizar Nicho") o la nueva sección **Radar de Temas & Canales**.

## Radar de Temas & Canales (nueva sección)

Busca por cuatro tipos de entrada y descubre qué canales y videos dominan cada mercado:

| Tipo | Comportamiento |
|------|----------------|
| 📚 **Tema** | Exploración amplia del tema (25 resultados, orden por relevancia). |
| 🎯 **Nicho** | Foco en canales especializados y consistencia temática. |
| 🔑 **Keyword** | Keyword concreta, ordenada por vistas totales. |
| 🪝 **Long-Tail** | La IA genera 3 variantes específicas de baja competencia y las busca junto a tu frase (con respaldo heurístico si la IA falla). |

### Qué muestra

- **Resumen**: canales detectados, videos analizados, canales "en alza" y vistas/día promedio.
- **Canales con mayor señal de crecimiento**: score de canal 0–100, tendencia (🚀 alza / ↔️ estable / 📉 caída), subs, engagement promedio, conversión de abonados (subs por 1K vistas) e ingreso mensual estimado.
- **Videos mejor puntuados**: tabla ordenable (score, vistas/día, engagement, ingreso estimado, recencia) con enlace directo a cada video.
- **Detalle de canal**: al pulsar un canal se lista —con enlaces— cada video que menciona el tema buscado (búsqueda temática dentro del canal, con etiqueta "✔ TEMA").
- **Desarrollo del Tema con IA**: genera un documento de principio a fin integrando la información de los videos (transcripciones cuando están disponibles + títulos, descripciones y etiquetas), con fuentes enlazadas y botón de copiar. Disponible para todo el radar o solo para un canal.

### Score de crecimiento (0–100)

| Componente | Puntos | Señal pública usada |
|------------|--------|---------------------|
| Vistas al alza | 25 | Percentil de vistas/día dentro del pool de resultados |
| Tiempo de visualización | 15 | Vistas × duración (escala logarítmica) |
| Interacción | 25 | (Likes + comentarios) / vistas |
| Señal de clics (proxy CTR) | 15 | Likes / vistas |
| Retención estimada | 10 | Franja de duración con mejor rendimiento típico |
| Frescura | 10 | Antigüedad del video |

### Nota importante sobre métricas privadas

Impresiones, CTR real, % de retención exacto, RPM, ingresos reales, retornos de espectadores y demografía son **datos privados de YouTube Analytics** (solo el dueño de cada canal puede verlos mediante la YouTube Analytics API). Esta sección los aproxima con **señales públicas**: velocidad de vistas, watch time estimado, engagement, conversión de abonados y una estimación de ingresos configurable (RPM en "Opciones avanzadas").

### Transcripciones

YouTube bloquea CORS, así que las transcripciones se descargan a través de un proxy configurable en **Opciones avanzadas** (por defecto `https://api.allorigins.win/raw?url={url}`). Puedes poner tu propio proxy; solo se aceptan hosts públicos http(s) (se rechazan localhost, IPs privadas y rangos reservados). Si no hay proxy disponible, la IA trabaja con títulos, descripciones y etiquetas.

## Resto de módulos

- **Resumen SEO**: métricas del nicho, dificultad multivariable, etiquetas y clusters semánticos, duración óptima y mejor horario.
- **Competencia**: tabla del Top 15 con subs, vistas, engagement, duración y VPH.
- **AI Studio**: coach estratégico, títulos, ideas y conceptos de miniatura.
- **Auditoría**: optimizador SEO en vivo (score 0–100), checklist y transculturización a ES/ES-LATAM/EN.
- **Vision AI**: análisis de miniaturas (CTR potencial) y auditoría semántica de guiones.
- **Content Gaps**: cruce de tu canal con un competidor para detectar temas hiper-rentables.

## Privacidad

Las claves se introducen en el navegador y solo se envían a las APIs correspondientes (Google, Gemini, DeepSeek). No hay backend ni almacenamiento remoto; las preferencias (RPM, proxy) se guardan en `localStorage`.
