const test = require('node:test');
const assert = require('node:assert/strict');
const { app, until } = require('./helpers/app.cjs');
const { completeProject } = require('./helpers/creator-fixtures.cjs');

function setup(t) {
    const ui = app(t, { ytCreatorProductionV1: JSON.stringify(completeProject()) });
    const calls = [], controls = Object.assign(ui.controls, { jobs: [], holdPost: false, release: null, unauthorized: false, holdJobsBody: false, jobsRelease: null });
    const normalFetch = ui.w.fetch;
    ui.w.fetch = async (input, options = {}) => {
        const url = new URL(input);
        if (url.hostname !== '127.0.0.1') return normalFetch(input, options);
        calls.push({ path: url.pathname, options });
        assert.equal(options.headers.Authorization, 'Bearer session-render-token');
        const result = (data, status = 200) => ({ ok: status < 400, status, json: async () => data, blob: async () => new Blob(['MP4']) });
        if (controls.unauthorized) return result({ detail: 'Código de acceso inválido.' }, 401);
        if (url.pathname.endsWith('/health')) return result({ ready: true, worker: true, providers: { encoder: 'libx264', maxUploadMB: 200, telegram: false, replicate: true } });
        if (url.pathname.endsWith('/assets')) return result([]);
        if (url.pathname.endsWith('/jobs') && options.method === 'POST') {
            if (controls.holdPost) await new Promise(resolve => { controls.release = resolve; });
            const job = { id: 'a'.repeat(32), title: '<img src=x onerror=alert(1)>', state: 'queued', stage: 'queued', progress: 0, created: '2026-10-05T12:00:00Z', result: {} };
            controls.jobs = [job]; return result(job, 202);
        }
        if (url.pathname.endsWith('/jobs')) return { ...result(controls.jobs), json: async () => {
            if (controls.holdJobsBody) await new Promise(resolve => { controls.jobsRelease = resolve; });
            return controls.jobs;
        } };
        if (url.pathname.endsWith('/files/words.json')) return result([{ text: '<b>Palabra</b>', start: 4, end: 5 }]);
        if (url.pathname.endsWith('/clips')) return result({ id: 'c'.repeat(32), state: 'queued' }, 202);
        if (url.pathname.endsWith('/youtube')) return result({ videoId: 'abcdefghijk', privacyStatus: 'private' });
        if (url.pathname.endsWith('/files/video.mp4')) return result({});
        throw new Error('Unexpected renderer request: ' + url.pathname);
    };
    const connect = async () => {
        ui.$('video-access').value = 'session-render-token'; ui.$('video-connect').click();
        await until(() => ui.$('video-connection').textContent.includes('Motor conectado'));
    };
    const submit = () => ui.$('video-render-form').dispatchEvent(new ui.w.Event('submit', { cancelable: true }));
    return { ...ui, calls, controls, connect, submit };
}

test('renderer stays opt-in and posts the saved production once with explicit costs and no persisted credentials', async t => {
    const ui = setup(t); assert.equal(ui.calls.length, 0); assert.equal(ui.$('video-render').disabled, true);
    await ui.connect(); assert.equal(ui.$('video-render').disabled, false);
    ui.change('video-materials', 'replicate'); ui.$('video-paid').checked = true;
    ui.controls.holdPost = true; ui.submit(); ui.submit(); await until(() => !!ui.controls.release);
    const posts = ui.calls.filter(c => c.path.endsWith('/jobs') && c.options.method === 'POST');
    assert.equal(posts.length, 1); const payload = JSON.parse(posts[0].options.body);
    assert.equal(payload.production.format, 'yt-creator-production'); assert.equal(payload.production.blocks.length, 6);
    assert.deepEqual(payload.block_indexes, [0, 1, 2, 3, 4, 5]); assert.equal(payload.options.paid_generation_confirmed, true);
    assert.equal(payload.options.max_generated, 4); assert.equal(payload.options.notify, false);
    ui.controls.release(); await until(() => ui.$('video-connection').textContent.includes('Trabajo aaaaaaaa'));
    assert.equal(ui.$('video-jobs').querySelector('img'), null); assert.match(ui.$('video-jobs').textContent, /<img/);
    assert.ok(!JSON.stringify({ ...ui.w.localStorage }).includes('session-render-token'));
    ui.$('video-disconnect').click(); assert.equal(ui.$('video-render').disabled, true); assert.equal(ui.$('video-access').value, '');
    assert.deepEqual(ui.errors, []);
});

