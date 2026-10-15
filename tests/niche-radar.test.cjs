const test = require('node:test');
const assert = require('node:assert/strict');
const { app, until, fixtureVideos } = require('./helpers/app.cjs');
const { variants, completeProject } = require('./helpers/creator-fixtures.cjs');
const creator = require('../creator-core.js');
const core = require('../niche-core.js');
const dataKey = 'ytNicheRadarV1';
function cached() {
    const rows = core.CATALOG.map(n => ({ id: n.id, videos: core.sample(fixtureVideos, {}, {}) }));
    return core.snapshot({ format: 'yt-niche-radar', version: 1, updatedAt: new Date().toISOString(), filters: core.filters(), complete: true, rows });
}
function submit(a) { a.$('niche-form').dispatchEvent(new a.w.Event('submit', { cancelable: true })); }
async function update(a) { a.$('ytApiKeyInput').value = 'fake-yt-key'; submit(a); await until(() => a.$('niche-panel').getAttribute('aria-busy') === 'false'); }
const searches = a => a.requests.filter(u => u.pathname.endsWith('/search'));

test('opening the app selects a soft dark theme, does not query providers and restores only known themes', t => {
    const a = app(t); assert.equal(a.w.document.documentElement.dataset.theme, 'graphite'); assert.equal(a.requests.length, 0);
    assert.equal(a.w.document.querySelectorAll('[data-niche-rpm]').length, 20);
    assert.equal(a.$('niche-export').disabled, true); assert.equal(a.w.document.querySelectorAll('.niche-card').length, 0);
    a.change('studio-theme', 'warm'); assert.equal(a.w.localStorage.getItem('ytStudioThemeV1'), 'warm');
    const b = app(t, { ytStudioThemeV1: 'warm', [dataKey]: JSON.stringify(cached()) });
    assert.equal(b.w.document.documentElement.dataset.theme, 'warm'); assert.equal(b.$('studio-theme').value, 'warm');
    assert.equal(b.requests.length, 0); assert.equal(b.w.document.querySelectorAll('.niche-card').length, 10);
    const c = app(t, { ytStudioThemeV1: 'white', [dataKey]: 'invalid JSON' });
    assert.equal(c.w.document.documentElement.dataset.theme, 'graphite'); assert.equal(c.w.document.querySelectorAll('.niche-card').length, 0);
});

test('a ranking needs only a YouTube key, limits searches and details, escapes sources and never calls AI', async t => {
    const a = app(t); submit(a); assert.match(a.$('niche-error').textContent, /YouTube API Key/); assert.equal(a.requests.length, 0);
    await update(a);
    assert.equal(searches(a).length, 20); assert.equal(new Set(searches(a).map(u => u.searchParams.get('q'))).size, 20);
    assert.ok(a.requests.length <= 60); assert.ok(a.requests.every(u => u.hostname === 'www.googleapis.com'));
    for (const url of searches(a)) {
        for (const [name, value] of Object.entries({ part: 'snippet', type: 'video', regionCode: 'MX', relevanceLanguage: 'es', videoDuration: 'medium', maxResults: '20', order: 'relevance' })) assert.equal(url.searchParams.get(name), value);
        assert.ok(url.searchParams.has('publishedAfter'));
    }
    assert.equal(a.w.document.querySelectorAll('.niche-card').length, 10); assert.equal(a.$('niche-stop').disabled, true);
    assert.match(a.$('niche-results').textContent, /Sin historial suficiente/); assert.match(a.$('niche-results').textContent, /3 de 3 videos con subs visibles/);
    assert.equal(a.$('niche-results').querySelector('img'), null);
    assert.ok(!a.w.localStorage.getItem(dataKey).includes('fake-yt-key')); assert.ok(!a.w.localStorage.getItem('ytNicheHistoryV1').includes('fake-yt-key'));
    a.$('niche-export').click(); const report = await a.downloads[0].blob.text();
    assert.match(report, /supuestos manuales/); assert.match(report, /https:\/\/www.youtube.com\/watch\?v=video/); assert.ok(!report.includes('fake-yt-key'));
    assert.deepEqual(a.errors, []);
});

test('filter changes flag an old scope while financial overrides recalculate without new requests and survive reload', async t => {
    const a = app(t, { [dataKey]: JSON.stringify(cached()) });
    a.change('niche-region', 'US'); assert.equal(a.$('niche-context-warning').hidden, false);
    assert.ok([...a.w.document.querySelectorAll('[data-niche-action]')].every(el => el.disabled)); assert.equal(a.requests.length, 0);
    a.change('niche-region', 'MX'); assert.equal(a.$('niche-context-warning').hidden, true);
    a.change('niche-rpm', '0'); a.change('niche-cost', '5'); a.change('niche-order', 'margin');
    const rpm = a.w.document.querySelector('[data-niche-rpm="archviz"]'); rpm.value = '8'; rpm.dispatchEvent(new a.w.Event('change', { bubbles: true }));
    assert.equal(a.$('niche-results').querySelector('[data-niche-id]').dataset.nicheId, 'archviz');
    assert.match(a.$('niche-results').querySelector('.niche-margin strong').textContent, /75\.00/); assert.equal(a.requests.length, 0);
    const b = app(t, { [dataKey]: a.w.localStorage.getItem(dataKey), ytNicheSettingsV1: a.w.localStorage.getItem('ytNicheSettingsV1') });
    assert.equal(b.$('niche-rpm').value, '0'); assert.equal(b.$('niche-results').querySelector('[data-niche-id]').dataset.nicheId, 'archviz'); assert.equal(b.requests.length, 0);
});

