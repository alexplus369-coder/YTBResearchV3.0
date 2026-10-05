const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../creator-core.js');
const { app, until, fixtureVideos, channelId } = require('./helpers/app.cjs');
const { variants, block, completeProject, publishing } = require('./helpers/creator-fixtures.cjs');
const submit = a => a.$('creator-packaging-form').dispatchEvent(new a.w.Event('submit', { cancelable: true }));
function ai(a) {
    const calls = [];
    a.$('geminiApiKeyInput').value = 'fake-gemini-key';
    a.w.smartFetchAI = async prompt => {
        calls.push(prompt);
        if (prompt.includes('Primero concibe el empaquetado')) return { variants: structuredClone(variants) };
        if (prompt.includes('Exactamente cinco ideas')) return { ideas: core.dailyIdeas(core.profile({ niche: a.$('creator-niche').value, audience: a.$('creator-audience').value }), [], []) };
        const second = prompt.includes('"index":3');
        return { blocks: core.timeline(Number(a.$('creator-duration').value)).slice(second ? 3 : 0, second ? 6 : 3).map(block), ...(second ? { publishing: publishing() } : {}) };
    };
    return calls;
}
async function production(a) {
    a.change('creator-niche', 'Software de productividad'); a.change('creator-audience', 'Arquitectos principiantes');
    a.$('creator-topic').value = 'Organizar un proyecto'; submit(a);
    await until(() => !a.$('creator-script-btn').disabled);
    a.$('creator-script-btn').click();
    await until(() => !a.$('creator-export-md').disabled);
}
async function scriptReady(t, storage = {}) {
    const a = app(t, storage); ai(a);
    a.change('creator-niche', 'Software'); a.$('creator-topic').value = 'Tema'; submit(a);
    await until(() => !a.$('creator-script-btn').disabled);
    return a;
}
function countedBlock(slot, count) {
    const value = block(slot), words = value.narration.split(/\s+/u).slice(0, count);
    while (words.length < count) words.push('ejemplo');
    return { ...value, narration: words.join(' ') };
}
function corrections(prompt) {
    const line = prompt.match(/\nDevuelve solamente estos índices pendientes: ([^\n]+)/);
    return line ? JSON.parse(line[1]) : null;
}

test('profile creates five local daily ideas without credentials or automatic API calls and restores audience', t => {
    const a = app(t);
    a.change('creator-niche', 'Software'); a.change('creator-audience', 'Arquitectos de México');
    a.$('creator-tab-daily').click();
    assert.equal(a.$('creator-daily').querySelectorAll('article').length, 5); assert.equal(a.requests.length, 0);
    assert.match(a.$('creator-daily-date').textContent, /no se envían notificaciones/);
    const b = app(t, { ytCreatorProfileV1: a.w.localStorage.getItem('ytCreatorProfileV1') });
    assert.equal(b.$('creator-audience').value, 'Arquitectos de México'); assert.equal(b.requests.length, 0);
    a.$('creator-daily-export').click(); assert.equal(a.downloads[0].name, 'ideas-youtube.md');
});

test('Radar feeds highlights and keyword evidence, escapes titles and saves adaptations into the board', async t => {
    const a = app(t); await a.scan();
    assert.equal(a.$('creator-highlights').querySelectorAll('article').length, 6);
    assert.equal(a.$('creator-highlights').querySelector('img'), null);
    assert.match(a.$('creator-highlights').textContent, /Comparación insuficiente/);
    assert.ok(a.$('creator-keywords').querySelectorAll('tr').length > 0);
    a.$('creator-highlights').querySelector('[data-creator-action="save"]').click();
    assert.equal(a.$('board-list').querySelectorAll('article').length, 1);
    assert.match(a.$('board-list').querySelector('textarea').value, /original|propi[oa]/);
    a.$('creator-highlights').querySelector('[data-creator-action="adapt"]').click();
    assert.equal(a.$('creator-panel-studio').classList.contains('hidden'), false);
    assert.match(a.$('creator-angle').value, /https:\/\/www.youtube.com/);
});

