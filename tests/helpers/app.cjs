const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const core = require('../../research-core.js');
const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const inline = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].find(match => match[1].trim())[1];
const channelId = 'UC' + 'a'.repeat(22);
const hiddenId = 'UC' + 'b'.repeat(22);
const fixtureVideos = Array.from({ length: 6 }, (_, i) => ({
    id: `video${String(i).padStart(6, '0')}`,
    snippet: { title: i === 0 ? '=HYPERLINK("https://example.test")' : i === 5 ? '<img src=x onerror="alert(1)"> Corona' : `Corona tutorial ${i}`,
        channelId: i % 2 ? hiddenId : channelId, channelTitle: 'Tutoriales & ArchViz',
        publishedAt: new Date(Date.now() - 10 * 86400000).toISOString(), description: 'Ejemplo propio', tags: ['corona', 'luces'] },
    statistics: { viewCount: String((i + 1) * 1000), likeCount: '50', commentCount: '10' },
    contentDetails: { duration: 'PT10M' }
}));

async function until(predicate) {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > 2000) throw new Error('Timed out waiting for UI state.');
        await new Promise(resolve => setTimeout(resolve, 2));
    }
}

function app(t, initialStorage = {}) {
    const dom = new JSDOM(html, { url: 'https://research.example.test/', runScripts: 'outside-only', pretendToBeVisual: true });
    t.after(() => dom.window.close());
    const w = dom.window;
    const context = dom.getInternalVMContext();
    const requests = [], downloads = [], errors = [], blobs = new Map();
    const controls = { quotaError: false, holdSearch: false, waitingSearch: [], waitingAI: [], holdAI: false,
        holdOAuth: false, waitingOAuth: [], revocations: 0, oauthScope: '', baselineChannels: null, uploadVideos: [] };
    Object.entries(initialStorage).forEach(([key, value]) => w.localStorage.setItem(key, value));
    w.Blob = Blob;
    w.AbortController = AbortController;
    w.AbortSignal = AbortSignal;
    w.HTMLElement.prototype.scrollIntoView = function () {};
    w.URL.createObjectURL = blob => { const url = `blob:test-${blobs.size}`; blobs.set(url, blob); return url; };
    w.URL.revokeObjectURL = () => {};
    w.HTMLAnchorElement.prototype.click = function () { downloads.push({ name: this.download, blob: blobs.get(this.href) }); };
    w.addEventListener('error', event => errors.push(event.message));
    const append = w.document.head.appendChild.bind(w.document.head);
    w.document.head.appendChild = node => {
        if (node.tagName === 'SCRIPT' && node.src.includes('suggestqueries.google.com')) {
            const url = new URL(node.src);
            const query = url.searchParams.get('q');
            w.queueMicrotask(() => w[url.searchParams.get('jsonp')]?.([query, [[query + ' paso a paso'], [query + ' principiantes'], [query + ' errores']]]));
            return node;
        }
        return append(node);
    };
    w.google = { accounts: { oauth2: {
        initTokenClient(config) { controls.oauthScope = config.scope; return { requestAccessToken() {
            const complete = () => config.callback({ access_token: 'fake-oauth-token', expires_in: 3600 });
            if (controls.holdOAuth) controls.waitingOAuth.push(complete);
            else w.queueMicrotask(complete);
        } }; },
        revoke() { controls.revocations++; }
    } } };
    w.fetch = async input => {
        const url = new URL(input);
        requests.push(url);
        const result = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
        if (url.hostname === 'www.googleapis.com') {
            const resource = url.pathname.split('/').pop();
            if (resource === 'search') {
                if (controls.holdSearch) await new Promise(resolve => controls.waitingSearch.push(resolve));
                if (controls.quotaError) return result({ error: { errors: [{ reason: 'quotaExceeded' }], message: 'fake-yt-key' } }, 403);
                const items = fixtureVideos.filter(v => !url.searchParams.has('channelId') || v.snippet.channelId === url.searchParams.get('channelId'));
                return result({ items: items.map(v => ({ id: { videoId: v.id } })) });
            }
            if (resource === 'videos') {
                const ids = (url.searchParams.get('id') || '').split(',');
                return result({ items: [...new Map([...fixtureVideos, ...controls.uploadVideos].map(v => [v.id, v])).values()].filter(v => ids.includes(v.id)) });
            }
            if (resource === 'playlistItems') return result({ items: controls.uploadVideos.map(v => ({ contentDetails: { videoId: v.id } })) });
            if (resource === 'channels' && controls.baselineChannels && url.searchParams.get('part') === 'contentDetails') return result({ items: controls.baselineChannels });
            if (resource === 'channels') return result({ items: [
                { id: channelId, snippet: { title: 'Tutoriales', thumbnails: {} }, statistics: { subscriberCount: '500', hiddenSubscriberCount: false, viewCount: '50000' } },
                { id: hiddenId, snippet: { title: 'Oculto', thumbnails: {} }, statistics: { hiddenSubscriberCount: true, viewCount: '80000' } }
            ] });
            if (resource === 'commentThreads') return result({ items: [{ snippet: { topLevelComment: { snippet: { textDisplay: '¿Cómo configuro Corona?', likeCount: 4 } } } }] });
            return result({ items: [] });
        }
        if (url.hostname === 'youtubeanalytics.googleapis.com') return result({ rows: url.searchParams.has('dimensions')
            ? [[fixtureVideos[0].id, 1000, 5, 60]] : [[10000, 50, 1200, 100, 5]] });
        if (url.hostname === 'generativelanguage.googleapis.com') {
            if (controls.holdAI) await new Promise(resolve => controls.waitingAI.push(resolve));
            return result({ candidates: [{ content: { parts: [{ text: JSON.stringify({ preguntas: ['Configurar Corona'], temas: [], intencionCompra: [], ideas: [] }) }] } }] });
        }
        throw new Error('Unexpected external call: ' + url.hostname);
    };
    for (const file of ['research-core.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
    vm.runInContext(inline, context, { filename: 'index.html inline' });
    w.HTMLMediaElement.prototype.pause = function () {};
    for (const file of ['research-workspace.js', 'creator-core.js', 'creator-studio.js', 'video-production.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
    const $ = id => w.document.getElementById(id);
    const change = (id, value) => { $(id).value = value; $(id).dispatchEvent(new w.Event('change', { bubbles: true })); };
    const submit = () => $('research-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
    const evaluate = code => vm.runInContext(code, context);
    const scan = async (topic = 'Corona Renderer') => {
        $('ytApiKeyInput').value = 'fake-yt-key';
        $('research-input').value = topic;
        submit();
        await until(() => !evaluate('researchState.busy'));
        assert.equal($('research-error').classList.contains('hidden'), true, $('research-error').textContent);
    };
    return { w, $, requests, downloads, controls, errors, change, submit, evaluate, scan };
}


module.exports = { app, until, fixtureVideos, channelId, hiddenId };
