const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../research-core.js');
const DAY = 86400000;
const id = 'abcdefghijk';
const url = key => core.youtubeUrl('search', { part: 'id', q: 'corona & iluminación', type: 'video' }, key);
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const entry = overrides => ({ id, title: 'Corona Renderer', channel: 'Tutoriales', topic: 'ArchViz', capturedAt: 1000, ...overrides });

test('repeated searches reuse a clone until TTL, and forced refresh reaches the API', async () => {
    let calls = 0, now = 0;
    const client = core.createYouTubeClient({ now: () => now, fetchImpl: async () => response({ items: [{ value: ++calls }] }) });
    const first = await client.fetchJson(url('key'));
    first.items[0].value = 999;
    assert.equal((await client.fetchJson(url('key'))).items[0].value, 1);
    assert.equal(calls, 1);
    now = 15 * 60000 + 1;
    assert.equal((await client.fetchJson(url('key'))).items[0].value, 2);
    await client.fetchJson(url('key'), { force: true });
    assert.equal(calls, 3);
    assert.equal(client.getStats().searchCalls, 3);
    assert.equal(client.getStats().cacheHits, 1);
});

test('concurrent identical requests share one call; keys isolate the cache', async () => {
    let calls = 0;
    const client = core.createYouTubeClient({ fetchImpl: async () => {
        calls++;
        await new Promise(resolve => setTimeout(resolve, 2));
        return response({ items: [] });
    }});
    await Promise.all([client.fetchJson(url('first')), client.fetchJson(url('first'))]);
    assert.equal(calls, 1);
    assert.equal(client.getStats().sharedRequests, 1);
    await client.fetchJson(url('second'));
    assert.equal(calls, 2);
});

test('details expire sooner than searches and clearing cache forces a new request', async () => {
    let now = 0, calls = 0;
    const client = core.createYouTubeClient({ now: () => now, fetchImpl: async () => { calls++; return response({ items: [] }); } });
    const details = core.youtubeUrl('videos', { part: 'statistics', id }, 'key');
    await client.fetchJson(details);
    now = 5 * 60000 + 1;
    await client.fetchJson(details);
    client.clearCache();
    await client.fetchJson(details);
    assert.equal(calls, 3);
    assert.equal(client.getStats().otherCalls, 3);
});

test('quota failures are not retried or cached, and messages never include the key', async () => {
    let calls = 0;
    const client = core.createYouTubeClient({ fetchImpl: async () => {
        calls++;
        return response({ error: { message: 'secret-key', errors: [{ reason: 'quotaExceeded' }] } }, 403);
    }});
    await assert.rejects(client.fetchJson(url('secret-key')), /cuota/);
    await assert.rejects(client.fetchJson(url('secret-key')), error => !error.message.includes('secret-key'));
    assert.equal(calls, 2);
    assert.equal(client.getStats().failedCalls, 2);
});

test('arbitrary hosts and write endpoints cannot receive credentials through the client', async () => {
    let calls = 0;
    const client = core.createYouTubeClient({ fetchImpl: async () => { calls++; return response({}); } });
    await assert.rejects(client.fetchJson('https://example.test/youtube/v3/search?key=private'), /no permitido/);
    await assert.rejects(client.fetchJson('https://www.googleapis.com/youtube/v3/videos/insert?key=private'), /no permitido/);
    await assert.rejects(client.fetchJson('https://www.googleapis.com/youtube/v3/search'), /API Key/);
    assert.equal(calls, 0);
});

test('slow API calls abort with a useful error and can be retried afterwards', async () => {
    const client = core.createYouTubeClient({ timeoutMs: 5, fetchImpl: async (_, { signal }) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }) });
    await assert.rejects(client.fetchJson(url('key')), /tardó demasiado/);
    assert.equal(client.getStats().failedCalls, 1);
});

test('filters encode special characters, omit empty values, and use a stable publication boundary', () => {
    const time = Date.UTC(2026, 9, 3, 12);
    const params = core.searchParams('3ds Max & luces', { max: 25, order: 'relevance' },
        { region: 'MX', language: 'es', days: '30', duration: 'medium', order: 'date' }, time);
    assert.equal(params.publishedAfter, '2026-09-03T00:00:00.000Z');
    assert.deepEqual(params, core.searchParams('3ds Max & luces', { max: 25, order: 'relevance' },
        { region: 'MX', language: 'es', days: '30', duration: 'medium', order: 'date' }, time + 3600000));
    const parsed = new URL(core.youtubeUrl('search', params, 'key&+?'));
    assert.equal(parsed.searchParams.get('q'), '3ds Max & luces');
    assert.equal(parsed.searchParams.get('key'), 'key&+?');
    assert.equal(parsed.searchParams.get('regionCode'), 'MX');
    assert.equal(parsed.searchParams.get('videoDuration'), 'medium');
    assert.equal(core.searchParams('x', { max: 10, order: 'relevance' }, { days: '-1', language: 'javascript:' }).publishedAfter, undefined);
});

test('a subscriber ceiling excludes hidden or missing subscriber data while allowing known zero', () => {
    const values = [
        { views: 100, subs: 0, subsKnown: false },
        { views: 100, subs: 0, subsKnown: true },
        { views: 100, subs: 200, subsKnown: true },
        { views: 1, subs: 20, subsKnown: true }
    ];
    assert.deepEqual(core.filterSignals(values, { minViews: 10, maxSubs: 100 }), [values[1]]);
    assert.equal(core.filterSignals(values, { minViews: 10, maxSubs: '' }).length, 3);
});

