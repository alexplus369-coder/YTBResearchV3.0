const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../creator-core.js');
const catalog = require('../backend/replicate_catalog.json');
const { app, until } = require('./helpers/app.cjs');
const { completeProject } = require('./helpers/creator-fixtures.cjs');

const ids = { image: 'google/imagen-4-ultra', video: 'wavespeedai/wan-2.1-i2v-480p', music: 'meta/musicgen', voice: 'minimax/speech-02-turbo' };

function setup(t) {
    const ui = app(t, { ytCreatorProductionV1: JSON.stringify(completeProject()) });
    t.after(() => assert.deepEqual(ui.errors, [], 'Browser script errors'));
    const calls = [], controls = { jobs: [], assets: [], holdSchema: false, releaseSchema: null, holdResource: false, releaseResource: null };
    ui.w.fetch = async (input, options = {}) => {
        const url = new URL(input); calls.push({ url, options });
        assert.equal(url.origin, ui.w.location.origin);
        assert.equal(options.headers.Authorization, 'Bearer render-access-code');
        const result = data => ({ ok: true, status: 200, json: async () => data, blob: async () => new Blob(['fixture']) });
        if (url.pathname.endsWith('/health')) return result({ ready: true, worker: true, providers: { encoder: 'libx264', replicate: true, replicateCatalog: true, replicateLegacy: false } });
        if (url.pathname.endsWith('/assets')) return result(controls.assets);
        if (url.pathname.endsWith('/replicate/models')) return result(catalog);
        if (url.pathname.endsWith('/schema')) {
            if (controls.holdSchema) await new Promise(resolve => { controls.releaseSchema = resolve; });
            const model = url.pathname.replace('/api/video/replicate/models/', '').replace('/schema', ''), kind = catalog.models.find(m => m.id === model).kind;
            return result({ model, kind, version: 'b'.repeat(64), input_schema: { required: [kind === 'voice' ? 'text' : 'prompt'], properties: {
                [kind === 'voice' ? 'text' : 'prompt']: { type: 'string', title: '<img src=x onerror=alert(1)>', description: '<script>never execute</script>', 'x-order': 0 },
                output_format: { allOf: [{ type: 'string', enum: ['png', 'jpeg'] }], default: 'png' },
                steps: { type: 'integer', minimum: 1, maximum: 20, default: 4 },
                generate_audio: { type: 'boolean', default: false },
                image: { type: 'string', format: 'uri' },
                image_array: { type: 'array', items: { type: 'string', format: 'uri' } },
                private_token: { type: 'string', 'x-cog-secret': true },
                metadata: { type: 'object' }
            } } });
        }
        if (url.pathname.endsWith('/replicate/resources')) {
            if (controls.holdResource) await new Promise(resolve => { controls.releaseResource = resolve; });
            controls.jobs = [{ id: 'a'.repeat(32), kind: 'resource', title: 'Generated fixture', state: 'queued', stage: 'queued', progress: 0, created: new Date().toISOString(), result: {} }];
            return result(controls.jobs[0]);
        }
        if (url.pathname.endsWith('/jobs') && options.method === 'POST') {
            const job = { id: 'b'.repeat(32), kind: 'render', title: 'MP4 fixture', state: 'queued', stage: 'queued', progress: 0, created: new Date().toISOString(), result: {} };
            controls.jobs.push(job); return result(job);
        }
        if (url.pathname.endsWith('/jobs')) return result(controls.jobs);
        throw new Error('Unexpected request ' + url.pathname);
    };
    async function connect() {
        ui.$('video-access').value = 'render-access-code'; ui.$('video-connect').click();
        await until(() => ui.$('video-connection').textContent.includes('Motor conectado'));
    }
    async function select(kind) {
        if (ui.$('replicate-panel').classList.contains('hidden')) {
            ui.$('replicate-open').click(); await until(() => ui.$('replicate-model').options.length > 1);
            await until(() => !ui.$('replicate-model').disabled);
        }
        ui.change('replicate-kind', kind); ui.change('replicate-model', ids[kind]);
        await until(() => ui.$('replicate-schema-state').textContent.includes('versión'));
        await until(() => !ui.$('replicate-apply').disabled);
    }
    function input(name, value) {
        const el = ui.$('replicate-fields').querySelector('[data-replicate-field="' + name + '"]');
        el.value = value; el.dispatchEvent(new ui.w.Event('input', { bubbles: true }));
    }
    const paidCalls = () => calls.filter(c => c.options.method === 'POST');
    return { ...ui, calls, controls, connect, select, input, paidCalls };
}

