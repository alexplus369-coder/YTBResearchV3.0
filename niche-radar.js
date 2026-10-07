/* Opt-in, bounded YouTube reads. Rendering and changing scenarios never call an AI provider. */
(function () {
    'use strict';
    const $ = id => document.getElementById(id), core = NicheCore;
    const KEY = { data: 'ytNicheRadarV1', settings: 'ytNicheSettingsV1', history: 'ytNicheHistoryV1' };
    let data = null, history = {}, active = null, ranked = [], dirty = false;
    function read(key) { try { const raw = localStorage.getItem(key); return raw && raw.length < 1000000 ? JSON.parse(raw) : null; } catch { return null; } }
    function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }
    const esc = v => escHtml(String(v ?? ''));
    const money = n => n.toLocaleString('es-MX', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
    const fmt = n => Math.round(n).toLocaleString('es-MX');
    const ids = ['niche-rpm', 'niche-cost', 'niche-views', 'niche-small', 'niche-interests', 'niche-affinity', 'niche-order'];
    let options = core.settings(read(KEY.settings) || { rpm: $('research-rpm').value });
    function getFilters() { return core.filters({ region: $('niche-region').value, language: $('niche-language').value, days: $('niche-days').value, duration: $('niche-duration').value }); }
    function setFilters(f) { for (const key of ['region', 'language', 'days', 'duration']) $('niche-' + key).value = f[key]; }
    function status(message) { $('niche-status').textContent = message; }
    function error(message) { $('niche-error').textContent = message; $('niche-error').hidden = !message; }
    function lock() {
        const busy = !!active;
        $('niche-update').disabled = busy || researchState.busy || $('creator-package-btn').disabled; $('niche-stop').disabled = !busy;
        for (const key of ['region', 'language', 'days', 'duration']) $('niche-' + key).disabled = busy;
        $('niche-export').disabled = busy || !ranked.length;
        document.querySelectorAll('[data-niche-action]').forEach(el => { el.disabled = busy || dirty || researchState.busy || $('creator-package-btn').disabled; });
        $('niche-panel').setAttribute('aria-busy', String(busy));
    }
    function inputs() {
        return core.settings({ ...options, rpm: $('niche-rpm').value, cost: $('niche-cost').value, views: $('niche-views').value,
            smallChannel: $('niche-small').value, interests: $('niche-interests').value, affinity: $('niche-affinity').checked, order: $('niche-order').value });
    }
    function fillSettings() {
        for (const [key, name] of [['rpm', 'rpm'], ['cost', 'cost'], ['views', 'views'], ['smallChannel', 'small'], ['interests', 'interests'], ['order', 'order']]) $('niche-' + name).value = options[key];
        $('niche-affinity').checked = options.affinity;
    }
    function scenarioFields() {
        $('niche-overrides').innerHTML = core.CATALOG.map(n => '<div class="niche-override-row"><span>' + esc(n.label) + '</span><label><span class="sr-only">RPM supuesto de ' + esc(n.label) + '</span><input type="number" min="0" max="500" step="0.1" data-niche-rpm="' + n.id + '" placeholder="General" value="' + (options.overrides[n.id]?.rpm ?? '') + '"></label><label><span class="sr-only">Costo supuesto de ' + esc(n.label) + '</span><input type="number" min="0" max="100000" step="0.1" data-niche-cost="' + n.id + '" placeholder="General" value="' + (options.overrides[n.id]?.cost ?? '') + '"></label></div>').join('');
    }
    function render() {
        try { ranked = data ? core.rank(data, options, history).rows : []; }
        catch { data = null; ranked = []; try { localStorage.removeItem(KEY.data); } catch {} status('La muestra expiró. Actualiza para consultar los nichos.'); }
        const top = ranked.slice(0, 10), f = data?.filters;
        $('niche-count').textContent = top.length ? top.length + ' oportunidades · ' + ranked.length + ' nichos con muestra' : '20 nichos por explorar';
        $('niche-updated').textContent = data ? 'Última consulta: ' + new Date(data.updatedAt).toLocaleString('es-MX') + ' · ' + (f.region || 'MX') + ' · idioma preferido ' + f.language + ' · ' + f.days + ' días · ' + ({ short: 'menos de 4 min', medium: '4–20 min', long: 'más de 20 min' }[f.duration]) + (Date.now() - Date.parse(data.updatedAt) > core.DAY ? ' · muestra de más de 24 h: actualiza antes de decidir' : '') : 'Sin consultas automáticas. Añade tu YouTube API Key y pulsa Actualizar ranking.';
        $('niche-context-warning').hidden = !dirty;
        $('niche-scenario-note').textContent = 'Escenario por video de ' + fmt(options.views) + ' vistas: RPM general ' + money(options.rpm) + ' y coste ' + money(options.cost) + '. ' +
            'La puntuación compara demanda (50%), resultados de canales pequeños (20%) y margen simulado (30%). ' + (options.affinity ? 'Con afinidad: demanda 40%, canales pequeños 20%, margen 30% e intereses 10%. ' : '') +
            'Los valores iguales reciben una puntuación neutral. No es una predicción de ingresos.';
        $('niche-results').innerHTML = top.length ? top.map((row, index) => {
            const growth = row.growthRatio == null ? esc(row.growthLabel) : esc(row.growthLabel) + ' · ' + row.growthRatio.toFixed(2) + '× · ' + row.growthCount + ' videos medidos';
            const actions = '<div class="niche-card-actions"><button type="button" class="studio-button" data-niche-action="analyze" data-niche-id="' + row.id + '">Analizar nicho</button><button type="button" class="studio-button studio-button-secondary" data-niche-action="script" data-niche-id="' + row.id + '">Preparar guion</button></div>';
            return '<article class="niche-card"><div class="niche-card-heading"><span class="niche-rank">' + (index + 1) + '</span><div><h3>' + esc(row.label) + '</h3><p>Muestra ' + row.confidence.toLowerCase() + ' · ' + row.sampleCount + ' videos · ' + row.channelCount + ' canales</p></div><span class="niche-score" title="Puntuación heurística relativa; no representa ingresos ni probabilidad de éxito">' + row.score + '<small>/100</small></span></div>' +
                '<dl class="niche-metrics"><div><dt>Mediana de vistas/día</dt><dd>' + fmt(row.medianVpd) + '</dd><small>desde publicación</small></div><div><dt>Resultados de canales pequeños</dt><dd>' + (row.access == null ? 'Sin datos' : Math.round(row.access * 100) + '%') + '</dd><small>' + row.smallCount + ' de ' + row.knownCount + ' videos con subs visibles, ≥1.000 vistas</small></div></dl>' +
                '<p class="niche-growth">' + growth + '</p><div class="niche-margin"><span>Margen simulado por video</span><strong>' + money(row.margin) + '</strong><small>' + row.financialSource + ': RPM ' + money(row.rpm) + ' · coste ' + money(row.cost) + '; sin afiliación ni patrocinios presupuestados</small></div>' +
                (options.affinity ? '<p class="niche-growth">Afinidad de palabras clave con tus intereses: ' + row.affinity + '/100</p>' : '') +
                '<p class="niche-offers">' + esc(row.offers) + '</p><details class="niche-sources"><summary>Fuentes y desglose</summary><p>Demanda ' + Math.round(row.demandScore) + '/100 · canales pequeños ' + Math.round(row.accessScore) + '/100 · margen ' + Math.round(row.marginScore) + '/100. La amplitud describe esta muestra de búsqueda, no la certeza financiera.</p><p>Consulta: ' + esc(row.queries[f.language]) + '. Cada video puede aparecer en varios nichos.</p><ul>' + row.videos.slice(0, 6).map(v => '<li><a href="' + v.url + '" target="_blank" rel="noopener noreferrer">' + esc(v.title || 'Ver referencia') + '</a><span>' + esc(v.channel) + ' · ' + fmt(v.views) + ' vistas · lectura ' + esc(new Date(v.capturedAt).toLocaleDateString('es-MX')) + '</span></li>').join('') + '</ul></details>' + actions + '</article>';
        }).join('') : '<div class="niche-empty"><span class="niche-empty-icon" aria-hidden="true">↗</span><h3>' + (data ? 'Todavía falta una muestra elegible' : 'Encuentra tu siguiente oportunidad') + '</h3><p>' + (data ? 'Prueba un periodo más amplio. Se excluyen directos, videos de menos de un día y resultados fuera de la duración elegida.' : 'Compara 20 nichos con fuentes reales. El ranking aparecerá después de tu primera consulta; puedes ajustar los supuestos financieros sin nuevas búsquedas.') + '</p></div>';
        lock();
    }
    async function fetchNiche(niche, f, key, current) {
        const q = niche.queries[f.language], params = ResearchCore.searchParams(q, { max: 20, order: 'relevance' }, f);
        params.part = 'snippet';
        const found = await youtubeClient.fetchJson(ResearchCore.youtubeUrl('search', params, key));
        if (!current()) return null;
        const ids = [...new Set((found.items || []).map(v => v.id?.videoId).filter(id => /^[\w-]{11}$/.test(id || '')))].slice(0, 20);
        if (!ids.length) return { id: niche.id, videos: [] };
        const details = await youtubeClient.fetchJson(ResearchCore.youtubeUrl('videos', { part: 'snippet,statistics,contentDetails', id: ids.join(',') }, key));
        if (!current()) return null;
        const videos = (details.items || []).filter(v => ids.includes(v.id));
        const channels = [...new Set(videos.map(v => v.snippet?.channelId).filter(id => /^[\w-]{24}$/.test(id || '')))];
        const channelData = channels.length ? await youtubeClient.fetchJson(ResearchCore.youtubeUrl('channels', { part: 'statistics', id: channels.join(',') }, key)) : { items: [] };
        if (!current()) return null;
        return { id: niche.id, videos: core.sample(videos, Object.fromEntries((channelData.items || []).map(c => [c.id, c])), f) };
    }
    $('niche-form').addEventListener('submit', async event => {
        event.preventDefault(); if (active || researchState.busy || $('creator-package-btn').disabled) return;
        error('');
        const key = $('ytApiKeyInput').value.trim();
        if (!key) { error('Configura tu YouTube API Key en Configuración APIs para consultar los nichos. No necesitas Gemini ni Replicate para este ranking.'); return; }
        const f = getFilters(), run = { stop: false, rows: [], next: 0, failures: 0, fatal: '' };
        active = run; lock(); $('niche-progress').value = 0; $('niche-progress').hidden = false;
        const alive = () => active === run && !run.stop && $('ytApiKeyInput').value.trim() === key;
        const current = () => alive() && !run.fatal;
        async function worker() {
            while (current() && run.next < core.CATALOG.length && !run.fatal) {
                const niche = core.CATALOG[run.next++];
                try { const row = await fetchNiche(niche, f, key, current); if (row && current()) run.rows.push(row); }
                catch (cause) {
                    if (!current()) return;
                    run.failures++; run.rows.push({ id: niche.id, videos: [], error: true });
                    if (/cuota|quota|límite diario|limit.*daily|api key|clave|configuraci|habilita|configurado/i.test(cause.message)) run.fatal = cause.message;
                }
                if (!current()) return;
                $('niche-progress').value = run.rows.length;
                status('Consultando nichos: ' + run.rows.length + ' de ' + core.CATALOG.length + '. Solo datos públicos de YouTube; se reutilizan consultas recientes.');
            }
        }
        status('Iniciando comparación de 20 nichos. Máximo 20 búsquedas y 40 consultas de detalles; dos nichos a la vez.');
        try {
            await Promise.all([worker(), worker()]);
            if (!alive()) { status('Consulta detenida. El último ranking guardado se conserva. Las solicitudes ya enviadas pueden consumir cuota.'); return; }
            if (run.fatal) throw new Error(run.fatal);
            const next = core.snapshot({ format: 'yt-niche-radar', version: 1, updatedAt: new Date().toISOString(), filters: f, complete: !run.failures, rows: run.rows });
            if (!next.rows.some(r => r.videos.length)) { status('Consultas terminadas sin videos elegibles. Se conserva la última muestra; prueba otro periodo o formato.'); error('No hubo una muestra elegible para comparar los nichos.'); return; }
            data = next; dirty = false; history = core.recordHistory(history, next.rows);
            const stored = save(KEY.data, data), historyStored = save(KEY.history, history);
            render(); status(run.failures ? 'Ranking parcial: ' + run.failures + ' nichos no pudieron consultarse. Las posiciones comparan solo muestras disponibles; vuelve a actualizar.' : 'Comparación terminada. Revisa las fuentes y ajusta RPM y costes antes de elegir.');
            if (!stored || !historyStored) status('Ranking disponible en esta página; no se pudo guardar todo el historial en el navegador. Descarga el informe para conservarlo.');
        } catch (cause) { error(cause.message); status('No se completó la consulta. Se conserva el último ranking; no se reintenta automáticamente.'); }
        finally { active = null; $('niche-progress').hidden = true; lock(); }
    });
    $('niche-stop').addEventListener('click', () => { if (active) { active.stop = true; $('niche-stop').disabled = true; status('Deteniendo la consulta después de las solicitudes en curso…'); } });
    for (const key of ['region', 'language', 'days', 'duration']) $('niche-' + key).addEventListener('change', () => { dirty = !!data && JSON.stringify(getFilters()) !== JSON.stringify(data.filters); error(''); render(); });
    for (const id of ids) $(id).addEventListener('change', () => { options = inputs(); if (!save(KEY.settings, options)) status('Supuestos conservados solo en esta página; no se pudieron guardar.'); render(); });
    $('niche-overrides').addEventListener('change', event => {
        const el = event.target, id = el.dataset.nicheRpm || el.dataset.nicheCost; if (!id) return;
        const overrides = { ...options.overrides, [id]: { ...options.overrides[id], [el.dataset.nicheRpm ? 'rpm' : 'cost']: el.value } };
        options = core.settings({ ...inputs(), overrides });
        if (!save(KEY.settings, options)) status('Supuestos conservados solo en esta página; no se pudieron guardar.');
        render();
    });
    $('niche-use-profile').addEventListener('click', () => { $('niche-interests').value = [$('creator-niche').value, $('creator-audience').value].filter(Boolean).join(' '); $('niche-interests').dispatchEvent(new Event('change')); });
    $('niche-panel').addEventListener('click', event => {
        const el = event.target.closest('[data-niche-action]');
        if (!el || el.disabled || active || dirty || researchState.busy || $('creator-package-btn').disabled) return;
        const row = ranked.find(r => r.id === el.dataset.nicheId); if (!row) return;
        if (el.dataset.nicheAction === 'script') {
            document.dispatchEvent(new CustomEvent('creator-niche-selected', { detail: core.creatorSelection(row) }));
            $('creator-suite').scrollIntoView({ behavior: 'smooth', block: 'start' });
            status('Nicho y referencias enviados al estudio. Define el tema concreto y crea títulos y miniaturas; este paso no llama a la IA.');
        } else {
            const f = data.filters;
            for (const name of ['region', 'language', 'days', 'duration']) $('research-' + name).value = f[name];
            $('research-input').value = row.queries[f.language]; document.querySelector('[data-rtype="nicho"]').click();
            $('research-form').dispatchEvent(new Event('submit', { cancelable: true }));
            $('research-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });
    $('niche-export').addEventListener('click', () => {
        if (!data || !ranked.length) return;
        const lines = ['# Top de oportunidades de nicho', '', 'Consulta: ' + data.updatedAt, 'Filtros: ' + JSON.stringify(data.filters),
            'Escenario por video: ' + options.views + ' vistas. Todos los RPM y costes son supuestos manuales, no ingresos observados de terceros.',
            'Puntuación relativa: demanda 50%, resultados de canales pequeños 20%, margen 30%; con afinidad, demanda 40% e intereses 10%. No es una predicción.', ''];
        ranked.slice(0, 10).forEach((r, i) => lines.push('## ' + (i + 1) + '. ' + r.label, 'Puntuación: ' + r.score + '/100 · muestra ' + r.confidence + ' (' + r.sampleCount + ' videos, ' + r.channelCount + ' canales)',
            'Mediana de vistas/día desde publicación: ' + Math.round(r.medianVpd), 'Historial: ' + r.growthLabel,
            'RPM supuesto: ' + r.rpm + ' USD · coste: ' + r.cost + ' USD · margen simulado: ' + r.margin.toFixed(2) + ' USD',
            'Ofertas por validar: ' + r.offers, ...r.videos.slice(0, 6).map(v => '- ' + v.url + ' · ' + v.title.replace(/[<>\r\n]/g, ' ') + ' · lectura ' + v.capturedAt), ''));
        const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })), link = document.createElement('a');
        link.href = url; link.download = 'top-nichos.md'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    document.addEventListener('research-busy', lock); document.addEventListener('creator-busy', lock);
    history = core.history(read(KEY.history)); fillSettings(); scenarioFields();
    const saved = read(KEY.data);
    if (saved) try { data = core.snapshot(saved); setFilters(data.filters); status('Muestra recuperada del navegador. No se han realizado consultas al abrir la página.'); }
    catch { try { localStorage.removeItem(KEY.data); } catch {} status('El ranking guardado expiró o era incompatible. Actualiza para obtener una nueva muestra.'); }
    render();
})();
