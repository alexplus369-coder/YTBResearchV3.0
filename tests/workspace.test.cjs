const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../research-core.js');
const { app, until, fixtureVideos } = require('./helpers/app.cjs');

test('startup restores a board without auto-connecting Analytics or exposing an old access token', t => {
    const saved = core.exportBoard([core.entryFromSignal({ video: fixtureVideos[0], views: 1000 }, 'Corona')]);
    const a = app(t, { ytAnalyticsToken: 'legacy-access-token', ytResearchBoardV1: JSON.stringify(core.importBoard(saved)), ytCohortSnapshots: '{invalid' });
    assert.equal(a.w.localStorage.getItem('ytAnalyticsToken'), null);
    assert.equal(a.$('board-list').querySelectorAll('article').length, 1);
    assert.equal(a.requests.length, 0);
    assert.deepEqual(a.errors, []);
});

test('Radar sends market/date/duration filters; numeric filters refine results without requests', async t => {
    const a = app(t);
    a.change('research-region', 'MX');
    a.change('research-language', 'es');
    a.change('research-days', '30');
    a.change('research-duration', 'medium');
    a.change('research-order', 'date');
    await a.scan('Corona & iluminación');
    const query = a.requests.find(url => url.pathname.endsWith('/search')).searchParams;
    for (const [key, value] of Object.entries({ q: 'Corona & iluminación', regionCode: 'MX', relevanceLanguage: 'es', videoDuration: 'medium', order: 'date' })) assert.equal(query.get(key), value);
    assert.ok(query.get('publishedAfter'));
    assert.equal(a.$('research-videos-table').children.length, 6);
    assert.equal(a.$('research-videos-table').querySelectorAll('img').length, 0);
    const calls = a.requests.length;
    a.change('research-min-views', '3000');
    assert.equal(a.$('research-videos-table').children.length, 4);
    a.change('research-max-subs', '1000');
    assert.equal(a.$('research-videos-table').children.length, 2);
    assert.equal(a.requests.length, calls);
    assert.match(a.$('research-result-count').textContent, /Mostrando 2 de 6/);
    assert.deepEqual(a.errors, []);
});

test('repeating a scan reuses all three public calls; forced refresh performs fresh requests', async t => {
    const a = app(t);
    await a.scan();
    const calls = a.requests.length;
    assert.equal(calls, 3);
    await a.scan();
    assert.equal(a.requests.length, calls);
    assert.match(a.$('youtube-usage').textContent, /3 reutilizadas/);
    a.$('research-force-refresh').checked = true;
    await a.scan();
    assert.equal(a.requests.length, 6);
    assert.equal(a.evaluate('Object.values(loadCohorts()).every(s => s.length === 1)'), true);
});

test('a concurrent submit cannot change the running scan or issue a second search', async t => {
    const a = app(t);
    a.controls.holdSearch = true;
    a.$('ytApiKeyInput').value = 'fake-yt-key';
    a.$('research-input').value = 'Corona';
    a.submit();
    await until(() => a.controls.waitingSearch.length === 1);
    a.$('research-input').value = 'Otra búsqueda';
    a.submit();
    assert.equal(a.requests.length, 1);
    assert.equal(a.evaluate('researchState.topic'), 'Corona');
    assert.equal(a.$('research-region').disabled, true);
    a.controls.holdSearch = false;
    a.controls.waitingSearch.shift()();
    await until(() => !a.evaluate('researchState.busy'));
    assert.equal(a.$('research-region').disabled, false);
});

