(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ResearchCore = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
    'use strict';

    const DAY = 86400000;
    const BOARD_LIMIT = 100;
    const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
    const STATUSES = { idea: 'Idea', script: 'Guion', production: 'Producción', published: 'Publicado' };
    const ANALYTICS_SCOPES = [
        'https://www.googleapis.com/auth/youtube.readonly',
        'https://www.googleapis.com/auth/yt-analytics.readonly',
        'https://www.googleapis.com/auth/yt-analytics-monetary.readonly'
    ].join(' ');
    const clone = value => JSON.parse(JSON.stringify(value));
    const number = (value, fallback = 0) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : fallback;
    const rpm = value => value !== '' && value != null ? number(value, 3.5) : 3.5;

    function youtubeUrl(resource, params, key) {
        const url = new URL('https://www.googleapis.com/youtube/v3/' + resource);
        Object.entries(params).forEach(([name, value]) => {
            if (value !== '' && value != null) url.searchParams.set(name, String(value));
        });
        url.searchParams.set('key', key);
        return url.href;
    }

    // Only public, read-only Data API calls enter this in-memory cache.
    function createYouTubeClient({ fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 15000, onStats = () => {} } = {}) {
        const cache = new Map();
        const pending = new Map();
        const stats = { searchCalls: 0, otherCalls: 0, cacheHits: 0, sharedRequests: 0, failedCalls: 0 };
        const notify = () => onStats({ ...stats });

        async function fetchJson(input, { force = false } = {}) {
            const url = new URL(input);
            const resource = url.pathname.split('/').pop();
            if (url.origin !== 'https://www.googleapis.com' || url.username || url.password ||
                !/^\/youtube\/v3\/(search|videos|channels|commentThreads|playlistItems|i18nRegions)$/.test(url.pathname)) {
                throw new Error('Endpoint de YouTube no permitido.');
            }
            const key = url.searchParams.get('key');
            if (!key) throw new Error('Introduce tu YouTube API Key.');
            url.searchParams.sort();
            const cacheKey = url.href; // credentials live in memory only; never persisted or exported
            const cached = cache.get(cacheKey);
            if (!force && cached && cached.expires > now()) {
                stats.cacheHits++;
                notify();
                return clone(cached.data);
            }
            if (pending.has(cacheKey)) {
                stats.sharedRequests++;
                notify();
                return clone(await pending.get(cacheKey));
            }
            const task = (async () => {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), timeoutMs);
                stats[resource === 'search' ? 'searchCalls' : 'otherCalls']++;
                notify();
                try {
                    const response = await fetchImpl(url.href, { signal: controller.signal });
                    const data = await response.json();
                    if (!response.ok || data.error) {
                        const reason = data.error?.errors?.[0]?.reason;
                        const messages = {
                            quotaExceeded: 'Se agotó la cuota de YouTube del proyecto. Revisa Google Cloud o vuelve después del reinicio diario.',
                            dailyLimitExceeded: 'Se alcanzó el límite diario de YouTube del proyecto.',
                            keyInvalid: 'YouTube API Key inválida. Revisa Configuración APIs.',
                            accessNotConfigured: 'Habilita YouTube Data API v3 en tu proyecto de Google Cloud.',
                            commentsDisabled: 'Este video tiene los comentarios desactivados.'
                        };
                        throw new Error(messages[reason] || data.error?.message || `YouTube respondió HTTP ${response.status}.`);
                    }
                    const ttl = resource === 'search' ? 15 * 60000 : 5 * 60000;
                    cache.delete(cacheKey);
                    cache.set(cacheKey, { data: clone(data), expires: now() + ttl });
                    while (cache.size > 120) cache.delete(cache.keys().next().value);
                    return data;
                } catch (error) {
                    stats.failedCalls++;
                    notify();
                    const message = error.name === 'AbortError'
                        ? 'YouTube tardó demasiado. Vuelve a intentar la consulta.'
                        : error.message || 'No se pudo conectar con YouTube.';
                    throw new Error(message.split(key).join('[clave]'));
                } finally {
                    clearTimeout(timer);
                }
            })();
            pending.set(cacheKey, task);
            try { return clone(await task); }
            finally { pending.delete(cacheKey); }
        }
        return { fetchJson, clearCache: () => cache.clear(), getStats: () => ({ ...stats }) };
    }

    function searchParams(topic, config, filters = {}, timestamp = Date.now()) {
        const params = { part: 'id', type: 'video', q: topic, maxResults: config.max, order: config.order };
        if (['relevance', 'date', 'viewCount'].includes(filters.order)) params.order = filters.order;
        if (/^[A-Z]{2}$/.test(filters.region || '')) params.regionCode = filters.region;
        if (/^[a-z]{2}$/.test(filters.language || '')) params.relevanceLanguage = filters.language;
        if (['short', 'medium', 'long'].includes(filters.duration)) params.videoDuration = filters.duration;
        if ([7, 30, 90, 365].includes(Number(filters.days))) {
            // Stable within a UTC day so a repeated search can actually hit the cache.
            params.publishedAfter = new Date(Math.floor(timestamp / DAY) * DAY - Number(filters.days) * DAY).toISOString();
        }
        return params;
    }

    function filterSignals(signals, { minViews = 0, maxSubs = '' } = {}) {
        const ceiling = maxSubs === '' || maxSubs == null ? null : number(maxSubs);
        return signals.filter(s => s.views >= number(minViews) &&
            (ceiling == null || (s.subsKnown && s.subs <= ceiling)));
    }

    function sortedSignals(signals, key) {
        const field = { opportunity: 'opportunity', vpd: 'vpd', eng: 'eng', revenue: 'estRevenue' }[key] || 'score';
        return [...signals].sort((a, b) => key === 'recent'
            ? new Date(b.video.snippet.publishedAt) - new Date(a.video.snippet.publishedAt)
            : b[field] - a[field]);
    }

    function cleanSnapshots(snapshots, timestamp) {
        if (!Array.isArray(snapshots)) return [];
        return snapshots.filter(s => s && Number.isFinite(s.t) && Number.isFinite(s.v) && s.v >= 0 &&
            s.t <= timestamp && timestamp - s.t < 180 * DAY).sort((a, b) => a.t - b.t)
            .filter((s, i, all) => !i || s.t !== all[i - 1].t).slice(-8).map(s => ({ t: s.t, v: s.v }));
    }

    function recordCohorts(store, videos, timestamp = Date.now()) {
        const result = Object.create(null);
        if (store && typeof store === 'object') Object.entries(store).forEach(([id, snapshots]) => {
            if (!VIDEO_ID.test(id)) return;
            const cleaned = cleanSnapshots(snapshots, timestamp);
            if (cleaned.length) result[id] = cleaned;
        });
        videos.forEach(video => {
            if (!VIDEO_ID.test(video.id) || video.statistics?.viewCount == null) return;
            const views = Number(video.statistics.viewCount);
            if (!Number.isFinite(views) || views < 0) return;
            const snapshots = result[video.id] || [];
            const last = snapshots.at(-1);
            // Keep each timestamp paired with its original reading, including cached re-searches.
            if (!last || timestamp - last.t >= 12 * 3600000) snapshots.push({ t: timestamp, v: views });
            result[video.id] = snapshots.slice(-8);
        });
        return result;
    }

    function analyzeCohort(videoId, store, timestamp = Date.now()) {
        const snaps = cleanSnapshots(store?.[videoId], timestamp);
        if (snaps.length < 2) return null;
        const last = snaps.at(-1);
        const first = snaps.find(s => last.t - s.t >= 3 * DAY);
        if (!first) return null;
        const days = (last.t - first.t) / DAY;
        const perDay = (last.v - first.v) / days;
        const intervals = [];
        for (let i = 1; i < snaps.length; i++) {
            const elapsed = (snaps[i].t - snaps[i - 1].t) / DAY;
            if (elapsed >= 3) intervals.push((snaps[i].v - snaps[i - 1].v) / elapsed);
        }
        let verdict = null;
        if (perDay < 0 || intervals.some(v => v < 0)) {
            verdict = { label: 'Corrección de vistas', emoji: '⚠️', cls: 'bg-amber-100 text-amber-700' };
        } else if (intervals.length >= 2 && intervals[0] > 0) {
            const ratio = intervals.at(-1) / intervals[0];
            verdict = ratio > 1.15
                ? { label: 'Acelerando', emoji: '🚀', cls: 'bg-emerald-100 text-emerald-700' }
                : ratio >= 0.85
                    ? { label: 'Sostenido', emoji: '🧊', cls: 'bg-blue-100 text-blue-700' }
                    : { label: 'Enfriando', emoji: '📉', cls: 'bg-red-100 text-red-700' };
        }
        return { firstTs: first.t, lastTs: last.t, firstViews: first.v, lastViews: last.v, days, perDay, verdict };
    }

    function csvCell(value) {
        let text = String(value ?? '');
        // Quoting alone does not stop Excel from executing formula-like titles or notes.
        if (/^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
        return '"' + text.replace(/"/g, '""') + '"';
    }

    const cleanText = (value, max) => String(value ?? '').replace(/\u0000/g, '').slice(0, max);
    function normalizeEntry(entry) {
        if (!entry || !VIDEO_ID.test(entry.id) || typeof entry.title !== 'string' || !entry.title.trim()) {
            throw new Error('El respaldo contiene una referencia de video inválida.');
        }
        const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(entry.dueDate || '') &&
            Number.isFinite(Date.parse(entry.dueDate)) && new Date(entry.dueDate).toISOString().slice(0, 10) === entry.dueDate
            ? entry.dueDate : '';
        const timestamp = number(entry.capturedAt, Date.now());
        const capturedAt = Number.isFinite(new Date(timestamp).getTime()) ? timestamp : Date.now();
        return {
            id: entry.id, title: cleanText(entry.title, 300), channel: cleanText(entry.channel, 200),
            topic: cleanText(entry.topic, 200), notes: cleanText(entry.notes, 2000), dueDate,
            status: Object.hasOwn(STATUSES, entry.status) ? entry.status : 'idea',
            views: number(entry.views), vpd: number(entry.vpd), durationSec: number(entry.durationSec),
            score: Math.min(100, number(entry.score)), opportunity: Math.min(100, number(entry.opportunity)),
            capturedAt
        };
    }

    function entryFromSignal(signal, topic, timestamp = Date.now()) {
        return normalizeEntry({ ...signal, id: signal.video.id, title: signal.video.snippet.title,
            channel: signal.video.snippet.channelTitle, topic, capturedAt: timestamp });
    }

    function mergeBoard(current, incoming) {
        const entries = new Map();
        // Existing editorial work wins when importing a backup with the same video.
        [...current, ...incoming].forEach(raw => {
            const entry = normalizeEntry(raw);
            if (!entries.has(entry.id)) entries.set(entry.id, entry);
        });
        if (entries.size > BOARD_LIMIT) throw new Error(`El tablero admite hasta ${BOARD_LIMIT} referencias. Exporta y elimina algunas antes de añadir más.`);
        return [...entries.values()];
    }

    function exportBoard(entries) {
        return JSON.stringify({ format: 'yt-research-board', version: 1, entries: mergeBoard(entries, []) }, null, 2);
    }

    function importBoard(text) {
        if (typeof text !== 'string' || text.length > 1024 * 1024) throw new Error('El respaldo debe ser un JSON de hasta 1 MB.');
        let data;
        try { data = JSON.parse(text); } catch { throw new Error('El archivo no contiene JSON válido.'); }
        if (data?.format !== 'yt-research-board' || data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > BOARD_LIMIT) {
            throw new Error('Selecciona un respaldo exportado por el tablero (versión 1).');
        }
        return mergeBoard([], data.entries);
    }

    function briefMarkdown(raw) {
        const entry = normalizeEntry(raw);
        const text = value => String(value).replace(/[<>]/g, '').replace(/[\r\n]/g, ' ').trim();
        const topic = text(entry.topic || entry.title);
        return [
            `## ${text(entry.title)}`, '',
            `- Tema objetivo: ${topic}`,
            `- Estado: ${STATUSES[entry.status]}`,
            `- Fecha prevista: ${entry.dueDate || 'Por definir'}`,
            `- Referencia: https://www.youtube.com/watch?v=${entry.id}`,
            `- Canal: ${text(entry.channel)}`,
            `- Lectura guardada: ${new Date(entry.capturedAt).toISOString()}`,
            `- Vistas: ${entry.views.toLocaleString('es-MX')} · Vistas/día desde publicación: ${Math.round(entry.vpd)} · Duración: ${entry.durationSec}s`,
            `- Score heurístico: ${entry.score}/100 · Oportunidad relativa: ${entry.opportunity}/100`, '',
            '### Ángulo propio y notas', '', entry.notes ? text(entry.notes) : 'Definir qué problema resolver y qué ejemplo propio aportar.', '',
            '### Borradores de título (revisar antes de publicar)', '',
            `- ${topic}: guía práctica paso a paso`,
            `- Errores frecuentes al empezar con ${topic}`,
            `- Cómo aplicar ${topic} con un ejemplo real`, '',
            '### Esquema de producción', '',
            '1. Mostrar el problema y el resultado que se obtendrá.',
            '2. Explicar requisitos, herramientas y límites.',
            '3. Desarrollar un ejemplo propio paso a paso.',
            '4. Verificar el resultado y explicar errores frecuentes.',
            '5. Cerrar con una acción concreta para la audiencia.', '',
            '### Antes de publicar', '',
            '- [ ] Verificar fuentes y afirmaciones; revisar la referencia completa.',
            '- [ ] Preparar material propio, guion, miniatura y descripción.',
            '- [ ] Comparar dos títulos y revisar que la promesa se cumpla.',
            '- [ ] Añadir capítulos y enlaces a las fuentes.', '',
            'Las métricas guardadas son una lectura histórica. El score no mide CTR, retención, ingresos ni crecimiento actual. Este brief es una plantilla editable sin IA.', ''
        ].join('\n');
    }

    return { BOARD_LIMIT, STATUSES, ANALYTICS_SCOPES, createYouTubeClient, youtubeUrl, searchParams,
        filterSignals, sortedSignals, recordCohorts, analyzeCohort, csvCell, rpm,
        entryFromSignal, normalizeEntry, mergeBoard, exportBoard, importBoard, briefMarkdown };
});
