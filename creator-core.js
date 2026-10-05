/* Pure creator tools. Public signals are evidence about a sample, never private analytics. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.CreatorCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const DAY = 86400000;
    const text = (value, max = 1000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
    const number = (value, fallback, min = 0, max = 1e9) => value !== '' && value != null && Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
    const words = value => text(value, 40000).split(/\s+/u).filter(Boolean).length;
    const shortTitle = value => Array.from(text(value, 300)).slice(0, 49).join('').trim();
    const median = values => { const a = values.filter(Number.isFinite).sort((a, b) => a - b); return a.length ? (a[Math.floor((a.length - 1) / 2)] + a[Math.ceil((a.length - 1) / 2)]) / 2 : null; };
    const hash = value => { let h = 2166136261; for (const c of String(value)) h = Math.imul(h ^ c.codePointAt(0), 16777619); return (h >>> 0).toString(36); };
    const normalize = value => text(value, 40000).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const STOP = new Set(('a al algo antes aqui asi como con cual cuando de del desde donde el ella en entre era es esta este esto for from ha hasta hay how la las lo los mas me mi muy no o of on para pero por que se sin sobre su sus te the to tu un una uno unos video videos y ya your youtube tutorial paso pasos').split(' '));
    const ANGLES = [
        { format: 'Demostración', angle: 'Resuelve una tarea real de principio a fin con una prueba propia y un criterio para comprobar el resultado.' },
        { format: 'Errores frecuentes', angle: 'Contrasta tres decisiones equivocadas con sus alternativas; demuestra la corrección con un ejemplo original.' },
        { format: 'Comparativa', angle: 'Compara dos métodos usando la misma tarea, presupuesto y criterios. Explica para quién sirve cada uno.' },
        { format: 'Experimento', angle: 'Diseña una prueba reproducible con hipótesis, procedimiento y medición. Publica solo los resultados que verifiques.' },
        { format: 'Guía práctica', angle: 'Convierte el problema en una lista de decisiones y una plantilla aplicable a la audiencia.' }
    ];
    function profile(input = {}) {
        const p = {};
        for (const [key, max] of Object.entries({ niche: 160, audience: 400, goal: 400, tone: 100, visualStyle: 400, channelContext: 400,
            sponsor: 200, affiliate: 200, lead: 200, sponsorFacts: 600, ownFacts: 6000 })) p[key] = text(input[key], max);
        for (const key of ['affiliateUrl', 'leadUrl']) {
            p[key] = '';
            try { const u = new URL(text(input[key], 1000)); if (['http:', 'https:'].includes(u.protocol)) p[key] = u.href; } catch {}
        }
        p.duration = Math.round(number(input.duration, 9, 8, 10));
        p.rpm = number(input.rpm, 3.5, 0, 500);
        p.rpmSource = input.rpmSource === 'analytics' ? 'analytics' : 'manual';
        p.ctrTarget = number(input.ctrTarget, 8, 1, 30);
        p.avpTarget = number(input.avpTarget, 45, 1, 100);
        p.timeZone = text(input.timeZone, 60) || 'America/Mexico_City';
        try { new Intl.DateTimeFormat('en', { timeZone: p.timeZone }); } catch { p.timeZone = 'America/Mexico_City'; }
        p.tone ||= 'Claro, práctico y cercano';
        p.visualStyle ||= 'Demostraciones originales, gráficos limpios y b-roll realista';
        return p;
    }
    function dayKey(date = new Date(), timeZone = 'America/Mexico_City') {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
        const get = type => parts.find(p => p.type === type).value;
        return get('year') + '-' + get('month') + '-' + get('day');
    }
    function fingerprint(p, signals = [], date = new Date()) {
        return hash(JSON.stringify([dayKey(date, p.timeZone), p, signals.map(s => [s.video.id, s.views, s.video.snippet.publishedAt]).sort((a, b) => a[0].localeCompare(b[0]))]));
    }
    function rpmGuidance(niche) {
        const value = normalize(niche);
        if (/finanz|inversion|inmueble|bienes raices|saas|software|b2b|negocio|marketing|educacion tecnica|productividad/.test(value)) return { category: 'Intención comercial a validar', referenceRange: 'USD 10–50+', note: 'Rango orientativo aportado en la metodología; no es un RPM observado. Validar con Analytics propio, país, audiencia y periodo.' };
        if (/meme|reaccion|entretenimiento|stream/.test(value)) return { category: 'Entretenimiento general', referenceRange: 'USD 0.50–3', note: 'Rango orientativo aportado en la metodología; no es un RPM observado. El análisis original y la afinidad comercial pueden cambiar la hipótesis.' };
        return { category: 'RPM sin validar', referenceRange: null, note: 'No hay datos financieros de este nicho. Usa un supuesto explícito y calibra con el historial de tu canal cuando esté disponible.' };
    }
    function source(signal, timestamp = Date.now()) {
        const v = signal.video;
        return { id: text(v.id, 11), title: text(v.snippet?.title, 300), channel: text(v.snippet?.channelTitle, 160),
            url: 'https://www.youtube.com/watch?v=' + encodeURIComponent(v.id), views: number(signal.views, 0),
            viewsPerDay: Math.round(number(signal.vpd, 0) * 100) / 100, publishedAt: text(v.snippet?.publishedAt, 40),
            capturedAt: new Date(timestamp).toISOString(), description: text(v.snippet?.description, 1600) };
    }
    function highlights(signals, baseline = [], timestamp = Date.now()) {
        const pool = [...new Map([...baseline, ...signals].map(s => [s.video.id, s])).values()];
        const eligible = s => s.durationSec > 0 && s.days >= 2 && s.days <= 365 && s.views > 0;
        return signals.filter(eligible).map(s => {
            const peers = pool.filter(other => eligible(other) && other.video.id !== s.video.id && other.video.snippet.channelId === s.video.snippet.channelId && (other.durationSec < 240) === (s.durationSec < 240));
            const base = peers.length >= 3 ? median(peers.map(s => s.vpd)) : null;
            const ratio = base > 0 ? s.vpd / base : null;
            return { id: s.video.id, source: source(s, timestamp), ratio, peerCount: peers.length, baselineVpd: base,
                atypical: ratio !== null && ratio >= 2, score: number(s.opportunity, 0),
                angle: ANGLES[parseInt(hash(s.video.id), 36) % ANGLES.length].angle };
        }).sort((a, b) => Number(b.atypical) - Number(a.atypical) || (b.ratio ?? 0) - (a.ratio ?? 0) || b.score - a.score).slice(0, 9);
    }
    function keywordSignals(signals, suggestions = [], cohort = () => null) {
        const candidates = new Map();
        const add = (term, suggestion = false) => {
            const key = normalize(term);
            if (key.length < 3 || key.length > 100 || STOP.has(key)) return;
            const existing = candidates.get(key) || { term: text(term, 100), suggestion: false };
            existing.suggestion ||= suggestion;
            candidates.set(key, existing);
        };
        for (const s of signals) {
            const tokens = normalize(s.video.snippet.title).split(' ');
            for (let i = 0; i < tokens.length; i++) {
                if (tokens[i].length >= 3 && !STOP.has(tokens[i])) add(tokens[i]);
                if (i + 1 < tokens.length && tokens[i].length >= 3 && tokens[i + 1].length >= 3 && !STOP.has(tokens[i]) && !STOP.has(tokens[i + 1])) add(tokens[i] + ' ' + tokens[i + 1]);
            }
            for (const tag of (s.video.snippet.tags || []).slice(0, 30)) add(tag);
        }
        suggestions.slice(0, 30).forEach(term => add(term, true));
        const rows = [...candidates.entries()].map(([key, value]) => {
            const matching = signals.filter(s => (' ' + normalize(s.video.snippet.title) + ' ').includes(' ' + key + ' ') || (s.video.snippet.tags || []).some(tag => (' ' + normalize(tag) + ' ').includes(' ' + key + ' ')));
            const measurements = matching.map(s => cohort(s.video.id)).filter(m => m && m.perDay >= 0);
            const accelerating = measurements.filter(m => m.verdict?.label === 'Acelerando').length;
            return { ...value, mentions: matching.length, recent: matching.filter(s => s.days <= 30).length,
                medianVpd: median(matching.map(s => s.vpd)) || 0, measuredVideos: measurements.length,
                observedVpd: measurements.length ? Math.round(measurements.reduce((sum, m) => sum + m.perDay, 0)) : null,
                accelerating, sourceIds: matching.slice(0, 6).map(s => s.video.id) };
        });
        const maxSpeed = Math.max(1, ...rows.map(r => r.medianVpd));
        return rows.map(r => ({ ...r, score: Math.round(30 * r.mentions / Math.max(1, signals.length) + 25 * r.recent / Math.max(1, r.mentions) + 25 * Math.log1p(r.medianVpd) / Math.log1p(maxSpeed) + (r.suggestion ? 10 : 0) + (r.accelerating ? 10 : 0)) }))
            .sort((a, b) => b.score - a.score || b.mentions - a.mentions || a.term.localeCompare(b.term)).slice(0, 15);
    }
    function dailyIdeas(p, keywords, references, date = new Date()) {
        if (!p.niche) throw new Error('Define tu nicho para personalizar las ideas.');
        const day = dayKey(date, p.timeZone);
        const offset = parseInt(hash(day + JSON.stringify(p)), 36);
        const topics = keywords.filter(k => k.mentions > 0).slice(0, 10);
        return Array.from({ length: 5 }, (_, i) => {
            const format = ANGLES[(offset + i) % ANGLES.length];
            const keyword = topics.length ? topics[(offset + i) % topics.length] : null;
            const topic = keyword?.term || p.niche;
            const ref = references.length ? references[(offset + i) % references.length] : null;
            const titles = [topic + ': prueba paso a paso', 'Evita estos errores en ' + topic, topic + ': qué método elegir', 'Pusimos a prueba ' + topic, 'Tu primera guía de ' + topic];
            return { id: hash(day + JSON.stringify(p) + i + topic), title: shortTitle(titles[(offset + i) % titles.length]), topic,
                format: format.format, angle: format.angle, audience: p.audience || 'Audiencia interesada en ' + p.niche,
                why: keyword ? keyword.mentions + ' referencias de la muestra mencionan este tema; adaptación para ' + (p.audience || p.niche) + '.' : 'Propuesta editorial basada en tu perfil; sin evidencia de demanda observada.',
                monetization: p.affiliate ? 'Demostración de ' + p.affiliate + ' con divulgación de afiliación.' : p.lead ? 'Recurso propio: ' + p.lead : 'Validar una herramienta o recurso útil antes de añadir una oferta.',
                sourceIds: keyword?.sourceIds || (ref ? [ref.id] : []), day, mode: 'editorial' };
        });
    }
    function validateIdeas(data, p, references, date = new Date()) {
        if (!Array.isArray(data?.ideas) || data.ideas.length !== 5) throw new Error('La IA debe devolver cinco ideas completas.');
        const allowed = new Set(references.map(r => r.id));
        return data.ideas.map((idea, i) => {
            for (const key of ['title', 'topic', 'angle', 'why', 'format']) if (!text(idea[key])) throw new Error('Idea incompleta: falta ' + key + '.');
            if (Array.from(idea.title).length >= 50) throw new Error('Cada título debe tener menos de 50 caracteres.');
            return { id: hash(fingerprint(p, [], date) + i), title: shortTitle(idea.title), topic: text(idea.topic, 200), angle: text(idea.angle, 1600),
                why: text(idea.why, 1200), format: text(idea.format, 100), audience: p.audience, monetization: text(idea.monetization, 600),
                sourceIds: [...new Set((Array.isArray(idea.sourceIds) ? idea.sourceIds : []).filter(id => allowed.has(id)))], day: dayKey(date, p.timeZone), mode: 'ai' };
        });
    }
    function timeline(minutes = 9) {
        const end = Math.round(number(minutes, 9, 8, 10)) * 60;
        const cuts = [0, 30, Math.round(end * .3), Math.round(end * .55), Math.round(end * .55) + 15, Math.round(end * .8), end];
        const labels = ['Gancho y promesa', 'Victoria rápida', 'Núcleo e integración comercial', 'Transición natural', 'Revelación y demostración', 'Recurso propio y cierre invisible'];
        return labels.map((label, index) => ({ index, label, start: cuts[index], end: cuts[index + 1], targetWords: Math.round((cuts[index + 1] - cuts[index]) * 145 / 60) }));
    }
    function validatePackaging(data) {
        if (!Array.isArray(data?.variants) || data.variants.length !== 3) throw new Error('Se necesitan tres propuestas de título y miniatura.');
        return data.variants.map(v => {
            if (!text(v.title) || Array.from(v.title).length >= 50) throw new Error('Cada título debe tener menos de 50 caracteres.');
            if (!text(v.promise) || !text(v.thumbnail?.prompt) || !text(v.thumbnail?.concept) || !Array.isArray(v.thumbnail?.elements) || !v.thumbnail.elements.length || v.thumbnail.elements.length > 3) throw new Error('Miniatura incompleta o con más de tres elementos.');
            if (normalize(v.thumbnail.text) === normalize(v.title)) throw new Error('El texto de la miniatura debe complementar el título.');
            return { title: shortTitle(v.title), promise: text(v.promise, 800), hypothesis: text(v.hypothesis, 800), thumbnail: {
                text: text(v.thumbnail.text, 80), concept: text(v.thumbnail.concept, 800), elements: v.thumbnail.elements.map(e => text(e, 180)),
                prompt: text(v.thumbnail.prompt, 3000) } };
        });
    }
    function wordBudget(slot) {
        return { targetWords: slot.targetWords, minWords: Math.floor(slot.targetWords * .68), maxWords: Math.ceil(slot.targetWords * 1.35) };
    }
    function validateBlocks(data, expected, allowedSourceIds) {
        if (!Array.isArray(data?.blocks) || data.blocks.length !== expected.length) throw new Error('La IA no devolvió todos los bloques de este tramo.');
        return expected.map(slot => {
            const b = data.blocks.find(b => b?.index === slot.index);
            if (!b || !text(b.narration, 40000) || !text(b.editing) || !Array.isArray(b.scenes) || !b.scenes.length || b.scenes.length > 8) throw new Error('Guion incompleto en el bloque ' + (slot.index + 1) + '.');
            const count = words(b.narration);
            const { minWords: min, maxWords: max } = wordBudget(slot);
            if (count < min || count > max) {
                const error = new Error('Bloque ' + (slot.index + 1) + ': ' + count + ' palabras; ajusta a ' + min + '–' + max + ' para su duración.');
                error.code = 'BLOCK_WORD_COUNT';
                throw error;
            }
            if (slot.index === 0 && (!text(b.hook) || !text(b.rehook) || words(b.hook) > 17)) throw new Error('Falta un gancho de hasta cinco segundos o el re-hook.');
            if (slot.index === 0 && (!normalize(b.narration).startsWith(normalize(b.hook)) || !normalize(b.narration).includes(normalize(b.rehook)) || /^(hola\b|bienvenid|buenos dias|buenas tardes)/.test(normalize(b.hook)))) throw new Error('La locución debe empezar con el gancho y contener el re-hook, sin saludo.');
            if (slot.index === 5 && /\b(eso (es|fue) todo|gracias por ver|nos vemos en|suscribete)\b/.test(normalize(b.narration))) throw new Error('El cierre debe enlazar al siguiente tema sin despedida ni petición de suscripción.');
            if ([0, 1, 2].includes(slot.index) && !text(b.openLoop)) throw new Error('Falta el puente de curiosidad en el bloque ' + (slot.index + 1) + '.');
            const scenes = b.scenes.map((s, i) => {
                for (const key of ['visual', 'imagePrompt', 'videoPrompt']) if (!text(s[key])) throw new Error('Falta ' + key + ' en una escena.');
                return { start: slot.start + Math.floor((slot.end - slot.start) * i / b.scenes.length),
                    end: slot.start + Math.floor((slot.end - slot.start) * (i + 1) / b.scenes.length), visual: text(s.visual, 1600),
                    imagePrompt: text(s.imagePrompt, 3000), videoPrompt: text(s.videoPrompt, 3000), stockQuery: text(s.stockQuery, 120), negativePrompt: text(s.negativePrompt, 1000) || 'No watermarks, no logos, no distorted anatomy, no unreadable text, no fabricated charts.' };
            });
            return { ...slot, narration: text(b.narration, 40000), wordCount: count, hook: text(b.hook, 600), rehook: text(b.rehook, 1500),
                openLoop: text(b.openLoop, 1500), editing: text(b.editing, 2200), scenes,
                sourceIds: [...new Set((Array.isArray(b.sourceIds) ? b.sourceIds : []).filter(id => allowedSourceIds.includes(id)))] };
        });
    }
    function editingCues(blocks) {
        const cues = [];
        for (const b of blocks) for (let second = b.start; second < b.end; second += b.index === 0 ? 3 : 5) {
            const scene = b.scenes.find(s => s.start <= second && s.end > second);
            cues.push({ second, duration: Math.min(b.end - second, b.index === 0 ? 3 : 5),
                action: ['Cambio de plano / b-roll', 'Gráfico o texto clave', 'Zoom suave 10–15%', 'Demostración o pantalla dividida'][cues.length % 4], visual: scene?.visual || b.label });
        }
        return cues;
    }
    function validateProject(data) {
        if (data?.format !== 'yt-creator-production' || data.version !== 1) throw new Error('Formato de producción incompatible.');
        const p = profile(data.profile);
        if (!p.niche || !text(data.topic) || !Array.isArray(data.sources) || data.sources.length > 8) throw new Error('Producción incompleta.');
        const sources = data.sources.map(s => {
            if (!/^[\w-]{11}$/.test(s.id) || !Number.isFinite(Date.parse(s.capturedAt))) throw new Error('Fuente inválida.');
            return { id: s.id, title: text(s.title, 300), channel: text(s.channel, 160), url: 'https://www.youtube.com/watch?v=' + s.id,
                views: number(s.views, 0), viewsPerDay: number(s.viewsPerDay, 0), publishedAt: text(s.publishedAt, 40),
                capturedAt: new Date(s.capturedAt).toISOString(), transcript: s.transcript === true, description: text(s.description, 1600) };
        });
        const variants = validatePackaging({ variants: data.variants });
        const selected = Math.floor(number(data.selected, 0, 0, 2));
        const blocks = validateBlocks({ blocks: data.blocks }, timeline(p.duration), sources.map(s => s.id));
        for (const key of ['monetization', 'checks']) if (!Array.isArray(data[key]) || !data[key].length || data[key].length > 30) throw new Error('Falta el plan de ' + key + '.');
        if (!text(data.description) || !text(data.pinnedComment) || !Number.isFinite(Date.parse(data.createdAt))) throw new Error('Falta la preparación de publicación.');
        return { format: 'yt-creator-production', version: 1, createdAt: new Date(data.createdAt).toISOString(),
            profile: p, topic: text(data.topic, 200), angle: text(data.angle, 1800), sources, variants, selected, packaging: variants[selected], blocks,
            monetization: data.monetization.map(s => text(s, 1600)), checks: data.checks.map(s => text(s, 1600)),
            description: text(data.description, 5000), pinnedComment: text(data.pinnedComment, 1500) };
    }
    function revenueScenario(input = {}) {
        const views = number(input.views, 10000);
        const ads = views / 1000 * number(input.rpm, 3.5, 0, 500);
        const affiliate = views * number(input.affiliateCtr, 0, 0, 100) / 100 * number(input.affiliateConversion, 0, 0, 100) / 100 * number(input.commission, 0);
        const product = views * number(input.leadRate, 0, 0, 100) / 100 * number(input.saleRate, 0, 0, 100) / 100 * number(input.productNet, 0);
        const sponsor = number(input.sponsorFee, 0);
        return { views, ads, affiliate, product, sponsor, total: ads + affiliate + product + sponsor };
    }
    function audit(input, p) {
        const read = key => number(input[key], null, 0, key === 'avd' || key === 'avp' ? 1e7 : key === 'impressions' || key === 'hours' ? 1e12 : 100);
        const ctr = read('ctr'), avp = read('avp'), loss30 = read('loss30'), avd = read('avd'), impressions = read('impressions'), hours = read('hours');
        const actions = [];
        if (hours === null) actions.push('Indica las horas desde la publicación para situar la revisión de 48–72 h.');
        else if (hours < 48) actions.push('Lectura preliminar: vuelve a revisar a las 48–72 h y compara fuentes de tráfico similares.');
        else actions.push('Revisión pospublicación: compara con la línea base de tu canal y conserva el contexto de tráfico.');
        if (ctr === null) actions.push('Añade el CTR de impresiones desde YouTube Studio; las APIs públicas no lo miden.');
        else if (ctr < p.ctrTarget) actions.push((impressions >= 1000 ? 'Prueba otra miniatura y título' : 'CTR bajo con muestra pequeña: reúne más impresiones') + '; cambia una variable y registra la fecha del cambio.');
        else actions.push('CTR por encima de tu objetivo; comprueba si la promesa atrae a la audiencia adecuada.');
        if (loss30 === null) actions.push('Falta retención a los 30 s: consulta la curva y valida el gancho.');
        else if (loss30 > 40) actions.push('La caída inicial supera 40%: muestra el resultado antes, elimina introducciones y cumple la promesa en 5 s.');
        if (avp !== null && avp < p.avpTarget) actions.push('Retención media por debajo del objetivo: acorta repeticiones y recompensa antes los bucles de curiosidad.');
        if (text(input.valleys)) actions.push('Reedita o evita estos valles en la siguiente producción: ' + text(input.valleys, 1200));
        return { ctr, avp, loss30, avd, impressions, hours, actions };
    }
    const time = second => Math.floor(second / 60) + ':' + String(second % 60).padStart(2, '0');
    function productionMarkdown(project) {
        const p = project.profile;
        const lines = ['# ' + project.packaging.title, '', 'Creado: ' + project.createdAt, 'Nicho: ' + p.niche, 'Audiencia: ' + p.audience,
            'Objetivos editoriales: CTR ' + p.ctrTarget + '% · retención media ' + p.avpTarget + '% · RPM USD ' + p.rpm + ' (' + p.rpmSource + '). No son predicciones.', '',
            '## Empaquetado', project.packaging.promise, 'Miniatura: ' + project.packaging.thumbnail.concept, 'Texto: ' + project.packaging.thumbnail.text,
            'Elementos: ' + project.packaging.thumbnail.elements.join(' / '), 'Prompt (EN): ' + project.packaging.thumbnail.prompt, '', '## Guion y storyboard'];
        for (const b of project.blocks) {
            lines.push('', '### ' + time(b.start) + '–' + time(b.end) + ' · ' + b.label, '', b.narration, '', 'Edición: ' + b.editing);
            if (b.hook) lines.push('Gancho 0–5 s: ' + b.hook, 'Re-hook 5–30 s: ' + b.rehook);
            if (b.openLoop) lines.push('Bucle de curiosidad: ' + b.openLoop);
            if (b.sourceIds.length) lines.push('Referencias del bloque: ' + b.sourceIds.join(', '));
            for (const s of b.scenes) lines.push('', '- Escena ' + time(s.start) + '–' + time(s.end) + ': ' + s.visual,
                '  - Imagen (EN): ' + s.imagePrompt, '  - Video (EN, clip 5 s): ' + s.videoPrompt, '  - Negativo (EN): ' + s.negativePrompt);
        }
        lines.push('', '## Monetización y publicación', ...project.monetization.map(s => '- ' + s), '', '## Descripción', project.description, '', '## Comentario fijado', project.pinnedComment,
            '', '## Verificación antes de grabar', ...project.checks.map(s => '- ' + s), '', '## Hoja de edición (orientativa)');
        for (const c of editingCues(project.blocks)) lines.push('- ' + time(c.second) + ' (' + c.duration + ' s): ' + c.action + ' · ' + c.visual);
        lines.push('', '## Auditoría a las 48–72 horas', 'Registrar CTR e impresiones por fuente de tráfico, AVD, retención media, caída a los 30 s y valles. Comparar contra la línea base del canal.', '', '## Fuentes y cobertura');
        for (const s of project.sources) lines.push('- ' + s.url + ' · ' + s.title + ' · lectura ' + s.capturedAt + ' · ' + (s.transcript ? 'transcripción disponible' : 'solo metadatos; no verifica afirmaciones'));
        if (p.ownFacts) lines.push('', 'Notas proporcionadas por el creador (pendientes de verificación):', p.ownFacts);
        return lines.join('\n');
    }
    return { profile, dayKey, fingerprint, rpmGuidance, source, highlights, keywordSignals, dailyIdeas, validateIdeas, timeline, validatePackaging,
        wordBudget, validateBlocks, validateProject, editingCues, revenueScenario, audit, productionMarkdown, time, words, shortTitle, hash };
});