test('saving a reference, editing its plan, and restoring a backup preserves editorial work', async t => {
    const a = app(t);
    await a.scan();
    a.$('research-videos-table').querySelector('[data-save-video]').click();
    const article = a.$('board-list').querySelector('article');
    const notes = article.querySelector('[data-board-field="notes"]');
    notes.value = '<script>usar mi ejemplo</script>';
    notes.dispatchEvent(new a.w.Event('change', { bubbles: true }));
    const date = article.querySelector('[data-board-field="dueDate"]');
    date.value = '2026-10-10';
    date.dispatchEvent(new a.w.Event('change', { bubbles: true }));
    const status = article.querySelector('[data-board-field="status"]');
    status.value = 'script';
    status.dispatchEvent(new a.w.Event('change', { bubbles: true }));
    assert.equal(a.$('board-list').querySelectorAll('script').length, 0);
    a.$('board-export-json').click();
    const backup = await a.downloads.at(-1).blob.text();
    assert.equal(backup.includes('fake-yt-key'), false);
    assert.equal(core.importBoard(backup)[0].status, 'script');
    assert.equal(core.importBoard(backup)[0].dueDate, '2026-10-10');
    const restored = app(t, { ytResearchBoardV1: a.w.localStorage.getItem('ytResearchBoardV1') });
    assert.equal(restored.$('board-list').querySelector('textarea').value, '<script>usar mi ejemplo</script>');
    restored.$('board-export-plan').click();
    const plan = await restored.downloads.at(-1).blob.text();
    assert.match(plan, /Fecha prevista: 2026-10-10/);
    assert.match(plan, /sin IA/);
    assert.equal(restored.requests.length, 0);
});

test('invalid imported backups leave the board unchanged; valid duplicates keep current notes', async t => {
    const a = app(t);
    await a.scan();
    a.$('research-videos-table').querySelector('[data-save-video]').click();
    const before = a.w.localStorage.getItem('ytResearchBoardV1');
    const input = a.$('board-import-json');
    Object.defineProperty(input, 'files', { configurable: true, value: [{ size: 5, text: async () => '{bad' }] });
    input.dispatchEvent(new a.w.Event('change'));
    await until(() => a.w.document.body.textContent.includes('no contiene JSON válido'));
    assert.equal(a.w.localStorage.getItem('ytResearchBoardV1'), before);
    const existing = JSON.parse(before)[0];
    Object.defineProperty(input, 'files', { configurable: true, value: [{ size: 500, text: async () => core.exportBoard([{ ...existing, notes: 'old' }]) }] });
    input.dispatchEvent(new a.w.Event('change'));
    await until(() => a.w.document.body.textContent.includes('0 referencias nuevas'));
    assert.equal(JSON.parse(a.w.localStorage.getItem('ytResearchBoardV1'))[0].notes, existing.notes);
});

test('zero RPM immediately recalculates visible estimates without re-querying YouTube', async t => {
    const a = app(t);
    await a.scan();
    const calls = a.requests.length;
    a.change('research-rpm', '0');
    assert.equal(a.evaluate('researchState.signals.every(s => s.estRevenue === 0)'), true);
    assert.equal(a.requests.length, calls);
    assert.equal(a.w.localStorage.getItem('ytResearchRpm'), '0');
});

test('Analytics requests revenue scopes, keeps tokens in memory, recalculates, and disconnects', async t => {
    const a = app(t);
    await a.scan();
    a.$('analytics-client-id').value = 'fake-client.apps.googleusercontent.com';
    a.$('analytics-connect-btn').click();
    await until(() => !a.$('analytics-rpm-badge').classList.contains('hidden'));
    assert.match(a.controls.oauthScope, /yt-analytics-monetary.readonly/);
    assert.match(a.controls.oauthScope, /youtube.readonly/);
    assert.equal(a.w.localStorage.getItem('ytAnalyticsToken'), null);
    assert.equal(a.evaluate('researchState.rpm'), 5);
    assert.equal(a.evaluate('researchState.signals.every(s => s.estRevenue === s.views / 1000 * 5)'), true);
    a.$('analytics-disconnect-btn').click();
    assert.equal(a.controls.revocations, 1);
    assert.equal(a.evaluate('ytAnalyticsToken'), null);
    assert.equal(a.evaluate('researchState.rpm'), 3.5);
    assert.equal(a.$('analytics-output').textContent, '');
    assert.equal(a.$('analytics-rpm-badge').classList.contains('hidden'), true);
});