test('completed video downloads, word selection and recuts share one concrete source job', async t => {
    const ui = setup(t);
    ui.controls.jobs = [{ id: 'b'.repeat(32), title: 'Video original', state: 'completed', stage: 'completed', progress: 100, created: '2026-10-05T12:00:00Z', result: {
        durationSeconds: 60, width: 1280, height: 720, captionTiming: 'estimated-from-script', canClip: true, artifacts: ['video.mp4', 'subtitles.srt'], midRollDurationThresholdMet: false } }];
    await ui.connect();
    ui.$('video-jobs').querySelector('[data-video-action="video.mp4"]').click();
    await until(() => ui.downloads.length === 1); assert.equal(ui.downloads[0].name, 'bbbbbbbb-video.mp4');
    await until(() => !ui.$('video-refresh').disabled);
    ui.$('video-jobs').querySelector('[data-video-action="transcript"]').click();
    await until(() => ui.$('video-transcript').querySelector('button'));
    assert.equal(ui.$('video-transcript').querySelector('b'), null);
    ui.$('video-transcript').querySelector('button').click(); assert.equal(ui.$('video-cut-start').value, '4.0');
    await until(() => !ui.$('video-cut').disabled);
    ui.$('video-cut-end').value = '12'; ui.$('video-cut-form').dispatchEvent(new ui.w.Event('submit', { cancelable: true }));
    await until(() => ui.calls.some(c => c.path.endsWith('/clips')));
    const cut = ui.calls.find(c => c.path.endsWith('/clips'));
    assert.equal(cut.path, '/api/video/jobs/' + 'b'.repeat(32) + '/clips');
    assert.deepEqual(JSON.parse(cut.options.body), { start: 4, end: 12, aspect: 'portrait', resolution: 720 });
    await until(() => ui.$('video-connection').textContent.includes('Recorte enviado'));
});

test('private upload asks for its own OAuth scope and sends tokens only when the user chooses a video', async t => {
    const ui = setup(t);
    ui.controls.jobs = [{ id: 'b'.repeat(32), title: 'Video original', state: 'completed', stage: 'completed', progress: 100, created: '2026-10-05T12:00:00Z', result: { artifacts: ['video.mp4'] } }];
    await ui.connect(); ui.$('analytics-client-id').value = 'client.apps.googleusercontent.com'; ui.$('video-youtube-connect').click();
    await until(() => ui.$('video-youtube-state').textContent.includes('Subida autorizada'));
    assert.equal(ui.controls.oauthScope, 'https://www.googleapis.com/auth/youtube.upload');
    assert.ok(!ui.calls.some(c => c.path.endsWith('/youtube')));
    await until(() => !ui.$('video-refresh').disabled); ui.$('video-synthetic').checked = true;
    ui.$('video-jobs').querySelector('[data-video-action="youtube"]').click();
    await until(() => ui.$('video-youtube-state').textContent.includes('Video privado'));
    const sent = JSON.parse(ui.calls.find(c => c.path.endsWith('/youtube')).options.body);
    assert.equal(sent.access_token, 'fake-oauth-token'); assert.equal(sent.synthetic, true);
    assert.ok(!JSON.stringify({ ...ui.w.localStorage }).includes('fake-oauth-token'));
});

test('401 errors unlock the panel and a late JSON body cannot restore jobs after disconnect', async t => {
    const ui = setup(t); await ui.connect();
    ui.controls.unauthorized = true; ui.$('video-refresh').click();
    await until(() => !ui.$('video-error').classList.contains('hidden'));
    assert.equal(ui.$('video-render').disabled, true); assert.match(ui.$('video-error').textContent, /Código de acceso/);
    ui.controls.unauthorized = false; await ui.connect();
    ui.controls.holdJobsBody = true; ui.$('video-refresh').click(); await until(() => !!ui.controls.jobsRelease);
    ui.$('video-disconnect').click(); ui.controls.jobs = [{ title: 'LATE PRIVATE TITLE' }]; ui.controls.jobsRelease();
    await until(() => ui.$('video-connection').textContent.includes('Operación pendiente'));
    assert.ok(!ui.$('video-jobs').textContent.includes('LATE PRIVATE TITLE'));
    assert.equal(ui.$('video-render').disabled, true);
});
