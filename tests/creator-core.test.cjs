const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../creator-core.js');
const { variants, block, completeProject } = require('./helpers/creator-fixtures.cjs');
function signal(i, views, channelId = 'same-channel', days = 10, durationSec = 600) {
    return { video: { id: 'video' + String(i).padStart(6, '0'), snippet: { title: 'Software productividad ' + i, channelId, channelTitle: 'Canal', publishedAt: '2026-09-23T00:00:00Z', tags: ['productividad'] } },
        views, days, durationSec, vpd: views / days, opportunity: 60 };
}

test('outliers use other videos of the same channel and duration group; insufficient comparisons stay provisional', () => {
    const candidates = [signal(0, 1000), signal(1, 1000), signal(2, 1000), signal(3, 5000), signal(4, 999999, 'other'), signal(5, 999999, 'same-channel', 10, 60)];
    const result = core.highlights(candidates);
    const outlier = result.find(r => r.id === 'video000003');
    assert.equal(outlier.ratio, 5); assert.equal(outlier.peerCount, 3); assert.equal(outlier.atypical, true);
    assert.equal(result.find(r => r.id === 'video000004').ratio, null);
    assert.equal(core.highlights([signal(0, 1000, 'same', .5)]).length, 0);
});

test('keyword evidence counts each video once and only cohort readings imply acceleration', () => {
    const result = core.keywordSignals([signal(0, 1000), signal(1, 2000)], ['productividad para arquitectos'], () => ({ perDay: 10, verdict: { label: 'Acelerando' } }));
    const term = result.find(r => r.term === 'productividad');
    assert.equal(term.mentions, 2); assert.equal(term.accelerating, 2); assert.equal(term.observedVpd, 20);
    const suggested = result.find(r => r.suggestion); assert.equal(suggested.mentions, 0); assert.equal(suggested.measuredVideos, 0);
    assert.ok(result.every(r => r.score >= 0 && r.score <= 100));
    assert.equal(core.keywordSignals([signal(0, 1000)])[0].accelerating, 0);
});

test('daily ideas are stable within the configured local day and change with audience, date or sample', () => {
    const p = core.profile({ niche: 'Software', audience: 'Principiantes', timeZone: 'America/Mexico_City' });
    assert.equal(core.dayKey(new Date('2026-10-04T02:00:00Z'), p.timeZone), '2026-10-03');
    const a = core.dailyIdeas(p, [], [], new Date('2026-10-03T18:00:00Z'));
    assert.deepEqual(a, core.dailyIdeas(p, [], [], new Date('2026-10-03T19:00:00Z')));
    assert.notEqual(a[0].id, core.dailyIdeas(p, [], [], new Date('2026-10-04T18:00:00Z'))[0].id);
    assert.notEqual(a[0].id, core.dailyIdeas({ ...p, audience: 'Profesionales' }, [], [], new Date('2026-10-03T18:00:00Z'))[0].id);
    assert.equal(a.length, 5); assert.ok(a.every(i => Array.from(i.title).length < 50));
    assert.notEqual(core.fingerprint(p, [signal(0, 1000)]), core.fingerprint(p, [signal(0, 1001)]));
});

test('profile validates URLs and timezone, preserves a zero RPM and labels niche ranges as assumptions', () => {
    const p = core.profile({ rpm: 0, timeZone: 'invalid', affiliateUrl: 'javascript:alert(1)', leadUrl: 'https://example.test/guia', duration: 100 });
    assert.equal(p.rpm, 0); assert.equal(p.affiliateUrl, ''); assert.equal(p.duration, 10); assert.equal(p.timeZone, 'America/Mexico_City');
    assert.match(core.rpmGuidance('Finanzas y software').note, /no es un RPM observado/);
    assert.equal(core.rpmGuidance('Mascotas').referenceRange, null);
});

test('all supported durations have six continuous blocks, a five-second hook and a natural transition', () => {
    for (const duration of [8, 9, 10]) {
        const slots = core.timeline(duration);
        assert.equal(slots.length, 6); assert.equal(slots[0].start, 0); assert.equal(slots.at(-1).end, duration * 60);
        slots.slice(1).forEach((slot, i) => assert.equal(slot.start, slots[i].end));
        assert.equal(slots[3].end - slots[3].start, 15);
        const validated = core.validateBlocks({ blocks: slots.map(block) }, slots, ['video000000']);
        assert.deepEqual(validated[0].sourceIds, ['video000000']);
        assert.ok(core.editingCues(validated).every(c => c.duration > 0 && c.duration <= 5));
        assert.equal(core.editingCues(validated).at(-1).second + core.editingCues(validated).at(-1).duration, duration * 60);
    }
});

