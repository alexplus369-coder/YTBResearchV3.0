const test = require('node:test');
const assert = require('node:assert/strict');
const value = require('../replicate-value.js');
const catalog = require('../backend/replicate_catalog.json');
const { app } = require('./helpers/app.cjs');

const model = id => catalog.models.find(m => m.id === id);

test('all requested models are unique and priced image/video rankings use compatible units', () => {
    assert.equal(catalog.requested_models.length, 10);
    assert.equal(new Set(catalog.models.map(m => m.id)).size, catalog.models.length);
    for (const id of catalog.requested_models) assert.ok(['image', 'video'].includes(model(id).kind), id);
    assert.equal(model('google/gemini-omni-1.1').kind, 'video');
    assert.equal(model('prunaai/p-video-edit').operation, 'transform');
    assert.equal(value.yieldFor(model('prunaai/p-video-2-pro')), 100);
    assert.equal(value.rank(catalog.models, 'video')[0].id, 'prunaai/p-video');
    assert.equal(value.yieldFor(model('prunaai/p-video')), 200);
    assert.equal(value.yieldFor(model('openai/gpt-image-2.5-flare')), 83);
    assert.equal(value.yieldFor(model('openai/gpt-image-2.5-flare'), .01), 0);
    assert.equal(value.yieldFor(model('black-forest-labs/flux-2-pro')), 33);
    assert.equal(value.cheapest(model('google/nano-banana-pro')).usd, .15);
    assert.equal(value.cheapest(model('alibaba/wan-3')).usd, .05);
    for (const kind of ['image', 'video']) {
        const rows = value.rank(catalog.models, kind);
        let previous = Infinity, unknown = false;
        for (const m of rows) {
            const count = value.yieldFor(m);
            if (count === null) unknown = true;
            else { assert.equal(unknown, false); assert.ok(count <= previous); previous = count; }
        }
    }
    for (const usd of [0, -1, NaN, Infinity]) {
        const m = {kind:'video',pricing:{status:'verified',unit:'second',variants:[{usd}]}};
        assert.equal(value.yieldFor(m), null);
    }
    assert.equal(value.yieldFor({kind:'video',pricing:{status:'verified',unit:'gpu_second',variants:[{usd:.001}]}}), null);
});

test('both complete lists stay outside hidden panels and work offline before connecting', t => {
    const ui = app(t);
    assert.equal(ui.requests.length, 0);
    const panel = ui.$('replicate-value-panel');
    assert.equal(panel.closest('.hidden'), null);
    assert.equal(panel.closest('[role="tabpanel"]'), null);
    assert.equal(ui.$('replicate-value-rows-image').children.length, 29);
    assert.equal(ui.$('replicate-value-rows-video').children.length, 47);
    assert.ok([...panel.querySelectorAll('button')].every(b => b.disabled));
    ui.$('creator-tab-studio').click(); ui.$('creator-tab-keywords').click();
    assert.equal(panel.closest('.hidden'), null);
    ui.$('replicate-value-search').value = 'gpt-image-2.5';
    ui.$('replicate-value-search').dispatchEvent(new ui.w.Event('input'));
    assert.equal(ui.$('replicate-value-rows-image').children.length, 2);
    assert.ok(ui.$('replicate-value-rows-image').textContent.includes('83 imgs'));
    ui.$('replicate-value-budget').value = '2';
    ui.$('replicate-value-budget').dispatchEvent(new ui.w.Event('input'));
    assert.ok(ui.$('replicate-value-rows-image').textContent.includes('166 imgs'));
    ui.$('replicate-value-budget').value = '0';
    ui.$('replicate-value-budget').dispatchEvent(new ui.w.Event('input'));
    assert.ok(ui.$('replicate-value-status').textContent.includes('mayor que cero'));
    assert.ok(!panel.textContent.includes('Infinity'));
    assert.equal(ui.requests.length, 0);
    assert.deepEqual(ui.errors, []);
});