test('CSV follows the visible sort and includes all rows with Excel formula protection', async t => {
    const a = app(t);
    await a.scan();
    a.change('research-videos-sort', 'vpd');
    a.w.exportResearchCsv();
    const csv = await a.downloads.at(-1).blob.text();
    const lines = csv.split('\r\n');
    assert.equal(lines.length, a.$('research-videos-table').children.length + 1);
    assert.match(csv, /"'=HYPERLINK/);
    assert.match(csv, /Horas maximas teoricas/);
    assert.ok(lines[1].includes(fixtureVideos[5].id));
});

test('a manual RPM edit survives disconnect and a late OAuth callback cannot reconnect', async t => {
    const a = app(t);
    await a.scan();
    a.$('analytics-client-id').value = 'fake-client.apps.googleusercontent.com';
    a.$('analytics-connect-btn').click();
    await until(() => !a.$('analytics-rpm-badge').classList.contains('hidden'));
    a.change('research-rpm', '0');
    a.controls.holdOAuth = true;
    a.$('analytics-connect-btn').click();
    await until(() => a.controls.waitingOAuth.length === 1);
    a.$('analytics-disconnect-btn').click();
    const calls = a.requests.length;
    a.controls.waitingOAuth.shift()();
    assert.equal(a.evaluate('ytAnalyticsToken'), null);
    assert.equal(a.evaluate('researchState.rpm'), 0);
    assert.equal(a.$('analytics-rpm-badge').classList.contains('hidden'), true);
    assert.equal(a.$('analytics-connect-btn').disabled, false);
    assert.equal(a.requests.length, calls);
});

test('the existing niche analysis still works without Gemini or DeepSeek', async t => {
    const a = app(t);
    a.$('ytApiKeyInput').value = 'fake-yt-key';
    a.$('keyword').value = 'Corona';
    a.$('search-form').dispatchEvent(new a.w.Event('submit', { cancelable: true }));
    await until(() => !a.$('search-btn').disabled);
    assert.equal(a.$('dashboard').classList.contains('hidden'), false);
    assert.equal(a.$('competitors-table').children.length, 6);
    assert.equal(a.requests.some(url => url.hostname !== 'www.googleapis.com'), false);
    assert.match(a.$('intent-analysis').textContent, /Conecta una API de IA/);
    assert.equal(a.$('competitors-table').querySelectorAll('img').length, 0);
    assert.deepEqual(a.errors, []);
});

test('quota errors release the form, clear stale results, and avoid retry storms', async t => {
    const a = app(t);
    await a.scan();
    a.controls.quotaError = true;
    const calls = a.requests.length;
    a.$('research-input').value = 'Otra keyword';
    a.submit();
    await until(() => !a.evaluate('researchState.busy'));
    assert.equal(a.requests.length, calls + 1);
    assert.match(a.$('research-error').textContent, /cuota/);
    assert.equal(a.$('research-results').classList.contains('hidden'), true);
    assert.equal(a.evaluate('researchState.signals.length'), 0);
    assert.equal(a.$('research-region').disabled, false);
    assert.equal(a.$('research-error').textContent.includes('fake-yt-key'), false);
});

test('late comment analysis cannot overwrite a newer scan', async t => {
    const a = app(t);
    await a.scan('Primera keyword');
    a.$('geminiApiKeyInput').value = 'fake-ai-key';
    a.controls.holdAI = true;
    const mining = a.w.mineComments();
    await until(() => a.controls.waitingAI.length === 1);
    await a.scan('Nueva keyword');
    a.controls.waitingAI.shift()();
    await mining;
    assert.equal(a.$('research-comments-output').classList.contains('hidden'), true);
    assert.equal(a.$('research-comments-output').textContent, '');
    assert.equal(a.evaluate('researchState.topic'), 'Nueva keyword');
});