test('sorting preserves every result and the original ranking', () => {
    const signals = Array.from({ length: 50 }, (_, score) => ({ score, opportunity: 100 - score }));
    assert.equal(core.sortedSignals(signals, 'score')[0].score, 49);
    assert.equal(core.sortedSignals(signals, 'opportunity')[0].score, 0);
    assert.equal(core.sortedSignals(signals, 'score').length, 50);
    assert.equal(signals[0].score, 0);
});

test('zero RPM stays zero; empty or invalid values use the documented fallback', () => {
    assert.equal(core.rpm('0'), 0);
    assert.equal(core.rpm('4.25'), 4.25);
    for (const value of ['', null, '-5', 'NaN', Infinity]) assert.equal(core.rpm(value), 3.5);
});

test('re-searches preserve time/value pairs and corrupted cohort records do not crash recording', () => {
    const first = core.recordCohorts({ broken: {}, [id]: 'bad' }, [{ id, statistics: { viewCount: '100' } }], DAY * 10);
    const sameSession = core.recordCohorts(first, [{ id, statistics: { viewCount: '150' } }], DAY * 10 + 60000);
    assert.deepEqual(sameSession[id], [{ t: DAY * 10, v: 100 }]);
    const later = core.recordCohorts(sameSession, [{ id, statistics: { viewCount: '500' } }], DAY * 14);
    assert.equal(core.analyzeCohort(id, later, DAY * 14).perDay, 100);
    assert.equal(core.analyzeCohort(id, later, DAY * 14).verdict, null);
});

test('acceleration requires two sufficiently spaced intervals and corrections are labelled separately', () => {
    const samples = { [id]: [{ t: DAY, v: 100 }, { t: DAY * 4, v: 400 }, { t: DAY * 7, v: 1000 }] };
    assert.equal(core.analyzeCohort(id, samples, DAY * 7).verdict.label, 'Acelerando');
    samples[id].push({ t: DAY * 7 + 60000, v: 2000 });
    assert.equal(core.analyzeCohort(id, samples, DAY * 8).verdict.label, 'Acelerando');
    assert.equal(core.analyzeCohort(id, { [id]: [{ t: DAY, v: 1000 }, { t: DAY * 4, v: 500 }] }, DAY * 4).verdict.label, 'Corrección de vistas');
});

test('cohorts prune expired observations and never record unavailable view counts as zero', () => {
    const store = core.recordCohorts({ [id]: [{ t: 0, v: 100 }] }, [{ id, statistics: {} }], DAY * 181);
    assert.equal(store[id], undefined);
});

test('Excel export neutralizes formulas while preserving quotes, accents, and separators', () => {
    for (const value of ['=HYPERLINK("evil")', '+1+1', '-42', '@SUM(A1)', '  =1+1', '\tcmd']) {
        assert.ok(core.csvCell(value).startsWith('"\''));
    }
    assert.equal(core.csvCell('Iluminación; "Corona"'), '"Iluminación; ""Corona"""');
});

test('backups round-trip editorial work and whitelist fields, excluding API keys and tokens', () => {
    const backup = core.exportBoard([entry({ notes: 'Usar ejemplo propio', status: 'script', dueDate: '2026-10-04', apiKey: 'private', token: 'secret' })]);
    assert.equal(backup.includes('private'), false);
    assert.equal(backup.includes('secret'), false);
    const restored = core.importBoard(backup);
    assert.equal(restored[0].notes, 'Usar ejemplo propio');
    assert.equal(restored[0].status, 'script');
    assert.equal(restored[0].dueDate, '2026-10-04');
});

test('imports validate schema and ids atomically; duplicates preserve current notes', () => {
    assert.throws(() => core.importBoard('{bad'), /JSON/);
    assert.throws(() => core.importBoard(JSON.stringify({ format: 'other', entries: [] })), /respaldo/);
    assert.throws(() => core.importBoard(JSON.stringify({ format: 'yt-research-board', version: 1, entries: [entry(), entry({ id: '" onclick=' })] })), /inválida/);
    const merged = core.mergeBoard([entry({ notes: 'Actual', status: 'production' })], [entry({ notes: 'Antiguo' })]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].notes, 'Actual');
    assert.equal(merged[0].status, 'production');
});

test('board capacity is bounded and invalid dates do not enter the plan', () => {
    const entries = Array.from({ length: 101 }, (_, i) => entry({ id: String(i).padStart(11, '0') }));
    assert.throws(() => core.mergeBoard(entries, []), /hasta 100/);
    assert.equal(core.normalizeEntry(entry({ dueDate: '2026-02-31', status: '__proto__' })).dueDate, '');
    assert.equal(core.normalizeEntry(entry({ status: '__proto__' })).status, 'idea');
    assert.doesNotThrow(() => core.briefMarkdown(entry({ capturedAt: 1e100 })));
});

test('a free brief contains a valid source, editorial outline, notes, and clear metric limitations', () => {
    const brief = core.briefMarkdown(entry({ notes: 'Ejemplo en 3ds Max', status: 'script' }));
    assert.match(brief, /https:\/\/www.youtube.com\/watch\?v=abcdefghijk/);
    assert.match(brief, /Ejemplo en 3ds Max/);
    assert.match(brief, /Estado: Guion/);
    assert.match(brief, /sin IA/);
    assert.match(brief, /no mide CTR/);
});
