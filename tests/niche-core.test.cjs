const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../niche-core.js');
const now = Date.parse('2026-10-07T12:00:00Z'), { DAY } = core;
const channel = 'UC' + 'a'.repeat(22);
const id = i => 'niche' + String(i).padStart(6, '0');
function video(i = 0, views = 1000, subscribers = 500) {
    return { id: id(i), title: 'Referencia ' + i, channel: 'Canal', channelId: channel,
        publishedAt: new Date(now - 10 * DAY).toISOString(), capturedAt: new Date(now).toISOString(), views, durationSec: 600, subscribers };
}
function saved(rows) { return { format: 'yt-niche-radar', version: 1, updatedAt: new Date(now).toISOString(), filters: core.filters(), complete: true, rows }; }
function api(i, changes = {}) {
    return { id: id(i), snippet: { title: 'Referencia', channelId: channel, channelTitle: 'Canal', publishedAt: new Date(now - 10 * DAY).toISOString(), liveBroadcastContent: 'none', ...changes.snippet },
        statistics: { viewCount: '1000', ...changes.statistics }, contentDetails: { duration: 'PT10M', ...changes.contentDetails } };
}

test('twenty candidates have multilingual queries but no invented niche-specific RPM', () => {
    assert.equal(core.CATALOG.length, 20); assert.equal(new Set(core.CATALOG.map(n => n.id)).size, 20);
    for (const n of core.CATALOG) { for (const language of ['es', 'en', 'pt']) assert.ok(n.queries[language]); assert.equal(n.rpm, undefined); }
    assert.equal(core.rank(saved([]), {}, {}, now).top.length, 0);
    assert.deepEqual(core.filters({ region: 'invalid', language: 'xx', days: 1, duration: 'all' }), core.filters());
});

test('public samples exclude recent, old, live, missing and duplicate results while retaining zero views', () => {
    const input = [api(0), api(0), api(1, { snippet: { publishedAt: new Date(now - DAY / 2).toISOString() } }),
        api(2, { snippet: { publishedAt: new Date(now - 31 * DAY).toISOString() } }), api(3, { snippet: { liveBroadcastContent: 'upcoming' } }),
        api(4, { statistics: { viewCount: undefined } }), api(5, { contentDetails: { duration: 'invalid' } }),
        api(6, { statistics: { viewCount: '0' } }), api(7, { contentDetails: { duration: 'PT2M' } }), api(8, { contentDetails: { duration: 'PT21M' } })];
    const rows = core.sample(input, { [channel]: { statistics: { subscriberCount: '0', hiddenSubscriberCount: false } } }, {}, now);
    assert.deepEqual(rows.map(v => v.id), [id(0), id(6)]); assert.equal(rows[1].views, 0); assert.equal(rows[0].subscribers, 0);
    for (const statistics of [{ subscriberCount: '500', hiddenSubscriberCount: true }, { subscriberCount: '500' }, {}])
        assert.equal(core.sample([api(0)], { [channel]: { statistics } }, {}, now)[0].subscribers, null);
    assert.equal(core.sample([api(0)], {}, {}, now)[0].subscribers, null);
    assert.equal(core.sample(input, {}, { duration: 'short' }, now).length, 1);
    assert.equal(core.sample(input, {}, { duration: 'long' }, now).length, 1);
    assert.equal(core.duration('P1DT2H3M4.5S'), 93784.5);
});

test('median demand limits viral outliers, hidden subscribers are excluded and margins are explicitly manual', () => {
    const data = saved([{ id: 'ai', videos: [video(0, 1000, null), video(1, 2000, 500), video(2, 99999999, 200000)] },
        { id: 'gaming', videos: [video(3, 0, null)] }]);
    const ranked = core.rank(data, { rpm: 0, cost: 7, views: 10000 }, {}, now);
    const ai = ranked.rows.find(n => n.id === 'ai'), gaming = ranked.rows.find(n => n.id === 'gaming');
    assert.equal(ai.medianVpd, 200); assert.equal(ai.access, .5); assert.equal(ai.knownCount, 2); assert.equal(ai.smallCount, 1);
    assert.equal(gaming.access, null); assert.equal(gaming.accessScore, 50);
    assert.equal(ai.rpm, 0); assert.equal(ai.adRevenue, 0); assert.equal(ai.margin, -7); assert.equal(ai.marginScore, 50);
    assert.equal(ai.financialSource, 'Supuesto general'); assert.equal(ai.growthRatio, null); assert.equal(ai.growthLabel, 'Sin historial suficiente');
    assert.equal(ai.confidence, 'Escasa'); assert.equal(ranked.top.length, 2);
});

