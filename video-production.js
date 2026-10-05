/* Optional local renderer. Credentials stay in memory; paid generation and uploads require explicit actions. */
(function () {
    'use strict';
    const $ = id => document.getElementById(id), h = value => escHtml(String(value ?? ''));
    let server = '', access = '', connected = false, capabilities = {}, version = 0, working = false;
    let assets = [], jobs = [], sceneBindings = {}, selectedAssets = new Set(), clipJob = null, timer = null, previewUrl = null;
    let uploadToken = '', uploadExpires = 0, productionSignature = '', failures = 0;
    const states = { queued: 'En cola', running: 'Produciendo', completed: 'Terminado', failed: 'Error', cancelled: 'Cancelado' };
    const project = () => window.getCreatorProduction?.();
    function error(value) { $('video-error').textContent = value.message || String(value); $('video-error').classList.remove('hidden'); }
    function status(value) { $('video-connection').textContent = value; }
    function lock() {
        $('video-render').disabled = working || !connected || !project();
        $('video-upload').disabled = working || !connected;
        $('video-refresh').disabled = working || !connected;
        $('video-cut').disabled = working || !connected || !clipJob;
        $('video-notify').disabled = !connected || !capabilities.telegram;
        for (const button of document.querySelectorAll('[data-video-action]')) button.disabled = working || !connected;
        $('video-paid-label').classList.toggle('hidden', $('video-materials').value !== 'replicate');
        $('video-voice').disabled = $('video-tts').value !== 'edge';
        $('video-audio').disabled = $('video-tts').value !== 'uploaded';
    }
    async function request(path, options = {}, binary = false) {
        if (!server || !access) throw new Error('Conecta tu motor de producción.');
        const captured = version;
        const { long, ...fetchOptions } = options;
        const response = await fetch(server + '/api/video' + path, { ...fetchOptions, headers: { Authorization: 'Bearer ' + access, ...(options.headers || {}) }, signal: AbortSignal.timeout(long ? 600000 : 30000) });
        if (captured !== version) throw new Error('La conexión cambió durante la solicitud.');
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            if (response.status === 401) { connected = false; access = ''; clearTimeout(timer); lock(); }
            const detail = Array.isArray(body.detail) ? body.detail.map(d => d.msg).join(' ') : body.detail;
            throw new Error(detail || 'El motor respondió HTTP ' + response.status + '.');
        }
        const body = await (binary ? response.blob() : response.json());
        if (captured !== version) throw new Error('La conexión cambió durante la solicitud.');
        return body;
    }
    const post = (path, payload) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    async function work(label, callback) {
        if (working) return;
        working = true; $('video-error').classList.add('hidden'); status(label); lock();
        try { await callback(); } catch (e) { error(e); status('Operación pendiente: corrige el problema y reintenta.'); }
        finally { working = false; lock(); }
    }
    function actions(job) {
        const button = (action, label) => '<button type="button" data-video-action="' + action + '" data-job="' + h(job.id) + '" class="text-xs font-bold border rounded-lg px-3 py-2">' + label + '</button>';
        if (job.state === 'completed') return button('preview', 'Ver MP4') + button('video.mp4', 'Descargar MP4') + button('subtitles.srt', 'SRT') + (job.result.artifacts.includes('project.zip') ? button('project.zip', 'Proyecto editable / Remotion') : '') + (job.result.canClip ? button('transcript', 'Transcripción / recortar') : '') + button('youtube', 'Subir privado a YouTube') + button('delete', 'Borrar render');
        if (job.state === 'queued' || job.state === 'running') return button('cancel', 'Cancelar');
        return button('retry', 'Reintentar') + button('delete', 'Borrar render');
    }
    function renderJobs() {
        $('video-jobs').innerHTML = jobs.map(job => '<article class="bg-white border rounded-xl p-3"><div class="flex justify-between flex-wrap gap-2"><strong class="text-sm">' + h(job.title || ('Video ' + job.id.slice(0, 8))) + '</strong><span class="text-xs font-bold">' + h(states[job.state] || job.state) + '</span></div><p class="text-xs text-slate-500 mt-1">' + h(job.id.slice(0, 8)) + ' · ' + h(new Date(job.created).toLocaleString('es-MX')) + ' · ' + h(job.stage) + '</p><progress max="100" value="' + Math.min(100, Math.max(0, job.progress)) + '" aria-label="Avance de producción" class="w-full mt-2"></progress>' +
            (job.result.durationSeconds ? '<p class="text-xs mt-2">' + Math.round(job.result.durationSeconds) + ' s · ' + job.result.width + '×' + job.result.height + ' · subtítulos: ' + h(job.result.captionTiming) + (job.result.canClip && !job.result.midRollDurationThresholdMet ? ' · Duración inferior a 8 minutos.' : '') + '</p>' : '') +
            (job.error ? '<p class="text-xs text-red-700 mt-2">' + h(job.error) + '</p>' : '') + (job.result.notificationWarning ? '<p class="text-xs mt-2">' + h(job.result.notificationWarning) + '</p>' : '') + '<div class="flex flex-wrap gap-2 mt-3">' + actions(job) + '</div></article>').join('') || '<p class="text-sm text-slate-500">Tus trabajos aparecerán aquí después de generar un MP4.</p>';
        lock();
    }
    async function refresh() {
        if (!connected) return;
        jobs = await request('/jobs'); renderJobs(); failures = 0;
        if (clipJob && !jobs.some(j => j.id === clipJob && j.state === 'completed')) { clipJob = null; $('video-transcript').innerHTML = ''; lock(); }
    }
    function poll() {
        clearTimeout(timer);
        if (!connected || !jobs.some(j => ['queued', 'running'].includes(j.state))) return;
        timer = setTimeout(async () => {
            if (!connected) return;
            try { await refresh(); poll(); }
            catch (e) { failures++; if (failures < 3) poll(); else { error(e); status('La actualización automática se pausó. Usa Actualizar para reconectar.'); } }
        }, document.hidden ? 5000 : 2000);
    }
    function audioOptions(defaultLabel) {
        return '<option value="">' + defaultLabel + '</option>' + assets.filter(a => a.kind === 'audio' || a.kind === 'video').map(a => '<option value="' + a.id + '">' + h(a.name) + '</option>').join('');
    }
    function renderAssets() {
        const audio = $('video-audio').value, music = $('video-music').value;
        $('video-assets').innerHTML = assets.map(a => '<div class="flex gap-2 items-center text-xs"><label class="flex-1"><input type="checkbox" data-use-asset="' + a.id + '"' + (selectedAssets.has(a.id) ? ' checked' : '') + (a.kind === 'audio' ? ' disabled' : '') + '> ' + h(a.name) + ' · ' + h(a.kind) + ' · ' + (a.size / 1024 / 1024).toFixed(1) + ' MB</label><button type="button" data-remove-asset="' + a.id + '" class="text-slate-500 underline">Eliminar recurso</button></div>').join('') || '<p class="text-xs text-slate-500">Todavía no has subido recursos.</p>';
        $('video-audio').innerHTML = audioOptions('Seleccionar narración'); $('video-music').innerHTML = audioOptions('Sin música');
        $('video-audio').value = audio; $('video-music').value = music; renderScenes(); lock();
    }
    function renderScenes() {
        const p = project(); if (!p) { $('video-scenes').innerHTML = ''; return; }
        let index = 0;
        const choices = '<option value="">Selección automática</option>' + assets.filter(a => a.kind !== 'audio').map(a => '<option value="' + a.id + '">' + h(a.name) + '</option>').join('');
        $('video-scenes').innerHTML = p.blocks.map(b => b.scenes.map(s => {
            const i = index++;
            return '<label class="block text-xs">Bloque ' + (b.index + 1) + ' · ' + h(s.visual) + '<select data-bind-scene="' + i + '" class="block w-full mt-1 p-2 border rounded-lg">' + choices + '</select></label>';
        }).join('')).join('');
        document.querySelectorAll('[data-bind-scene]').forEach(el => { el.value = sceneBindings[el.dataset.bindScene] || ''; });
    }
    function syncProduction() {
        const p = project(), signature = p ? CreatorCore.hash(JSON.stringify(p)) : '';
        if (signature !== productionSignature) {
            sceneBindings = {}; productionSignature = signature;
            $('video-blocks').innerHTML = p ? p.blocks.map(b => '<label><input type="checkbox" data-render-block="' + b.index + '" checked> ' + (b.index + 1) + '. ' + h(b.label) + '</label>').join('') : '';
            renderScenes();
        }
        $('video-project-state').textContent = p ? 'Producción que se renderizará: ' + p.packaging.title + ' · guardada ' + new Date(p.createdAt).toLocaleString('es-MX') + '. La duración final se medirá a partir del audio.' : 'Primero genera o recupera una producción completa en el estudio.';
        lock();
    }
    function resetPreview() {
        $('video-preview').pause(); $('video-preview').removeAttribute('src'); $('video-preview-wrap').classList.add('hidden');
        if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null;
    }
    $('video-connect').addEventListener('click', () => work('Conectando con el motor…', async () => {
        connected = false; clearTimeout(timer); version++; resetPreview();
        const url = new URL($('video-server').value.trim());
        if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) throw new Error('Usa HTTPS o la dirección local http://127.0.0.1:8787.');
        server = url.href.replace(/\/$/, ''); access = $('video-access').value.trim(); version++;
        const health = await request('/health');
        if (!health.ready) throw new Error('Instala FFmpeg y FFprobe en el servidor antes de renderizar.');
        if (!health.worker) throw new Error('Inicia el worker de producción antes de enviar videos a la cola.');
        connected = true; capabilities = health.providers;
        assets = await request('/assets'); await refresh(); renderAssets(); syncProduction(); poll();
        status('Motor conectado · ' + (health.worker ? 'cola activa' : 'worker detenido') + ' · ' + capabilities.encoder + '.');
    }));
    $('video-disconnect').addEventListener('click', () => {
        version++; connected = false; access = ''; uploadToken = ''; uploadExpires = 0; clearTimeout(timer); resetPreview();
        $('video-access').value = ''; $('video-youtube-state').textContent = 'Sin autorización de subida.'; status('Motor desconectado. Los trabajos enviados continúan en el servidor.'); lock();
    });
    $('video-upload').addEventListener('change', event => work('Subiendo recursos…', async () => {
        const files = [...event.target.files];
        for (const file of files) {
            if (file.size > (capabilities.maxUploadMB || 200) * 1024 * 1024) throw new Error('Un recurso supera el límite de subida.');
            const data = new FormData(); data.append('file', file);
            const asset = await request('/assets', { method: 'POST', body: data });
            if (asset.kind !== 'audio') selectedAssets.add(asset.id);
        }
        assets = await request('/assets'); renderAssets(); event.target.value = ''; status('Recursos subidos. Puedes asignarlos a las escenas.');
    }));
    $('video-assets').addEventListener('change', event => {
        const id = event.target.dataset.useAsset; if (!id) return;
        if (event.target.checked) selectedAssets.add(id); else selectedAssets.delete(id);
    });
    $('video-assets').addEventListener('click', event => {
        const id = event.target.dataset.removeAsset; if (!id) return;
        work('Eliminando recurso…', async () => { await request('/assets/' + id, { method: 'DELETE' }); selectedAssets.delete(id); sceneBindings = Object.fromEntries(Object.entries(sceneBindings).filter(([, value]) => value !== id)); assets = await request('/assets'); renderAssets(); status('Recurso eliminado.'); });
    });
    $('video-scenes').addEventListener('change', event => {
        const key = event.target.dataset.bindScene; if (key == null) return;
        if (event.target.value) sceneBindings[key] = event.target.value; else delete sceneBindings[key];
    });
    for (const id of ['video-tts', 'video-materials']) $(id).addEventListener('change', lock);
    $('video-render-form').addEventListener('submit', event => {
        event.preventDefault(); work('Enviando producción a la cola…', async () => {
            const p = project(); if (!p) throw new Error('Genera o recupera una producción completa.');
            const blocks = [...document.querySelectorAll('[data-render-block]:checked')].map(el => Number(el.dataset.renderBlock));
            if (!blocks.length) throw new Error('Selecciona al menos un bloque.');
            const result = await post('/jobs', { production: p, block_indexes: blocks, asset_ids: [...selectedAssets], scene_assets: sceneBindings,
                audio_id: $('video-audio').value || null, music_id: $('video-music').value || null,
                options: { aspect: $('video-aspect').value, resolution: Number($('video-resolution').value), materials: $('video-materials').value,
                    tts: $('video-tts').value, voice: $('video-voice').value, subtitles: $('video-subtitles').value, clip_seconds: Number($('video-clip-seconds').value),
                    max_generated: Number($('video-max-generated').value), music_volume: Number($('video-music-volume').value),
                    notify: $('video-notify').checked, paid_generation_confirmed: $('video-paid').checked } });
            await refresh(); poll(); status('Trabajo ' + result.id.slice(0, 8) + ' · ' + (states[result.state] || result.state) + '. Puedes seguir trabajando mientras se produce.');
        });
    });
    $('video-refresh').addEventListener('click', () => work('Actualizando cola…', async () => { await refresh(); poll(); status('Cola actualizada.'); }));
    $('video-jobs').addEventListener('click', event => {
        const el = event.target.closest('[data-video-action]'); if (!el) return;
        const id = el.dataset.job, action = el.dataset.videoAction;
        work('Procesando video ' + id.slice(0, 8) + '…', async () => {
            if (action === 'cancel' || action === 'retry') { await post('/jobs/' + id + '/' + action, {}); await refresh(); poll(); status('Trabajo actualizado.'); return; }
            if (action === 'delete') { await request('/jobs/' + id, { method: 'DELETE' }); await refresh(); resetPreview(); status('Render y archivos eliminados.'); return; }
            if (action === 'youtube') {
                if (!uploadToken || Date.now() >= uploadExpires) throw new Error('Autoriza la subida a YouTube antes de enviar el MP4.');
                $('video-youtube-state').textContent = 'Subiendo como privado; conserva abierta esta página…';
                const result = await request('/jobs/' + id + '/youtube', { method: 'POST', long: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: uploadToken, made_for_kids: $('video-kids').checked, synthetic: $('video-synthetic').checked }) });
                $('video-youtube-state').innerHTML = 'Video privado: <a href="https://www.youtube.com/watch?v=' + h(result.videoId) + '" class="text-indigo-700 underline" target="_blank" rel="noopener noreferrer">Abrir en YouTube</a>'; status('Subida privada confirmada. Revisa el video en Studio antes de publicarlo.'); return;
            }
            if (action === 'transcript') {
                const words = await request('/jobs/' + id + '/files/words.json');
                clipJob = id;
                $('video-transcript').innerHTML = words.filter(w => w.end > w.start).map(w => '<button type="button" data-word-start="' + Number(w.start) + '" data-word-end="' + Number(w.end) + '" class="text-xs border rounded px-2 py-1" title="Iniciar recorte en este punto">' + h(w.text) + '</button>').join('');
                const job = jobs.find(j => j.id === id); $('video-cut-end').value = Math.min(30, job.result.durationSeconds).toFixed(1);
                $('video-clip-source').textContent = 'Video ' + id.slice(0, 8) + ' · ' + job.result.captionTiming + '. Haz clic en una palabra para empezar allí; ajusta el final y comprueba el audio.'; status('Transcripción cargada para recortar.'); return;
            }
            const filename = action === 'preview' ? 'video.mp4' : action;
            const blob = await request('/jobs/' + id + '/files/' + filename, {}, true), url = URL.createObjectURL(blob);
            if (action === 'preview') { resetPreview(); previewUrl = url; $('video-preview').src = url; $('video-preview-title').textContent = 'Video ' + id.slice(0, 8); $('video-preview-wrap').classList.remove('hidden'); }
            else { const a = document.createElement('a'); a.href = url; a.download = id.slice(0, 8) + '-' + filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
            status(action === 'preview' ? 'MP4 listo para revisar.' : 'Archivo descargado.');
        });
    });
    $('video-transcript').addEventListener('click', event => {
        const el = event.target.closest('[data-word-start]'); if (!el) return;
        const start = Number(el.dataset.wordStart), job = jobs.find(j => j.id === clipJob);
        $('video-cut-start').value = start.toFixed(1); $('video-cut-end').value = Math.min(start + 30, job.result.durationSeconds).toFixed(1);
    });
    $('video-cut-form').addEventListener('submit', event => {
        event.preventDefault(); if (!clipJob) return;
        work('Preparando recorte…', async () => { await post('/jobs/' + clipJob + '/clips', { start: Number($('video-cut-start').value), end: Number($('video-cut-end').value), aspect: $('video-cut-aspect').value, resolution: Number($('video-resolution').value) }); await refresh(); poll(); status('Recorte enviado a la cola con subtítulos ajustados.'); });
    });
    $('video-youtube-connect').addEventListener('click', () => work('Solicitando permiso de subida…', async () => {
        const clientId = $('analytics-client-id').value.trim(); if (!clientId) throw new Error('Configura el OAuth Client ID en el Radar.');
        await loadGsiScript(); const captured = version;
        await new Promise((resolve, reject) => {
            const client = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: 'https://www.googleapis.com/auth/youtube.upload',
                callback: result => { if (captured !== version) return reject(new Error('La conexión cambió.'));
                    if (!result.access_token) return reject(new Error('No se autorizó la subida.'));
                    uploadToken = result.access_token; uploadExpires = Date.now() + Number(result.expires_in || 3600) * 1000;
                    $('video-youtube-state').textContent = 'Subida autorizada durante esta sesión. Elige “Subir privado” en el MP4 que quieras enviar.'; resolve(); },
                error_callback: () => reject(new Error('La autorización se canceló o no estuvo disponible.')) });
            client.requestAccessToken({ prompt: 'consent' });
        });
        status('Permiso de subida disponible; no se ha enviado ningún video.');
    }));
    document.addEventListener('creator-production-updated', syncProduction);
    $('creator-export-md').addEventListener('click', syncProduction);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && connected) { refresh().then(poll).catch(error); } });
    if (['localhost', '127.0.0.1'].includes(location.hostname)) $('video-server').value = location.origin;
    syncProduction(); lock();
})();
