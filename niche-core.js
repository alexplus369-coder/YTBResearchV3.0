/* Public sample comparisons and explicit financial scenarios. No inferred competitor revenue. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.NicheCore = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
    'use strict';
    const DAY = 86400000, MAX_AGE = 30 * DAY;
    const text = (v, max = 300) => typeof v === 'string' ? v.trim().slice(0, max) : '';
    const number = (v, fallback, max = 1e9) => v !== '' && v != null && Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.min(max, Number(v)) : fallback;
    const normalize = v => text(v, 2000).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const median = a => { const sorted = a.filter(Number.isFinite).sort((x, y) => x - y); return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2 : null; };
    const catalog = [
        ['finance', 'Finanzas personales', 'finanzas personales ahorro presupuesto', 'personal finance budgeting', 'finanças pessoais orçamento', 'finanzas ahorro presupuesto', 'Plantillas de presupuesto y herramientas; verificar condiciones.'],
        ['investing', 'Inversión y educación financiera', 'educacion financiera inversiones', 'investing financial education', 'educação financeira investimentos', 'inversion finanzas bolsa', 'Formación y herramientas de análisis; verificar riesgos y afirmaciones.'],
        ['property', 'Bienes raíces', 'bienes raices inmobiliaria', 'real estate property', 'mercado imobiliário', 'inmuebles inmobiliaria vivienda', 'Servicios, contactos comerciales y formación.'],
        ['saas', 'Software y SaaS', 'software saas herramientas negocios', 'saas software business tools', 'software saas ferramentas negócios', 'software saas aplicaciones negocios', 'Afiliación de software, plantillas y consultoría.'],
        ['ai', 'IA aplicada y automatización', 'inteligencia artificial automatizacion tutorial', 'ai automation tutorials', 'inteligência artificial automação tutorial', 'ia inteligencia artificial automatizacion comfyui', 'Herramientas, flujos de trabajo y servicios de automatización.'],
        ['security', 'Ciberseguridad', 'ciberseguridad privacidad tutorial', 'cybersecurity privacy tutorial', 'cibersegurança privacidade tutorial', 'ciberseguridad privacidad redes', 'Formación técnica, herramientas y servicios.'],
        ['coding', 'Programación y desarrollo web', 'programacion desarrollo web tutorial', 'programming web development tutorial', 'programação desenvolvimento web tutorial', 'programacion python javascript react desarrollo', 'Cursos, plantillas, alojamiento y herramientas.'],
        ['marketing', 'Marketing digital y SEO', 'marketing digital seo tutorial', 'digital marketing seo tutorial', 'marketing digital seo tutorial', 'marketing seo youtube publicidad', 'Herramientas, formación y servicios profesionales.'],
        ['business', 'Negocios y emprendimiento', 'negocios emprendimiento pequeñas empresas', 'small business entrepreneurship', 'negócios empreendedorismo pequenas empresas', 'negocios emprendimiento empresas b2b', 'Formación, software de gestión y consultoría.'],
        ['career', 'Carrera y empleo', 'empleo carrera profesional habilidades', 'career jobs professional skills', 'carreira emprego habilidades', 'empleo carrera habilidades entrevistas', 'Formación, preparación de entrevistas y servicios.'],
        ['productivity', 'Productividad y organización', 'productividad organizacion herramientas', 'productivity organization tools', 'produtividade organização ferramentas', 'productividad organizacion herramientas', 'Plantillas, herramientas y formación práctica.'],
        ['technical', 'Educación técnica', 'educacion tecnica ingenieria tutorial', 'technical education engineering tutorial', 'educação técnica engenharia tutorial', 'educacion tecnica ingenieria excel', 'Cursos, guías, recursos descargables y servicios.'],
        ['archviz', '3D, CGI y visualización arquitectónica', '3d archviz unreal engine arquitectura tutorial', '3d archviz unreal engine architecture tutorial', '3d archviz unreal engine arquitetura tutorial', '3d cgi archviz arquitectura arquitectos unreal corona blender vfx', 'Assets, formación, licencias de software y servicios de visualización.'],
        ['gadgets', 'Tecnología y equipos', 'tecnologia equipos computadoras comparativa', 'technology computer equipment reviews', 'tecnologia computadores equipamentos análise', 'tecnologia hardware gpu computadoras equipos', 'Afiliación de equipos y colaboraciones; verificar ofertas.'],
        ['home', 'Hogar y bricolaje', 'hogar bricolaje reparaciones tutorial', 'home improvement diy tutorials', 'casa faça você mesmo reparos', 'hogar bricolaje reparaciones diy', 'Herramientas, materiales, guías y servicios.'],
        ['cars', 'Automóviles y mantenimiento', 'automoviles mantenimiento comparativa', 'cars maintenance reviews', 'automóveis manutenção análise', 'automoviles autos mantenimiento coches', 'Accesorios, herramientas y servicios relacionados.'],
        ['fitness', 'Fitness y hábitos', 'fitness entrenamiento habitos', 'fitness training habits', 'fitness treino hábitos', 'fitness entrenamiento ejercicio habitos', 'Equipamiento y formación; verificar evidencia y seguridad.'],
        ['travel', 'Viajes y experiencias', 'viajes destinos presupuesto', 'travel destinations budget', 'viagens destinos orçamento', 'viajes turismo destinos', 'Reservas, experiencias y guías; revisar condiciones.'],
        ['cooking', 'Cocina y recetas', 'cocina recetas tutorial', 'cooking recipes tutorial', 'cozinha receitas tutorial', 'cocina recetas alimentos', 'Utensilios, recetarios y formación.'],
        ['gaming', 'Videojuegos y guías', 'videojuegos guias tutorial', 'gaming guides tutorial', 'videogames guias tutorial', 'videojuegos gaming juegos', 'Equipos, accesorios y recursos propios.']
    ].map(([id, label, es, en, pt, tags, offers]) => Object.freeze({ id, label, queries: Object.freeze({ es, en, pt }), tags, offers }));
    const CATALOG = Object.freeze(catalog), IDS = new Set(catalog.map(n => n.id));
    function filters(input = {}) {
        return { region: /^[A-Z]{2}$/.test(input.region || '') ? input.region : 'MX',
            language: ['es', 'en', 'pt'].includes(input.language) ? input.language : 'es',
            days: [7, 30, 90].includes(Number(input.days)) ? Number(input.days) : 30,
            duration: ['short', 'medium', 'long'].includes(input.duration) ? input.duration : 'medium' };
    }
    function settings(input = {}) {
        const overrides = {};
        for (const id of IDS) {
            const row = input.overrides?.[id];
            if (row && typeof row === 'object') {
                const rpm = number(row.rpm, null, 500), cost = number(row.cost, null, 100000);
                if (rpm != null || cost != null) overrides[id] = { rpm, cost };
            }
        }
        return { rpm: number(input.rpm, 3.5, 500), cost: number(input.cost, 0, 100000), views: Math.round(number(input.views, 10000, 10000000)),
            smallChannel: Math.round(number(input.smallChannel, 100000, 10000000)), interests: text(input.interests, 400),
            affinity: input.affinity === true, order: ['opportunity', 'margin', 'demand'].includes(input.order) ? input.order : 'opportunity', overrides };
    }
    function duration(value) {
        const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(text(value, 80));
        return match ? Number(match[1] || 0) * 86400 + Number(match[2] || 0) * 3600 + Number(match[3] || 0) * 60 + Number(match[4] || 0) : 0;
    }
    function sample(videos, channelMap, input, timestamp = Date.now()) {
        const config = filters(input), earliest = Math.floor(timestamp / DAY) * DAY - config.days * DAY, used = new Set();
        return (Array.isArray(videos) ? videos : []).flatMap(v => {
            const id = v?.id, published = Date.parse(v?.snippet?.publishedAt), views = number(v?.statistics?.viewCount, null);
            const seconds = duration(v?.contentDetails?.duration), age = (timestamp - published) / DAY;
            if (!/^[\w-]{11}$/.test(id || '') || used.has(id) || !Number.isFinite(published) || published < earliest || age < 1 ||
                views == null || seconds <= 0 || (v.snippet.liveBroadcastContent && v.snippet.liveBroadcastContent !== 'none')) return [];
            if ((config.duration === 'short' && seconds >= 240) || (config.duration === 'medium' && (seconds < 240 || seconds > 1200)) ||
                (config.duration === 'long' && seconds <= 1200)) return [];
            const channelId = /^[\w-]{24}$/.test(v.snippet.channelId || '') ? v.snippet.channelId : '';
            const channel = channelMap?.[channelId], subscribers = channel?.statistics?.hiddenSubscriberCount === false ? number(channel.statistics.subscriberCount, null) : null;
            used.add(id);
            return [{ id, title: text(v.snippet.title, 300), channel: text(v.snippet.channelTitle, 160), channelId,
                publishedAt: new Date(published).toISOString(), capturedAt: new Date(timestamp).toISOString(), views, durationSec: seconds, subscribers }];
        }).slice(0, 20);
    }
    function cleanVideo(v, timestamp) {
        if (!/^[\w-]{11}$/.test(v?.id || '') || !Number.isFinite(Date.parse(v.publishedAt)) || !Number.isFinite(Date.parse(v.capturedAt)) ||
            Date.parse(v.capturedAt) > timestamp + 60000 || timestamp - Date.parse(v.capturedAt) > MAX_AGE ||
            Date.parse(v.capturedAt) - Date.parse(v.publishedAt) < DAY || number(v.views, null) == null || number(v.durationSec, 0) <= 0) throw new Error('Referencia del ranking inválida.');
        return { id: v.id, title: text(v.title, 300), channel: text(v.channel, 160), channelId: /^[\w-]{24}$/.test(v.channelId || '') ? v.channelId : '',
            publishedAt: new Date(v.publishedAt).toISOString(), capturedAt: new Date(v.capturedAt).toISOString(), views: number(v.views, 0),
            durationSec: number(v.durationSec, 0, 864000), subscribers: number(v.subscribers, null), url: 'https://www.youtube.com/watch?v=' + v.id };
    }
    function snapshot(data, timestamp = Date.now()) {
        if (data?.format !== 'yt-niche-radar' || data.version !== 1 || !Number.isFinite(Date.parse(data.updatedAt)) || Date.parse(data.updatedAt) > timestamp + 60000 ||
            timestamp - Date.parse(data.updatedAt) > MAX_AGE || !Array.isArray(data.rows) || data.rows.length > CATALOG.length) throw new Error('El ranking guardado expiró o es incompatible.');
        const ids = new Set();
        const rows = data.rows.map(row => {
            if (!IDS.has(row?.id) || ids.has(row.id) || !Array.isArray(row.videos) || row.videos.length > 20) throw new Error('Muestra de nicho inválida.');
            ids.add(row.id); const videoIds = new Set();
            const videos = row.videos.map(v => { const clean = cleanVideo(v, timestamp); if (videoIds.has(clean.id)) throw new Error('Referencia duplicada.'); videoIds.add(clean.id); return clean; });
            return { id: row.id, videos, error: row.error ? 'Consulta incompleta; vuelve a actualizar este nicho.' : '' };
        });
        return { format: 'yt-niche-radar', version: 1, updatedAt: new Date(data.updatedAt).toISOString(), filters: filters(data.filters), complete: data.complete === true && rows.length === CATALOG.length && rows.every(r => !r.error), rows };
    }
    function history(input, timestamp = Date.now()) {
        const out = {};
        if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
        for (const [id, raw] of Object.entries(input).slice(-1200)) {
            if (!/^[\w-]{11}$/.test(id) || !Array.isArray(raw)) continue;
            const snaps = raw.filter(s => s && Number.isFinite(s.t) && Number.isFinite(s.v) && s.v >= 0 && s.t <= timestamp && timestamp - s.t <= MAX_AGE)
                .sort((a, b) => a.t - b.t).filter((s, i, a) => !i || s.t !== a[i - 1].t).slice(-8).map(s => ({ t: s.t, v: s.v }));
            if (snaps.length) out[id] = snaps;
        }
        return out;
    }
    function recordHistory(previous, rows, timestamp = Date.now()) {
        const out = history(previous, timestamp);
        for (const row of rows) for (const v of row.videos || []) {
            const snaps = out[v.id] || [], t = Date.parse(v.capturedAt);
            if (!/^[\w-]{11}$/.test(v.id) || !Number.isFinite(t) || t > timestamp || number(v.views, null) == null) continue;
            if (!snaps.length || t - snaps.at(-1).t >= DAY) snaps.push({ t, v: Number(v.views) });
            out[v.id] = snaps.slice(-8);
        }
        return history(out, timestamp);
    }
    function growth(id, observations) {
        const snaps = observations[id] || [], intervals = [];
        if (snaps.some((s, i) => i && s.v < snaps[i - 1].v)) return { label: 'Corrección de vistas', ratio: null, correction: true };
        let anchor = snaps[0];
        for (const next of snaps.slice(1)) if (next.t - anchor.t >= 3 * DAY) {
            intervals.push((next.v - anchor.v) / ((next.t - anchor.t) / DAY)); anchor = next;
        }
        if (intervals.length < 2 || intervals[0] <= 0) return null;
        return { ratio: intervals.at(-1) / intervals[0], correction: false };
    }
    function affinity(niche, interests) {
        const tokens = [...new Set(normalize(interests).match(/[a-z0-9]{2,}/g) || [])].filter(t => !['de', 'del', 'en', 'para', 'con', 'los', 'las', 'una', 'por', 'the', 'and'].includes(t));
        const tags = normalize(niche.tags).split(/\s+/);
        return tokens.length ? Math.round(100 * tokens.filter(t => tags.includes(t)).length / tokens.length) : 0;
    }
    function rank(data, input = {}, observations = {}, timestamp = Date.now()) {
        const saved = snapshot(data, timestamp), config = settings(input), hist = history(observations, timestamp);
        const rows = saved.rows.filter(r => !r.error && r.videos.length).map(row => {
            const niche = CATALOG.find(n => n.id === row.id), videos = row.videos;
            const channels = new Set(videos.map(v => v.channelId).filter(Boolean)).size;
            const known = videos.filter(v => v.subscribers != null), small = known.filter(v => v.subscribers <= config.smallChannel && v.views >= 1000);
            const currentGrowth = videos.map(v => growth(v.id, hist));
            const correction = currentGrowth.some(g => g?.correction), measured = currentGrowth.filter(g => g?.ratio != null);
            const ratio = median(measured.map(g => g.ratio));
            const own = config.overrides[row.id], rpm = own?.rpm ?? config.rpm, cost = own?.cost ?? config.cost;
            const adRevenue = config.views / 1000 * rpm;
            const counts = new Map(); for (const v of videos) if (v.channelId) counts.set(v.channelId, (counts.get(v.channelId) || 0) + 1);
            const dominance = counts.size ? Math.max(...counts.values()) / videos.length : 1;
            return { ...niche, videos, sampleCount: videos.length, channelCount: channels,
                medianVpd: median(videos.map(v => v.views / ((Date.parse(v.capturedAt) - Date.parse(v.publishedAt)) / DAY))),
                access: known.length ? small.length / known.length : null, knownCount: known.length, smallCount: small.length,
                growthRatio: correction ? null : ratio, growthCount: measured.length,
                growthLabel: correction ? 'Corrección de vistas; no indica tendencia' : ratio == null ? 'Sin historial suficiente' : ratio > 1.15 ? 'Acelerando' : ratio < .85 ? 'Enfriando' : 'Sostenido',
                confidence: videos.length >= 12 && channels >= 4 && dominance <= .5 ? 'Amplia' : videos.length >= 6 && channels >= 2 && dominance <= .75 ? 'Limitada' : 'Escasa',
                rpm, cost, adRevenue, margin: adRevenue - cost, financialSource: own?.rpm != null ? 'Supuesto por nicho' : 'Supuesto general', affinity: affinity(niche, config.interests) };
        });
        const percentile = (value, values) => values.length < 2 || values.every(v => v === values[0]) ? 50 : 100 * (values.filter(v => v < value).length + (values.filter(v => v === value).length - 1) / 2) / (values.length - 1);
        for (const row of rows) {
            // Compare the displayed precision: a few milliseconds between identical cached samples must not break ties.
            row.demandScore = percentile(Math.round(row.medianVpd), rows.map(r => Math.round(r.medianVpd)));
            row.marginScore = percentile(row.margin, rows.map(r => r.margin));
            row.accessScore = row.access == null ? 50 : row.access * 100;
            row.score = Math.round((config.affinity ? .4 : .5) * row.demandScore + .2 * row.accessScore + .3 * row.marginScore + (config.affinity ? .1 * row.affinity : 0));
        }
        const field = { opportunity: 'score', margin: 'margin', demand: 'medianVpd' }[config.order];
        rows.sort((a, b) => b[field] - a[field] || b.medianVpd - a.medianVpd || a.id.localeCompare(b.id));
        return { rows, top: rows.slice(0, 10), settings: config, snapshot: saved };
    }
    function creatorSelection(row) {
        return { niche: row.label, topic: row.label,
            angle: 'Demostración original para esta audiencia. Muestra pública: ' + row.sampleCount + ' videos de ' + row.channelCount + ' canales; las vistas no verifican ingresos ni afirmaciones. Posibles ofertas a validar: ' + row.offers,
            sources: [...row.videos].sort((a, b) => b.views - a.views).slice(0, 6).map(v => ({ id: v.id, title: v.title, channel: v.channel, url: 'https://www.youtube.com/watch?v=' + v.id,
                views: v.views, viewsPerDay: Math.round(v.views / ((Date.parse(v.capturedAt) - Date.parse(v.publishedAt)) / DAY)), publishedAt: v.publishedAt,
                capturedAt: v.capturedAt, transcript: false, description: '' })) };
    }
    return { CATALOG, DAY, MAX_AGE, filters, settings, duration, sample, snapshot, history, recordHistory, rank, creatorSelection };
});