test('catalog and schema load only on request, categories filter and unsafe text never becomes HTML', async t => {
    const ui = setup(t);
    assert.equal(ui.calls.length, 0); await ui.connect();
    assert.ok(!ui.calls.some(c => c.url.pathname.includes('replicate')));
    await ui.select('image');
    assert.equal(ui.$('replicate-model').options.length - 1, catalog.models.filter(m => m.kind === 'image').length);
    assert.equal(ui.$('replicate-fields').querySelector('img'), null);
    assert.equal(ui.$('replicate-fields').querySelector('script'), null);
    assert.equal(ui.$('replicate-fields').querySelector('[data-replicate-field="private_token"]'), null);
    assert.equal(ui.$('replicate-generate').disabled, true);
    assert.equal(ui.paidCalls().length, 0);
    assert.ok(!JSON.stringify({ ...ui.w.localStorage }).includes('render-access-code'));
});

test('permanent comparison chooses a new model, opens Studio and loads parameters without payment', async t => {
    const ui = setup(t); await ui.connect();
    ui.$('creator-tab-keywords').click();
    const id = 'prunaai/p-video-2-pro';
    ui.$('replicate-value-panel').querySelector('[data-value-select="' + id + '"]').click();
    await until(() => !ui.$('replicate-apply').disabled);
    assert.equal(ui.$('creator-panel-studio').classList.contains('hidden'), false);
    assert.equal(ui.$('replicate-panel').classList.contains('hidden'), false);
    assert.equal(ui.$('replicate-kind').value, 'video');
    assert.equal(ui.$('replicate-model').value, id);
    assert.ok(ui.calls.some(c => c.url.pathname.endsWith('/' + id + '/schema')));
    assert.equal(ui.paidCalls().length, 0);
    assert.equal(ui.$('replicate-paid').checked, false);
    ui.$('video-disconnect').click();
    assert.equal(ui.$('replicate-value-rows-image').children.length, 29);
    assert.equal(ui.$('replicate-value-rows-video').children.length, 47);
    assert.ok([...ui.$('replicate-value-panel').querySelectorAll('button')].every(b => b.disabled));
});

test('image, voice and music models keep independent parameters and require an explicit render submission', async t => {
    const ui = setup(t); await ui.connect(); await ui.select('image');
    ui.input('steps', '7'); ui.input('output_format', '"jpeg"');
    ui.$('replicate-apply').click();
    assert.equal(ui.$('video-materials').value, 'replicate');
    await ui.select('voice'); ui.$('replicate-apply').click();
    await ui.select('music'); ui.input('prompt', 'Quiet instrumental background'); ui.$('replicate-apply').click();
    assert.equal(ui.$('video-tts').value, 'replicate');
    assert.equal(ui.$('video-music-source').value, 'replicate');
    assert.equal(ui.paidCalls().length, 0);
    ui.$('video-paid').checked = true;
    ui.$('video-render-form').dispatchEvent(new ui.w.Event('submit', { cancelable: true }));
    await until(() => ui.paidCalls().length === 1);
    const options = JSON.parse(ui.paidCalls()[0].options.body).options;
    assert.equal(options.replicate_visual.model, ids.image);
    assert.equal(options.replicate_visual.inputs.steps, 7);
    assert.equal(options.replicate_visual.inputs.output_format, 'jpeg');
    assert.equal(options.replicate_voice.model, ids.voice);
    assert.equal(options.replicate_music.inputs.prompt, 'Quiet instrumental background');
    assert.equal(options.paid_generation_confirmed, true);
    await until(() => ui.$('video-connection').textContent.includes('Trabajo bbbbbbbb'));
    ui.$('video-disconnect').click();
});

for (const kind of ['image', 'video', 'music', 'voice']) {
    test('individual ' + kind + ' queues once and completed assets can be used without another generation', async t => {
        const ui = setup(t); await ui.connect(); await ui.select(kind);
        ui.input(kind === 'voice' ? 'text' : 'prompt', 'Original resource text');
        if (kind === 'image' || kind === 'video') ui.change('replicate-destination', 'scene:0');
        ui.$('replicate-paid').checked = true; ui.$('replicate-paid').dispatchEvent(new ui.w.Event('change'));
        ui.$('replicate-generate').click(); ui.$('replicate-generate').click();
        await until(() => ui.paidCalls().length === 1);
        const payload = JSON.parse(ui.paidCalls()[0].options.body);
        assert.equal(payload.selection.kind, kind); assert.equal(payload.paid_generation_confirmed, true);
        await until(() => ui.$('video-connection').textContent.includes('en cola'));
        const assetId = 'c'.repeat(32);
        ui.controls.assets = [{ id: assetId, name: 'Generated fixture', kind: ['music', 'voice'].includes(kind) ? 'audio' : kind, size: 1024 }];
        ui.controls.jobs[0].state = 'completed'; ui.controls.jobs[0].result = { assetId, resourceKind: kind, artifacts: [] };
        ui.$('video-refresh').click();
        await until(() => kind === 'voice' ? ui.$('video-audio').value === assetId : kind === 'music' ? ui.$('video-music').value === assetId : ui.$('video-scenes').querySelector('select').value === assetId);
        assert.equal(ui.paidCalls().length, 1);
        assert.ok(ui.$('video-jobs').textContent.includes('Usar recurso'));
        assert.ok(!ui.$('video-jobs').textContent.includes('Subir privado'));
        ui.$('video-disconnect').click();
    });
}

