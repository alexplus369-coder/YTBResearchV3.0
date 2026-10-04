/* UI for the local editorial board; ResearchCore contains the testable data logic. */
(function () {
    'use strict';
    const BOARD_KEY = 'ytResearchBoardV1';
    const HISTORY_KEY = 'ytResearchHistoryV1';
    const FILTER_KEY = 'ytResearchFiltersV1';
    const fieldIds = { region: 'research-region', language: 'research-language', days: 'research-days',
        duration: 'research-duration', order: 'research-order', minViews: 'research-min-views', maxSubs: 'research-max-subs' };
    const $ = id => document.getElementById(id);
    let board = [];
    let history = [];

    function readJSON(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
    }
    function persist(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); return true; }
        catch { showToast('No se pudo guardar en este navegador. Exporta el tablero para conservar tu trabajo.', 'error'); return false; }
    }
    function saveBoard(next) {
        if (!persist(BOARD_KEY, next)) return false;
        board = next;
        renderBoard();
        if (researchState.signals.length) renderResearchVideosTable();
        return true;
    }
    function download(text, name, type) {
        const url = URL.createObjectURL(new Blob([text], { type }));
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    window.readResearchFilters = function () {
        return Object.fromEntries(Object.entries(fieldIds).map(([key, id]) => [key, $(id).value]));
    };
    window.setResearchBusy = function (busy) {
        $('research-form').querySelectorAll('input, button').forEach(el => { el.disabled = busy; });
        Object.values(fieldIds).forEach(id => { $(id).disabled = busy; });
        document.querySelectorAll('#research-type-group button').forEach(el => { el.disabled = busy; });
        $('research-force-refresh').disabled = busy;
        $('research-ai-btn').disabled = busy || !!researchState.aiBusy;
        $('research-comments-btn').disabled = busy || !!researchState.commentsBusy;
        document.dispatchEvent(new CustomEvent('research-busy', { detail: { busy } }));
    };
    window.refreshResearchView = function () {
        if (!researchState.rawVideos.length) return;
        researchState.rpm = ResearchCore.rpm($('research-rpm').value);
        const all = computeResearchSignals(researchState.rawVideos, researchState.channelMap);
        researchState.signals = ResearchCore.filterSignals(all, readResearchFilters()).sort((a, b) => b.score - a.score);
        researchState.channelInsights = buildResearchChannelInsights(researchState.signals, researchState.channelMap);
        researchState.nicheDifficulty = all[0]?.difficulty ?? null;
        researchState.filters.minViews = $('research-min-views').value;
        researchState.filters.maxSubs = $('research-max-subs').value;
        renderResearchSummary();
        renderResearchChannels();
        renderResearchVideosTable();
        renderResearchOpportunities();
        renderResearchCohorts();
        $('research-result-count').textContent = `Mostrando ${researchState.signals.length} de ${researchState.rawVideos.length} videos de la muestra. Los filtros de vistas y suscriptores se aplican sin nuevas consultas.`;
        document.dispatchEvent(new CustomEvent('research-updated'));
    };
    window.researchSaveButton = function (videoId) {
        const saved = board.some(entry => entry.id === videoId);
        return `<button type="button" data-save-video="${escHtml(videoId)}" aria-pressed="${saved}" aria-label="${saved ? 'Referencia guardada' : 'Guardar referencia'}" class="text-[11px] font-bold px-2 py-1 rounded-lg ${saved ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}">${saved ? '✓ Guardado' : '+ Guardar'}</button>`;
    };
    window.saveResearchReference = function (videoId, notes = '') {
        const signal = researchState.signals.find(s => s.video.id === videoId);
        if (!signal) throw new Error('La referencia ya no pertenece a la muestra actual.');
        const entry = ResearchCore.entryFromSignal(signal, researchState.topic);
        entry.notes = String(notes).slice(0, 2000);
        return saveBoard(ResearchCore.mergeBoard(board, [entry]));
    };

    function renderBoard() {
        const filter = $('board-status-filter').value;
        const visible = board.filter(entry => filter === 'all' || entry.status === filter);
        $('board-count').textContent = `${board.length}/${ResearchCore.BOARD_LIMIT} referencias`;
        $('board-list').innerHTML = visible.map(entry => `
            <article data-entry-id="${entry.id}" class="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 flex-1">
                        <a href="https://www.youtube.com/watch?v=${entry.id}" target="_blank" rel="noopener noreferrer" class="text-sm font-bold text-indigo-700 hover:underline">${escHtml(entry.title)}</a>
                        <p class="text-xs text-slate-500 mt-1">${escHtml(entry.channel)} · ${escHtml(entry.topic)} · Lectura: ${new Date(entry.capturedAt).toLocaleDateString('es-MX')}</p>
                    </div>
                    <button type="button" data-board-action="remove" class="text-xs text-slate-500 hover:text-red-600" aria-label="Quitar referencia">Quitar</button>
                </div>
                <div class="flex flex-wrap gap-2 text-[11px] text-slate-500">
                    <span>${formatNumber(entry.views)} vistas guardadas</span><span>·</span><span>Oportunidad ${entry.opportunity}/100</span>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label class="text-xs font-bold text-slate-600">Estado
                        <select data-board-field="status" class="block w-full mt-1 p-2 border border-slate-200 rounded-lg bg-white font-normal">
                            ${Object.entries(ResearchCore.STATUSES).map(([value, label]) => `<option value="${value}"${entry.status === value ? ' selected' : ''}>${label}</option>`).join('')}
                        </select>
                    </label>
                    <label class="text-xs font-bold text-slate-600">Publicación prevista
                        <input type="date" data-board-field="dueDate" value="${entry.dueDate}" class="block w-full mt-1 p-2 border border-slate-200 rounded-lg font-normal">
                    </label>
                </div>
                <label class="block text-xs font-bold text-slate-600">Ángulo propio y notas
                    <textarea data-board-field="notes" maxlength="2000" rows="2" placeholder="Qué problema resolverás, ejemplo propio, pendientes..." class="block w-full mt-1 p-2 border border-slate-200 rounded-lg font-normal">${escHtml(entry.notes)}</textarea>
                </label>
                <button type="button" data-board-action="brief" class="text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-2 rounded-lg">Descargar brief sin IA</button>
            </article>`).join('') || '<p class="text-sm text-slate-500 p-4 bg-slate-50 rounded-xl">Guarda referencias desde la tabla del Radar para organizar tu próximo contenido.</p>';
    }

    $('research-videos-table').addEventListener('click', event => {
        const button = event.target.closest('[data-save-video]');
        if (!button || board.some(entry => entry.id === button.dataset.saveVideo)) return;
        const signal = researchState.signals.find(s => s.video.id === button.dataset.saveVideo);
        if (!signal) return;
        try {
            const next = ResearchCore.mergeBoard(board, [ResearchCore.entryFromSignal(signal, researchState.topic)]);
            if (saveBoard(next)) showToast('Referencia guardada en tu tablero editorial.', 'success');
        } catch (error) { showToast(error.message, 'error'); }
    });
    $('board-list').addEventListener('change', event => {
        const field = event.target.dataset.boardField;
        const id = event.target.closest('[data-entry-id]')?.dataset.entryId;
        if (!id || !['status', 'dueDate', 'notes'].includes(field)) return;
        const next = board.map(entry => entry.id === id ? ResearchCore.normalizeEntry({ ...entry, [field]: event.target.value }) : entry);
        // Avoid replacing a focused textarea after a successful edit.
        if (persist(BOARD_KEY, next)) { board = next; if (field === 'status') renderBoard(); }
    });
    $('board-list').addEventListener('click', event => {
        const action = event.target.closest('[data-board-action]');
        const id = action?.closest('[data-entry-id]')?.dataset.entryId;
        const entry = board.find(item => item.id === id);
        if (!entry) return;
        if (action.dataset.boardAction === 'remove') saveBoard(board.filter(item => item.id !== id));
        if (action.dataset.boardAction === 'brief') download(ResearchCore.briefMarkdown(entry), `brief-${id}.md`, 'text/markdown;charset=utf-8');
    });
    $('board-status-filter').addEventListener('change', renderBoard);
    $('board-export-json').addEventListener('click', () => download(ResearchCore.exportBoard(board), 'tablero-youtube.json', 'application/json'));
    $('board-export-plan').addEventListener('click', () => {
        if (!board.length) return showToast('Guarda al menos una referencia antes de exportar un plan.', 'error');
        const ordered = [...board].sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
        download('# Plan editorial de YouTube\n\n' + ordered.map(ResearchCore.briefMarkdown).join('\n'), 'plan-editorial-youtube.md', 'text/markdown;charset=utf-8');
    });
    $('board-import-json').addEventListener('change', async event => {
        const file = event.target.files[0];
        if (!file) return;
        try {
            if (file.size > 1024 * 1024) throw new Error('El respaldo debe pesar como máximo 1 MB.');
            const imported = ResearchCore.importBoard(await file.text());
            const before = board.length;
            if (saveBoard(ResearchCore.mergeBoard(board, imported))) showToast(`Respaldo importado: ${board.length - before} referencias nuevas. Se conservaron tus notas actuales.`, 'success');
        } catch (error) { showToast(error.message, 'error'); }
        finally { event.target.value = ''; }
    });

    window.rememberResearchSearch = function () {
        const entry = { topic: researchState.topic.slice(0, 200), type: researchState.type,
            filters: { ...researchState.filters }, timestamp: Date.now() };
        history = [entry, ...history.filter(item => item.topic !== entry.topic || item.type !== entry.type)].slice(0, 12);
        persist(HISTORY_KEY, history);
        renderHistory();
    };
    function renderHistory() {
        $('research-history').innerHTML = history.map((entry, i) => `<button type="button" data-history-index="${i}" title="Repetir búsqueda con sus filtros; puede consultar YouTube" class="text-[11px] font-bold text-slate-600 bg-slate-100 hover:bg-indigo-50 px-3 py-1.5 rounded-full">${escHtml(entry.topic)}</button>`).join('') || '<span class="text-xs text-slate-400">Tus últimas búsquedas aparecerán aquí.</span>';
    }
    $('research-history').addEventListener('click', event => {
        const button = event.target.closest('[data-history-index]');
        if (!button || researchState.busy) return;
        const entry = history[Number(button.dataset.historyIndex)];
        if (!entry) return;
        $('research-input').value = entry.topic;
        document.querySelector(`[data-rtype="${entry.type}"]`)?.click();
        Object.entries(fieldIds).forEach(([key, id]) => { $(id).value = entry.filters?.[key] ?? (key === 'minViews' ? '0' : ''); });
        $('research-force-refresh').checked = false;
        $('research-form').requestSubmit();
    });
    Object.values(fieldIds).forEach(id => $(id).addEventListener('change', () => {
        persist(FILTER_KEY, readResearchFilters());
        if (['research-min-views', 'research-max-subs'].includes(id)) refreshResearchView();
    }));
    $('research-rpm').addEventListener('change', () => {
        if (analyticsManualRpm !== null) analyticsManualRpm = ResearchCore.rpm($('research-rpm').value);
        $('analytics-rpm-badge').classList.add('hidden');
        refreshResearchView();
    });
    $('youtube-clear-cache').addEventListener('click', () => { youtubeClient.clearCache(); showToast('Caché de sesión vaciada.', 'success'); });

    try { board = ResearchCore.mergeBoard([], readJSON(BOARD_KEY, [])); }
    catch { showToast('No se pudo leer el tablero guardado. Puedes recuperar un respaldo JSON.', 'error'); }
    const storedHistory = readJSON(HISTORY_KEY, []);
    history = Array.isArray(storedHistory) ? storedHistory.filter(item => item && typeof item.topic === 'string' && Object.hasOwn(RESEARCH_TYPE_CONFIG, item.type)).slice(0, 12) : [];
    const filters = readJSON(FILTER_KEY, {});
    if (filters && typeof filters === 'object') Object.entries(fieldIds).forEach(([key, id]) => {
        if (Object.hasOwn(filters, key) && typeof filters[key] === 'string') $(id).value = filters[key];
    });
    renderBoard();
    renderHistory();
})();