test('overrides reorder financial scenarios and allow zero; ties remain neutral; affinity is opt-in', () => {
    const data = saved([{ id: 'gaming', videos: [video(0)] }, { id: 'archviz', videos: [video(1)] }]);
    let result = core.rank(data, { interests: 'arquitectura blender', overrides: { gaming: { rpm: 0, cost: 0 }, archviz: { rpm: 8, cost: 2 }, unknown: { rpm: 500 } }, order: 'margin' }, {}, now);
    assert.equal(result.top[0].id, 'archviz'); assert.equal(result.top[0].margin, 78); assert.equal(result.top[1].margin, 0);
    assert.equal(result.top[0].financialSource, 'Supuesto por nicho'); assert.equal(result.settings.overrides.unknown, undefined);
    result = core.rank(data, { interests: 'arquitectura blender' }, {}, now);
    assert.equal(result.rows[0].score, result.rows[1].score); assert.ok(result.rows.every(n => n.demandScore === 50 && n.marginScore === 50));
    result = core.rank(data, { interests: 'arquitectura blender', affinity: true }, {}, now);
    assert.equal(result.top[0].id, 'archviz'); assert.equal(result.top[0].affinity, 100);
    assert.equal(core.settings({ rpm: -1, cost: 'not a number', views: 1e12 }).rpm, 3.5);
    assert.equal(core.settings({ views: 1e12 }).views, 10000000);
});

test('daily view history needs two three-day intervals, retains timestamp pairs and detects downward corrections', () => {
    let history = {};
    for (let i = 0; i <= 6; i++) {
        const timestamp = now - (6 - i) * DAY, v = { ...video(0, i <= 3 ? 1000 + i * 100 : 1300 + (i - 3) * 200), capturedAt: new Date(timestamp).toISOString() };
        history = core.recordHistory(history, [{ videos: [v] }], timestamp);
        const intermediate = core.rank(saved([{ id: 'ai', videos: [video(0)] }]), {}, history, now).top[0];
        if (i < 6) assert.equal(intermediate.growthRatio, null);
    }
    let row = core.rank(saved([{ id: 'ai', videos: [video(0)] }]), {}, history, now).top[0];
    assert.equal(row.growthRatio, 2); assert.equal(row.growthLabel, 'Acelerando'); assert.equal(row.growthCount, 1);
    const sameDay = core.recordHistory(history, [{ videos: [{ ...video(0, 9999), capturedAt: new Date(now + 1000).toISOString() }] }], now + 1000);
    assert.equal(sameDay[id(0)].length, 7); assert.deepEqual(sameDay[id(0)].at(-1), { t: now, v: 1900 });
    history[id(0)][4].v = 1200;
    row = core.rank(saved([{ id: 'ai', videos: [video(0)] }]), {}, history, now).top[0];
    assert.equal(row.growthRatio, null); assert.match(row.growthLabel, /Corrección/);
    const clean = core.history({ [id(0)]: [{ t: now - 31 * DAY, v: 10 }, { t: now, v: 100, apiKey: 'secret' }, { t: now, v: 101 }, { t: now + DAY, v: 200 }], invalid: [{ t: now, v: 200 }] }, now);
    assert.deepEqual(clean, { [id(0)]: [{ t: now, v: 100 }] });
});

test('stored samples reconstruct canonical sources, reject expired or duplicate data and strip unrelated secrets', () => {
    const data = saved([{ id: 'ai', videos: [{ ...video(0), url: 'javascript:alert(1)', apiKey: 'secret' }], error: 'secret' }]); data.apiKey = 'secret';
    const clean = core.snapshot(data, now);
    assert.equal(clean.rows[0].videos[0].url, 'https://www.youtube.com/watch?v=' + id(0)); assert.equal(clean.complete, false);
    assert.ok(!JSON.stringify(clean).includes('secret'));
    for (const bad of [{ ...data, version: 2 }, { ...data, updatedAt: new Date(now - 31 * DAY).toISOString() },
        { ...data, updatedAt: new Date(now + DAY).toISOString() }, { ...data, rows: [data.rows[0], data.rows[0]] },
        saved([{ id: 'ai', videos: [video(0), video(0)] }]), saved([{ id: 'unknown', videos: [] }])]) assert.throws(() => core.snapshot(bad, now));
    const row = core.rank(saved([{ id: 'ai', videos: [video(0)] }]), {}, {}, now).top[0];
    const selected = core.creatorSelection(row);
    assert.equal(selected.sources[0].capturedAt, video(0).capturedAt); assert.equal(selected.sources[0].transcript, false);
    assert.match(selected.angle, /no verifican ingresos/); assert.equal(selected.niche, row.label);
});