test('reference assets, arrays, booleans and JSON parameters remain typed', async t => {
    const ui = setup(t); ui.controls.assets = [{ id: 'd'.repeat(32), name: 'Owned reference', kind: 'image', size: 1024 }];
    await ui.connect(); await ui.select('image');
    const reference = ui.$('replicate-fields').querySelector('[data-replicate-file="image"]');
    reference.value = 'd'.repeat(32); reference.dispatchEvent(new ui.w.Event('change', { bubbles: true }));
    ui.input('image_array', 'https://example.test/first.png\nhttps://example.test/second.png');
    ui.input('generate_audio', 'true'); ui.input('metadata', '{"original":true}');
    ui.$('replicate-apply').click(); ui.$('video-paid').checked = true;
    ui.$('video-render-form').dispatchEvent(new ui.w.Event('submit', { cancelable: true }));
    await until(() => ui.paidCalls().length === 1);
    const selection = JSON.parse(ui.paidCalls()[0].options.body).options.replicate_visual;
    assert.deepEqual(selection.file_inputs.image, ['d'.repeat(32)]);
    assert.deepEqual(selection.inputs.image_array, ['https://example.test/first.png', 'https://example.test/second.png']);
    assert.equal(selection.inputs.generate_audio, true); assert.deepEqual(selection.inputs.metadata, { original: true });
    await until(() => !ui.$('video-refresh').disabled); ui.$('video-disconnect').click();
});

test('a late schema cannot return after disconnect or enable generation', async t => {
    const ui = setup(t); await ui.connect(); ui.$('replicate-open').click();
    await until(() => ui.$('replicate-model').options.length > 1 && !ui.$('replicate-model').disabled);
    ui.controls.holdSchema = true; ui.change('replicate-model', ids.image);
    await until(() => !!ui.controls.releaseSchema); ui.$('video-disconnect').click(); ui.controls.releaseSchema();
    await until(() => ui.$('video-connection').textContent.includes('Operación pendiente'));
    assert.equal(ui.$('replicate-fields').children.length, 0);
    assert.equal(ui.$('replicate-generate').disabled, true);
    assert.equal(ui.paidCalls().length, 0);
});

test('MusicGen displays the non-commercial weights warning and a model review link', async t => {
    const ui = setup(t); await ui.connect(); await ui.select('music');
    assert.ok(ui.$('replicate-license-state').textContent.includes('CC-BY-NC'));
    assert.equal(ui.$('replicate-license-state').querySelector('a').href, 'https://replicate.com/meta/musicgen');
    assert.equal(ui.paidCalls().length, 0); ui.$('video-disconnect').click();
});

test('an individual asset submitted for the old project is not assigned to a replacement project', async t => {
    const ui = setup(t); await ui.connect(); await ui.select('image');
    ui.change('replicate-destination', 'scene:0'); ui.input('prompt', 'Original image');
    ui.controls.holdResource = true;
    ui.$('replicate-paid').checked = true; ui.$('replicate-paid').dispatchEvent(new ui.w.Event('change'));
    ui.$('replicate-generate').click(); await until(() => !!ui.controls.releaseResource);
    const replacement = core.validateProject(completeProject()); replacement.topic = 'Otro proyecto';
    ui.w.getCreatorProduction = () => replacement;
    ui.w.document.dispatchEvent(new ui.w.Event('creator-production-updated'));
    ui.controls.releaseResource(); await until(() => ui.$('video-connection').textContent.includes('en cola'));
    const assetId = 'f'.repeat(32);
    ui.controls.assets = [{ id: assetId, name: 'Old project image', kind: 'image', size: 1024 }];
    ui.controls.jobs[0].state = 'completed'; ui.controls.jobs[0].result = { assetId, resourceKind: 'image', artifacts: [] };
    ui.$('video-refresh').click();
    await until(() => ui.$('video-assets').textContent.includes('Old project image'));
    assert.equal(ui.$('video-scenes').querySelector('select').value, '');
    assert.equal(ui.paidCalls().length, 1); ui.$('video-disconnect').click();
});