test('cancel stops after in-flight searches, ignores duplicate submits and preserves the last ranking', async t => {
    const saved = JSON.stringify(cached()), a = app(t, { [dataKey]: saved });
    a.$('ytApiKeyInput').value = 'fake-yt-key'; a.controls.holdSearch = true; submit(a); submit(a);
    await until(() => a.controls.waitingSearch.length === 2); a.$('niche-stop').click();
    a.controls.waitingSearch.splice(0).forEach(resolve => resolve()); await until(() => a.$('niche-panel').getAttribute('aria-busy') === 'false');
    assert.equal(searches(a).length, 2); assert.equal(a.requests.length, 2); assert.equal(a.w.localStorage.getItem(dataKey), saved);
    assert.match(a.$('niche-status').textContent, /detenida/); assert.equal(a.$('niche-update').disabled, false);
});

test('quota errors stop further calls and preserve the last sample without echoing a key', async t => {
    const saved = JSON.stringify(cached()), a = app(t, { [dataKey]: saved }); a.controls.quotaError = true; await update(a);
    assert.ok(searches(a).length <= 2); assert.equal(a.w.localStorage.getItem(dataKey), saved);
    assert.match(a.$('niche-error').textContent, /cuota/i); assert.ok(!a.$('niche-error').textContent.includes('fake-yt-key'));
    assert.match(a.$('niche-status').textContent, /no se reintenta automáticamente/); assert.equal(a.$('niche-update').disabled, false);
});

test('partial failures exclude failed rows; empty searches preserve the last usable snapshot', async t => {
    const a = app(t);
    a.evaluate('window.originalNicheFetch = youtubeClient.fetchJson; youtubeClient.fetchJson = async url => {if(new URL(url).searchParams.get("q") === NicheCore.CATALOG[0].queries.es) throw new Error("Servicio temporalmente no disponible"); return window.originalNicheFetch(url);};');
    await update(a); const stored = JSON.parse(a.w.localStorage.getItem(dataKey));
    assert.equal(stored.complete, false); assert.equal(stored.rows.find(r => r.id === 'finance').videos.length, 0); assert.match(a.$('niche-status').textContent, /Ranking parcial: 1/);
    const b = app(t, { [dataKey]: JSON.stringify(cached()) }), old = b.w.localStorage.getItem(dataKey);
    b.evaluate('youtubeClient.fetchJson = async () => ({items:[]});'); await update(b);
    assert.equal(b.w.localStorage.getItem(dataKey), old); assert.match(b.$('niche-error').textContent, /No hubo una muestra elegible/);
});

test('preparing a script passes dated niche references, preserves the last production and starts AI only after an explicit click', async t => {
    const previous = creator.validateProject(completeProject()), stored = cached();
    stored.rows = stored.rows.map(row => ({ ...row, videos: row.videos.map(v => ({ ...v, title: 'Nicho seleccionado' })) }));
    const a = app(t, { [dataKey]: JSON.stringify(stored), ytCreatorProductionV1: JSON.stringify(previous) });
    let calls = []; a.w.smartFetchAI = async prompt => { calls.push(prompt); return { variants }; };
    a.$('niche-results').querySelector('[data-niche-action="script"]').click();
    assert.equal(calls.length, 0); assert.equal(a.requests.length, 0); assert.equal(a.w.localStorage.getItem('ytCreatorProductionV1'), JSON.stringify(previous));
    assert.match(a.$('creator-context').textContent, /Top 10/);
    a.$('geminiApiKeyInput').value = 'fake-offline-key'; a.$('creator-package-btn').click(); await until(() => !a.$('creator-package-btn').disabled);
    assert.equal(calls.length, 1); assert.match(calls[0], /Nicho seleccionado/); assert.match(calls[0], /capturedAt/);
    assert.equal(a.w.localStorage.getItem('ytCreatorProductionV1'), JSON.stringify(previous));
});

test('Analyze sends the chosen scope to the research Radar and respects creator and research busy locks', async t => {
    const a = app(t, { [dataKey]: JSON.stringify(cached()) }); a.$('ytApiKeyInput').value = 'fake-yt-key';
    const query = core.CATALOG.find(n => n.id === a.$('niche-results').querySelector('[data-niche-id]').dataset.nicheId).queries.es;
    a.$('niche-results').querySelector('[data-niche-action="analyze"]').click(); await until(() => !a.evaluate('researchState.busy'));
    assert.equal(a.$('research-input').value, query); assert.equal(a.$('research-region').value, 'MX'); assert.ok(searches(a).some(u => u.searchParams.get('q') === query));
    a.$('creator-package-btn').disabled = true; a.w.document.dispatchEvent(new a.w.CustomEvent('creator-busy', { detail: true }));
    assert.equal(a.$('niche-update').disabled, true); assert.ok([...a.w.document.querySelectorAll('[data-niche-action]')].every(el => el.disabled));
});

test('storage errors leave a downloadable in-memory ranking and corrupted snapshots never render fabricated rows', async t => {
    const a = app(t); a.w.Storage.prototype.setItem = () => { throw new Error('Quota storage'); }; await update(a);
    assert.equal(a.w.document.querySelectorAll('.niche-card').length, 10); assert.match(a.$('niche-status').textContent, /no se pudo guardar/);
    a.$('niche-export').click(); assert.equal(a.downloads.length, 1);
    const b = app(t, { [dataKey]: JSON.stringify({ format: 'yt-niche-radar', version: 1, rows: [{ id: 'invented' }] }) });
    assert.equal(b.w.document.querySelectorAll('.niche-card').length, 0); assert.equal(b.w.localStorage.getItem(dataKey), null);
});