test('packaging rejects long titles, duplicated thumbnail text and more than three visual elements', () => {
    assert.equal(core.validatePackaging({ variants }).length, 3);
    const change = mutation => { const v = structuredClone(variants); mutation(v[0]); return { variants: v }; };
    assert.throws(() => core.validatePackaging(change(v => { v.title = 'a'.repeat(50); })), /50/);
    assert.throws(() => core.validatePackaging(change(v => { v.thumbnail.elements.push('Fourth'); })), /tres/);
    assert.throws(() => core.validatePackaging(change(v => { v.thumbnail.text = v.title; })), /complementar/);
});

test('short outlines and missing image/video prompts are rejected instead of labelled as a complete script', () => {
    const slots = core.timeline(9).slice(0, 3), blocks = slots.map(block);
    blocks[1].narration = 'Un esquema corto.';
    assert.throws(() => core.validateBlocks({ blocks }, slots, []), /palabras/);
    blocks[1] = block(slots[1]); blocks[2].scenes[0].videoPrompt = '';
    assert.throws(() => core.validateBlocks({ blocks }, slots, []), /videoPrompt/);
});

test('the hook must open the actual narration and the invisible outro rejects direct goodbyes', () => {
    const slots = core.timeline(9), blocks = slots.map(block);
    blocks[0].narration = 'Hola amigos. ' + blocks[0].narration;
    assert.throws(() => core.validateBlocks({ blocks }, slots, []), /sin saludo/);
    blocks[0] = block(slots[0]); blocks[5].narration += ' Gracias por ver.';
    assert.throws(() => core.validateBlocks({ blocks }, slots, []), /sin despedida/);
});

test('production backups whitelist fields, reconstruct source URLs and export every scene and editing cue', () => {
    const dirty = completeProject(); dirty.apiKey = 'secret'; dirty.profile.apiKey = 'secret'; dirty.sources[0].url = 'javascript:alert(1)'; dirty.sources[0].transcriptText = 'private transcript';
    const clean = core.validateProject(dirty), encoded = JSON.stringify(clean);
    assert.ok(!encoded.includes('secret')); assert.ok(!encoded.includes('private transcript')); assert.ok(!encoded.includes('javascript:'));
    assert.deepEqual(core.validateProject(JSON.parse(encoded)), clean);
    const md = core.productionMarkdown(clean);
    assert.match(md, /### 0:00–0:30/); assert.match(md, /Imagen \(EN\)/); assert.match(md, /Hoja de edición/); assert.match(md, /48–72/);
    assert.throws(() => core.validateProject({ ...dirty, version: 2 }), /incompatible/);
});

test('revenue stacking is an explicit scenario with zero default conversions and finite caps', () => {
    assert.equal(core.revenueScenario({ views: 10000, rpm: 0 }).total, 0);
    const r = core.revenueScenario({ views: 10000, rpm: 10, affiliateCtr: 2, affiliateConversion: 5, commission: 20, sponsorFee: 500, leadRate: 1, saleRate: 10, productNet: 30 });
    assert.equal(r.ads, 100); assert.equal(r.affiliate, 200); assert.equal(r.product, 300); assert.equal(r.total, 1100);
});

test('audit distinguishes missing from zero data, gives early-reading context and prioritizes hook/CTR problems', () => {
    const p = core.profile({ ctrTarget: 8, avpTarget: 45 });
    const result = core.audit({ hours: 60, ctr: 2, impressions: 10000, avp: 30, loss30: 50 }, p);
    assert.ok(result.actions.some(a => /miniatura/.test(a))); assert.ok(result.actions.some(a => /supera 40%/.test(a)));
    assert.ok(core.audit({ hours: 10, ctr: 0 }, p).actions.some(a => /preliminar/.test(a)));
    assert.equal(core.audit({}, p).ctr, null); assert.equal(core.audit({ ctr: 0 }, p).ctr, 0);
});