test('autocomplete adds suggestion provenance without YouTube search calls or fabricated volume', async t => {
    const a = app(t); a.change('creator-niche', 'Corona Renderer');
    a.$('creator-keyword-refresh').click(); await until(() => !a.$('creator-keyword-refresh').disabled);
    assert.match(a.$('creator-keywords').textContent, /autocomplete/); assert.equal(a.requests.length, 0);
    assert.match(a.$('creator-status').textContent, /No representan volumen/);
});

test('daily AI is opt-in, cached by profile/day/sample and invalidated by audience changes', async t => {
    const a = app(t); a.change('creator-niche', 'Software'); a.change('creator-audience', 'Principiantes');
    const calls = ai(a); a.$('creator-daily-ai').click(); await until(() => !a.$('creator-daily-ai').disabled);
    assert.equal(calls.length, 1); assert.match(a.$('creator-daily-date').textContent, /Ideas con IA/);
    a.$('creator-tab-daily').click(); a.$('creator-tab-daily').click(); assert.equal(calls.length, 1);
    a.change('creator-audience', 'Expertos'); assert.match(a.$('creator-daily-date').textContent, /sin IA/);
    assert.equal(calls.length, 1);
});

test('packaging precedes a complete two-part script and exports a safe, recoverable production', async t => {
    const a = app(t); await a.scan(); const calls = ai(a);
    a.change('creator-affiliate', 'Herramienta propia'); a.change('creator-affiliate-url', 'https://example.test/ref?utm_source=youtube');
    await production(a);
    assert.equal(calls.length, 3); assert.match(calls[0], /Primero concibe el empaquetado/);
    assert.equal(a.$('creator-packaging').querySelectorAll('input[type="radio"]').length, 3);
    const saved = JSON.parse(a.w.localStorage.getItem('ytCreatorProductionV1'));
    assert.equal(saved.blocks.length, 6); assert.ok(saved.blocks.reduce((n, b) => n + b.wordCount, 0) >= 1000);
    assert.ok(saved.sources.every(s => !s.transcript)); assert.match(saved.description.split('\n')[0], /enlace de afiliado/);
    a.$('creator-export-md').click(); a.$('creator-export-json').click();
    const markdown = await a.downloads[0].blob.text(), json = await a.downloads[1].blob.text();
    assert.match(markdown, /Imagen \(EN\)/); assert.match(markdown, /Video \(EN/); assert.match(markdown, /Hoja de edición/);
    assert.ok(!json.includes('fake-gemini-key')); assert.ok(!json.includes('fake-yt-key'));
    assert.deepEqual(core.validateProject(JSON.parse(json)), saved);
    const b = app(t, { ytCreatorProductionV1: json }); assert.equal(b.$('creator-export-md').disabled, false);
    assert.match(b.$('creator-production').textContent, /Producción guardada/); assert.deepEqual(a.errors, []);
});

test('missing AI and invalid model output fail visibly, unlock controls and preserve the last completed production', async t => {
    const previous = core.validateProject(completeProject());
    const a = app(t, { ytCreatorProductionV1: JSON.stringify(previous) });
    a.change('creator-niche', 'Software'); a.$('creator-topic').value = 'Tema'; submit(a);
    await until(() => !a.$('creator-package-btn').disabled);
    assert.match(a.$('creator-error').textContent, /Configura Gemini/);
    ai(a); a.w.smartFetchAI = async () => ({ variants: [{ title: 'Incompleto' }] }); submit(a);
    await until(() => !a.$('creator-package-btn').disabled);
    assert.match(a.$('creator-error').textContent, /tres propuestas/);
    assert.equal(a.$('creator-script-btn').disabled, true);
    assert.equal(a.w.localStorage.getItem('ytCreatorProductionV1'), JSON.stringify(previous));
});

test('invalid title length gets one bounded automatic packaging repair', async t => {
    const a = app(t); a.change('creator-niche', 'Software'); a.$('geminiApiKeyInput').value = 'fake-key';
    const calls = [];
    a.w.smartFetchAI = async prompt => {
        calls.push(prompt);
        if (calls.length === 1) {
            const invalid = structuredClone(variants); invalid[0].title = 'Este título deliberadamente supera el máximo de cincuenta caracteres';
            return { variants: invalid };
        }
        return { variants: structuredClone(variants) };
    };
    a.$('creator-topic').value = 'Tema'; submit(a); await until(() => !a.$('creator-script-btn').disabled);
    assert.equal(calls.length, 2); assert.match(calls[1], /CORRECCIÓN ÚNICA/); assert.match(calls[1], /titleCharacters/);
    assert.equal(a.$('creator-packaging').querySelectorAll('input[type="radio"]').length, 3); assert.deepEqual(a.errors, []);
});

test('a short model outline cannot overwrite the completed production', async t => {
    const previous = core.validateProject(completeProject());
    const a = app(t, { ytCreatorProductionV1: JSON.stringify(previous) }); ai(a);
    a.change('creator-niche', 'Software'); a.$('creator-topic').value = 'Tema'; submit(a);
    await until(() => !a.$('creator-script-btn').disabled);
    a.w.smartFetchAI = async () => ({ blocks: core.timeline(9).slice(0, 3).map(slot => ({ ...block(slot), narration: 'Un esquema corto.' })) });
    a.$('creator-script-btn').click(); await until(() => !a.$('creator-package-btn').disabled);
    assert.match(a.$('creator-error').textContent, /palabras/); assert.equal(a.w.localStorage.getItem('ytCreatorProductionV1'), JSON.stringify(previous));
});

test('the reported 42-word hook gets two selective repairs with measured budgets, retaining all accepted work', async t => {
    const a = await scriptReady(t), slots = core.timeline(9), calls = [];
    const initial = slots.slice(0, 3).map(block); initial[0] = countedBlock(slots[0], 42);
    initial[1].narration += ' conservado';
    a.w.smartFetchAI = async prompt => {
        calls.push(prompt);
        if (calls.length === 1) return { blocks: structuredClone(initial) };
        if (calls.length <= 3) return { blocks: [
            { ...countedBlock(slots[0], calls.length === 2 ? 45 : 73), editing: 'Cambio no solicitado', scenes: [] },
            { ...block(slots[1]), narration: 'No debe sustituir un bloque validado.' }
        ] };
        return { blocks: slots.slice(3).map(block), publishing: publishing() };
    };
    a.$('creator-script-btn').click(); await until(() => !a.$('creator-export-md').disabled);
    assert.equal(calls.length, 4);
    assert.match(calls[1], /REPARACIÓN SELECTIVA DE GUION/);
    assert.deepEqual(corrections(calls[1]).map(c => [c.index, c.mode, c.wordsReceived, c.minWords, c.maxWords, c.wordsToTarget]), [[0, 'narration', 42, 49, 99, 31]]);
    assert.deepEqual(corrections(calls[2]).map(c => [c.index, c.wordsReceived, c.wordsToTarget]), [[0, 45, 28]]);
    const saved = JSON.parse(a.w.localStorage.getItem('ytCreatorProductionV1'));
    assert.equal(saved.blocks.length, 6); assert.equal(saved.blocks[0].wordCount, 73);
    assert.equal(saved.blocks[0].editing, initial[0].editing);
    assert.equal(saved.blocks[0].scenes[0].visual, initial[0].scenes[0].visual);
    assert.equal(saved.blocks[1].narration, initial[1].narration);
    assert.equal(a.$('creator-script-btn').textContent, '2. Generar guion y producción');
    assert.deepEqual(a.errors, []);
});

test('the reported 69-word transition is condensed alone without losing publishing or the other five blocks', async t => {
    const a = await scriptReady(t), slots = core.timeline(9), calls = [];
    const second = slots.slice(3).map(block); second[0] = countedBlock(slots[3], 69);
    a.w.smartFetchAI = async prompt => {
        calls.push(prompt);
        if (calls.length === 1) return { blocks: slots.slice(0, 3).map(block) };
        if (calls.length === 2) return { blocks: structuredClone(second), publishing: publishing() };
        return { blocks: [{ index: 3, narration: block(slots[3]).narration }] };
    };
    a.$('creator-script-btn').click(); await until(() => !a.$('creator-export-md').disabled);
    assert.equal(calls.length, 3);
    assert.deepEqual(corrections(calls[2]).map(c => [c.index, c.wordsReceived, c.minWords, c.maxWords, c.wordsToTarget]), [[3, 69, 24, 49, -33]]);
    const saved = JSON.parse(a.w.localStorage.getItem('ytCreatorProductionV1'));
    assert.equal(saved.blocks[3].wordCount, 36); assert.equal(saved.description, publishing().description);
    assert.equal(saved.blocks[4].narration, second[1].narration); assert.equal(saved.blocks[5].narration, second[2].narration);
});

test('repair batches shrink as blocks pass validation and missing repaired indices retain their previous drafts', async t => {
    const a = await scriptReady(t), slots = core.timeline(9), calls = [];
    a.w.smartFetchAI = async prompt => {
        calls.push(prompt);
        if (calls.length === 1) return { blocks: [countedBlock(slots[0], 42), block(slots[1]), countedBlock(slots[2], 100)] };
        if (calls.length === 2) return { blocks: [{ index: 0, narration: block(slots[0]).narration }] };
        if (calls.length === 3) return { blocks: [{ index: 2, narration: block(slots[2]).narration }] };
        return { blocks: slots.slice(3).map(block), publishing: publishing() };
    };
    a.$('creator-script-btn').click(); await until(() => !a.$('creator-export-md').disabled);
    assert.equal(calls.length, 4);
    assert.deepEqual(corrections(calls[1]).map(c => c.index), [0, 2]);
    assert.deepEqual(corrections(calls[2]).map(c => c.index), [2]);
    assert.deepEqual(a.errors, []);
});

test('malformed and duplicate block records are repaired as complete blocks without accepting ambiguous indices', async t => {
    const a = await scriptReady(t), slots = core.timeline(9), calls = [];
    a.w.smartFetchAI = async prompt => {
        calls.push(prompt);
        if (calls.length === 1) return { blocks: [null, block(slots[1]), block(slots[1])] };
        if (calls.length === 2) return { blocks: slots.slice(0, 3).map(block) };
        return { blocks: slots.slice(3).map(block), publishing: publishing() };
    };
    a.$('creator-script-btn').click(); await until(() => !a.$('creator-export-md').disabled);
    assert.equal(calls.length, 3);
    assert.deepEqual(corrections(calls[1]).map(c => [c.index, c.mode]), [[0, 'block'], [1, 'block'], [2, 'block']]);
    assert.deepEqual(a.errors, []);
});

test('exhausted repairs preserve the completed production and Continue repairs only pending blocks', async t => {
    const previous = core.validateProject(completeProject());
    const a = await scriptReady(t, { ytCreatorProductionV1: JSON.stringify(previous) }), slots = core.timeline(9), calls = [];
    a.w.smartFetchAI = async prompt => {
        calls.push(prompt);
        if (calls.length === 1) return { blocks: [countedBlock(slots[0], 42), block(slots[1]), block(slots[2])] };
        return { blocks: [{ index: 0, narration: countedBlock(slots[0], 42).narration }] };
    };
    a.$('creator-script-btn').click(); await until(() => !a.$('creator-package-btn').disabled);
    assert.equal(calls.length, 3); assert.match(a.$('creator-error').textContent, /42 palabras/);
    assert.match(a.$('creator-status').textContent, /2 de 6 bloques validados en esta página/);
    assert.equal(a.$('creator-script-btn').textContent, '2. Continuar guion y producción');
    assert.equal(a.w.localStorage.getItem('ytCreatorProductionV1'), JSON.stringify(previous));
    a.w.smartFetchAI = async prompt => {
        calls.push(prompt);
        if (corrections(prompt)) return { blocks: [{ index: 0, narration: block(slots[0]).narration }] };
        return { blocks: slots.slice(3).map(block), publishing: publishing() };
    };
    a.$('creator-script-btn').click(); await until(() => !a.$('creator-package-btn').disabled);
    assert.equal(calls.length, 5); assert.deepEqual(corrections(calls[3]).map(c => c.index), [0]);
    assert.match(calls[4], /Bloques a escribir: \[\{"index":3/);
    assert.equal(a.$('creator-error').textContent, '');
    assert.equal(JSON.parse(a.w.localStorage.getItem('ytCreatorProductionV1')).blocks[0].wordCount, 73);
});

test('a provider failure in the second part is not retried automatically and Continue retains the first three blocks', async t => {
    const a = await scriptReady(t), slots = core.timeline(9), calls = [];
    a.w.smartFetchAI = async prompt => {
        calls.push(prompt);
        if (calls.length === 1) return { blocks: slots.slice(0, 3).map(block) };
        throw new Error('Cuota agotada');
    };
    a.$('creator-script-btn').click(); await until(() => !a.$('creator-package-btn').disabled);
    assert.equal(calls.length, 2); assert.match(a.$('creator-error').textContent, /Cuota agotada/);
    assert.match(a.$('creator-status').textContent, /3 de 6/);
    a.w.smartFetchAI = async prompt => { calls.push(prompt); return { blocks: slots.slice(3).map(block), publishing: publishing() }; };
    a.$('creator-script-btn').click(); await until(() => !a.$('creator-export-md').disabled);
    assert.equal(calls.length, 3); assert.match(calls[2], /Bloques a escribir: \[\{"index":3/);
    assert.equal(corrections(calls[2]), null);
});

test('publishing gets one separate repair and can be resumed with all six accepted blocks intact', async t => {
    const previous = core.validateProject(completeProject());
    const a = await scriptReady(t, { ytCreatorProductionV1: JSON.stringify(previous) }), slots = core.timeline(9), calls = [];
    a.w.smartFetchAI = async prompt => {
        calls.push(prompt);
        if (calls.length <= 2) return { blocks: slots.slice(calls.length === 1 ? 0 : 3, calls.length === 1 ? 3 : 6).map(block) };
        return { publishing: { description: '', pinnedComment: '', checks: [] } };
    };
    a.$('creator-script-btn').click(); await until(() => !a.$('creator-package-btn').disabled);
    assert.equal(calls.length, 3); assert.match(calls[2], /CORRECCIÓN DE PUBLICACIÓN/);
    assert.match(a.$('creator-status').textContent, /6 de 6/);
    assert.equal(a.w.localStorage.getItem('ytCreatorProductionV1'), JSON.stringify(previous));
    a.w.smartFetchAI = async prompt => { calls.push(prompt); return { publishing: publishing() }; };
    a.$('creator-script-btn').click(); await until(() => !a.$('creator-package-btn').disabled);
    assert.equal(calls.length, 4); assert.match(calls[3], /CORRECCIÓN DE PUBLICACIÓN/);
    assert.equal(a.$('creator-error').textContent, '');
    assert.equal(JSON.parse(a.w.localStorage.getItem('ytCreatorProductionV1')).blocks.length, 6);
});

test('late selective repairs are discarded after Radar changes the evidence', async t => {
    const a = await scriptReady(t), slots = core.timeline(9);
    let release;
    a.w.smartFetchAI = async prompt => {
        if (!corrections(prompt)) return { blocks: [countedBlock(slots[0], 42), block(slots[1]), block(slots[2])] };
        return new Promise(resolve => { release = resolve; });
    };
    a.$('creator-script-btn').click(); await until(() => !!release);
    await a.scan('Nuevo nicho'); release({ blocks: [{ index: 0, narration: block(slots[0]).narration }] });
    await until(() => !a.$('creator-package-btn').disabled);
    assert.equal(a.w.localStorage.getItem('ytCreatorProductionV1'), null);
    assert.equal(a.$('creator-script-btn').disabled, true);
    assert.equal(a.$('creator-script-btn').textContent, '2. Generar guion y producción');
    assert.equal(a.$('creator-packaging').children.length, 0);
});

test('choosing another packaging variant discards a failed draft and generates fresh blocks for that promise', async t => {
    const a = await scriptReady(t), slots = core.timeline(9), calls = [];
    a.w.smartFetchAI = async prompt => {
        calls.push(prompt);
        if (calls.length === 1) return { blocks: slots.slice(0, 3).map(block) };
        throw new Error('Sin conexión');
    };
    a.$('creator-script-btn').click(); await until(() => !a.$('creator-package-btn').disabled);
    const option = a.$('creator-packaging').querySelector('input[value="1"]'); option.checked = true;
    option.dispatchEvent(new a.w.Event('change', { bubbles: true }));
    assert.equal(a.$('creator-script-btn').textContent, '2. Generar guion y producción');
    a.w.smartFetchAI = async prompt => {
        calls.push(prompt);
        return { blocks: slots.slice(calls.length === 3 ? 0 : 3, calls.length === 3 ? 3 : 6).map(block), publishing: publishing() };
    };
    a.$('creator-script-btn').click(); await until(() => !a.$('creator-export-md').disabled);
    assert.equal(calls.length, 4); assert.match(calls[2], /Bloques a escribir: \[\{"index":0/);
    assert.deepEqual(JSON.parse(calls[2].match(/\nEmpaquetado elegido: ([^\n]+)/)[1]), core.validatePackaging({ variants })[1]);
    assert.equal(JSON.parse(a.w.localStorage.getItem('ytCreatorProductionV1')).selected, 1);
});

test('late packaging is discarded when a new Radar scan changes its evidence', async t => {
    const a = app(t); await a.scan(); a.$('geminiApiKeyInput').value = 'fake-key';
    let release; a.w.smartFetchAI = () => new Promise(resolve => { release = resolve; });
    a.$('creator-topic').value = 'Tema anterior'; submit(a); await until(() => !!release);
    await a.scan('Nuevo nicho'); release({ variants: structuredClone(variants) });
    await until(() => !a.$('creator-package-btn').disabled);
    assert.equal(a.$('creator-packaging').children.length, 0); assert.equal(a.$('creator-script-btn').disabled, true);
});

test('channel comparison uses upload playlists, bounded details requests and no extra searches', async t => {
    const a = app(t); await a.scan(); const before = a.requests.filter(u => u.pathname.endsWith('/search')).length;
    a.controls.baselineChannels = [{ id: channelId, contentDetails: { relatedPlaylists: { uploads: 'uploads-one' } } }];
    a.controls.uploadVideos = fixtureVideos;
    const previousCalls = a.requests.length;
    a.$('creator-baselines').click(); await until(() => !a.$('creator-baselines').disabled);
    assert.equal(a.requests.filter(u => u.pathname.endsWith('/search')).length, before);
    assert.equal(a.requests.filter(u => u.pathname.endsWith('/playlistItems')).length, 1);
    assert.ok(a.requests.length - previousCalls <= 6); assert.match(a.$('creator-status').textContent, /Comparación ampliada/);
});

test('audit reads own AVD and retention with bearer OAuth, keeps CTR manual and clears private data on disconnect', async t => {
    const a = app(t); await a.scan(); a.evaluate('ytAnalyticsToken="private-test-token"; analyticsExpiresAt=Date.now()+3600000;');
    const originalFetch = a.w.fetch, privateRequests = [];
    a.w.fetch = async (input, options) => {
        const url = new URL(input);
        if (url.hostname !== 'youtubeanalytics.googleapis.com') return originalFetch(input, options);
        privateRequests.push({ url, options });
        const retention = url.searchParams.has('dimensions');
        return { ok: true, status: 200, json: async () => retention ? { columnHeaders: [{ name: 'elapsedVideoTimeRatio' }, { name: 'audienceWatchRatio' }], rows: [[.01, 1.1], [.05, .5], [.5, .4]] }
            : { columnHeaders: [{ name: 'views' }, { name: 'averageViewDuration' }, { name: 'averageViewPercentage' }], rows: [[1000, 240, 40]] } };
    };
    a.$('creator-audit-video').value = fixtureVideos[0].id;
    a.w.document.querySelector('[data-audit="ctr"]').value = '2'; a.w.document.querySelector('[data-audit="impressions"]').value = '10000';
    a.$('creator-audit-fetch').click(); await until(() => !a.$('creator-audit-fetch').disabled);
    assert.equal(privateRequests.length, 2); assert.equal(privateRequests[0].options.headers.Authorization, 'Bearer private-test-token');
    assert.ok(privateRequests.every(r => r.url.searchParams.get('filters') === 'video==' + fixtureVideos[0].id));
    assert.equal(a.w.document.querySelector('[data-audit="avd"]').value, '240');
    assert.equal(a.w.document.querySelector('[data-audit="loss30"]').value, '50'); assert.equal(a.w.document.querySelector('[data-audit="ctr"]').value, '2');
    assert.match(a.$('creator-audit-output').textContent, /supera 40%/); assert.match(a.$('creator-retention').textContent, /110.0%/);
    assert.ok(!JSON.stringify({ ...a.w.localStorage }).includes('private-test-token'));
    a.evaluate('disconnectAnalytics(false)'); assert.equal(a.w.document.querySelector('[data-audit="avd"]').value, ''); assert.equal(a.$('creator-retention').textContent, '');
});

test('a late private report cannot restore data after Analytics disconnect', async t => {
    const a = app(t); await a.scan(); a.evaluate('ytAnalyticsToken="private-test-token"; analyticsExpiresAt=Date.now()+3600000;');
    const originalFetch = a.w.fetch, release = [];
    a.w.fetch = async input => {
        const url = new URL(input);
        if (url.hostname !== 'youtubeanalytics.googleapis.com') return originalFetch(input);
        await new Promise(resolve => release.push(resolve));
        return { ok: true, status: 200, json: async () => ({ columnHeaders: [{ name: 'views' }, { name: 'averageViewDuration' }], rows: [[1000, 240]] }) };
    };
    a.$('creator-audit-video').value = fixtureVideos[0].id; a.$('creator-audit-fetch').click(); await until(() => release.length === 2);
    a.evaluate('disconnectAnalytics(false)'); release.forEach(resolve => resolve()); await until(() => !a.$('creator-audit-fetch').disabled);
    assert.equal(a.w.document.querySelector('[data-audit="avd"]').value, ''); assert.match(a.$('creator-audit-source').textContent, /desconectado/);
});

test('invalid production imports are atomic and private report failures do not reuse old video metrics', async t => {
    const previous = core.validateProject(completeProject());
    const a = app(t, { ytCreatorProductionV1: JSON.stringify(previous) });
    const input = a.$('creator-import-json');
    Object.defineProperty(input, 'files', { configurable: true, value: [{ size: 100, text: async () => JSON.stringify({ format: 'yt-creator-production', version: 2 }) }] });
    input.dispatchEvent(new a.w.Event('change')); await until(() => /incompatible/.test(a.$('creator-error').textContent));
    assert.equal(a.w.localStorage.getItem('ytCreatorProductionV1'), JSON.stringify(previous));
    await a.scan(); a.evaluate('ytAnalyticsToken="private-test-token"; analyticsExpiresAt=Date.now()+3600000;');
    a.$('creator-audit-video').value = fixtureVideos[0].id; a.w.document.querySelector('[data-audit="avd"]').value = '555';
    const original = a.w.fetch;
    a.w.fetch = async input => new URL(input).hostname === 'youtubeanalytics.googleapis.com' ? { ok: false, status: 403, json: async () => ({}) } : original(input);
    a.$('creator-audit-fetch').click(); await until(() => !a.$('creator-audit-fetch').disabled);
    assert.equal(a.w.document.querySelector('[data-audit="avd"]').value, '');
    assert.match(a.$('creator-error').textContent, /No hay datos/);
});

test('keyboard tabs, local scenario and manual audit work without AI', t => {
    const a = app(t); a.$('creator-tab-highlights').dispatchEvent(new a.w.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    assert.equal(a.$('creator-tab-studio').getAttribute('aria-selected'), 'true');
    a.change('research-rpm', '0'); assert.match(a.$('creator-scenario-output').textContent, /0.00/);
    for (const [key, value] of Object.entries({ hours: 60, ctr: 2, impressions: 10000, loss30: 50 })) a.w.document.querySelector('[data-audit="' + key + '"]').value = value;
    a.$('creator-audit-form').dispatchEvent(new a.w.Event('submit', { cancelable: true }));
    assert.match(a.$('creator-audit-output').textContent, /miniatura/); assert.match(a.$('creator-audit-output').textContent, /supera 40%/); assert.equal(a.requests.length, 0);
});
