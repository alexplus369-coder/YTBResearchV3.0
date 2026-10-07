/* Real browser + FFmpeg + Remotion check. Only generated fixtures, never cloud providers. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { completeProject, block, publishing } = require('../tests/helpers/creator-fixtures.cjs');
const core = require('../creator-core.js');

const exec = promisify(execFile), root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results', 'production-e2e');
const base = 'http://127.0.0.1:8787', token = 'production-e2e-test-code-no-real-secrets';
const python = process.env.YT_TEST_PYTHON || 'python';
const executable = process.platform === 'win32' ? 'agent-browser.cmd' : 'agent-browser';
const browserPath = path.join(root, 'node_modules', '.bin', executable);
const browserOptions = ['--session', 'yt-production-' + process.pid, '--json'];
if (process.env.YT_BROWSER_BIN) browserOptions.push('--executable-path', process.env.YT_BROWSER_BIN);
browserOptions.push('--args', '--no-sandbox,--disable-dev-shm-usage');
const env = {...process.env, YT_RENDER_DIR: path.join(output, 'server-data'), YT_RENDER_TOKEN: token,
  PORT: '8787', YT_RENDER_HOST: '127.0.0.1', RENDER_EXTERNAL_URL: '', YT_SITE_PRIVATE: 'true', YT_SITE_USER: 'alejandro',
  PIXABAY_API_KEY: '', REPLICATE_API_TOKEN: '', WHISPER_CPP_BINARY: '', WHISPER_CPP_MODEL: '',
  TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '', AGENT_BROWSER_DEFAULT_TIMEOUT: '60000'};

async function command(file, args, options = {}) {
  return exec(file, args, {cwd: root, env, timeout: 300000, maxBuffer: 8 * 1024 * 1024, ...options});
}
async function browser(...args) {
  const {stdout} = await command(browserPath, [...browserOptions, ...args], {timeout: 90000});
  const result = JSON.parse(stdout);
  if (result.success === false) throw new Error(result.error || 'Browser command failed');
  return result.data ?? result;
}
async function value(code) {
  const data = await browser('eval', '-b', Buffer.from(code).toString('base64'));
  return data && Object.hasOwn(data, 'result') ? data.result : data;
}
async function wait(code) { await browser('wait', '--fn', code); }
async function click(selector) {
  // The native driver can leave partially visible buttons at the viewport edge.
  // Centre the real control and verify its hit target before sending a pointer click.
  const target = JSON.stringify(selector);
  await value('document.querySelector(' + target + ').scrollIntoView({block:"center", inline:"nearest", behavior:"instant"}); true');
  await wait('(() => {const el=document.querySelector(' + target + '); if(!el || el.disabled) return false; const r=el.getBoundingClientRect(), x=r.left+r.width/2, y=r.top+r.height/2; return r.width>0 && r.height>0 && r.top>=0 && r.bottom<=innerHeight && x>=0 && x<innerWidth && el.contains(document.elementFromPoint(x,y));})()');
  await browser('click', selector);
}
async function api(endpoint) {
  const response = await fetch(base + '/api/video' + endpoint, {headers: {Authorization: 'Bearer ' + token}, signal: AbortSignal.timeout(5000)});
  assert.equal(response.ok, true, endpoint + ' HTTP ' + response.status);
  return response.json();
}
async function metadata(filename) {
  return JSON.parse((await command('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filename])).stdout);
}
async function screenshot(name, selector) {
  await browser('scrollintoview', selector);
  await browser('screenshot', path.join(output, name));
}

async function verifyNichesAndTheme() {
  await wait('typeof NicheCore === "object" && document.querySelectorAll("[data-niche-rpm]").length === 20');
  assert.equal(await value('document.documentElement.dataset.theme'), 'graphite');
  assert.equal(await value('document.querySelectorAll(".niche-card").length'), 0);
  const viewport = await value('[innerWidth, innerHeight]');
  const colours = await value(`(() => {
    const ids = ['niche-panel','creator-suite','video-factory','replicate-value-panel','research-input'];
    return ['body', ...ids.map(id => '#' + id)].map(selector => {
      const style = getComputedStyle(document.querySelector(selector));
      return {selector, background:style.backgroundColor, colour:style.color};
    });
  })()`);
  const rgb = colour => colour.match(/[\d.]+/g).slice(0, 3).map(Number);
  const luminance = colour => rgb(colour).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
    .reduce((sum, n, i) => sum + n * [.2126,.7152,.0722][i], 0);
  const contrast = (a,b) => (Math.max(luminance(a),luminance(b)) + .05) / (Math.min(luminance(a),luminance(b)) + .05);
  for (const surface of colours) {
    assert.ok(rgb(surface.background).every(n => n < 100), 'Surface must stay dark: ' + JSON.stringify(surface));
    assert.ok(contrast(surface.colour, surface.background) >= 4.5, 'Insufficient text contrast: ' + JSON.stringify(surface));
  }
  for (const theme of ['midnight','warm','graphite']) {
    await browser('select', '#studio-theme', theme); await browser('reload');
    await wait('typeof NicheCore === "object" && document.getElementById("studio-theme").value === ' + JSON.stringify(theme));
    assert.equal(await value('document.documentElement.dataset.theme'), theme);
    await screenshot('studio-theme-' + theme + '.png', '.studio-header');
  }
  // Replace the public read client only. No real credentials, YouTube quota or cloud generation is used by CI.
  await value(`(() => {
    window.nicheRealFetch = youtubeClient.fetchJson; window.nicheTestCalls = []; window.nicheAiCalls = 0;
    window.smartFetchAI = async () => {window.nicheAiCalls++; throw new Error('Unexpected AI generation');};
    document.getElementById('ytApiKeyInput').value = 'offline-niche-test-key';
    const videos = NicheCore.CATALOG.map((n, i) => ({id:'niche'+String(i).padStart(6,'0'),
      snippet:{title:'Referencia original '+n.label, channelTitle:'Canal '+i, channelId:'UC'+String(i).padStart(22,'0'),
        publishedAt:new Date(Date.now()-10*86400000).toISOString(),liveBroadcastContent:'none'},
      statistics:{viewCount:String((i+1)*10000)},contentDetails:{duration:'PT10M'}}));
    youtubeClient.fetchJson = async input => {
      const url = new URL(input); window.nicheTestCalls.push(url.pathname);
      const resource = url.pathname.split('/').pop();
      if(resource==='search') {const index=NicheCore.CATALOG.findIndex(n => n.queries.es === url.searchParams.get('q'));
        if(index<0) throw new Error('Unknown test query'); return {items:[{id:{videoId:videos[index].id}}]};}
      const ids=(url.searchParams.get('id') || '').split(',');
      if(resource==='videos') return {items:videos.filter(v=>ids.includes(v.id))};
      if(resource==='channels') return {items:ids.map(id=>({id,statistics:{subscriberCount:'2000',hiddenSubscriberCount:false}}))};
      throw new Error('Unexpected public read');
    };
    return true;
  })()`);
  await click('#niche-update');
  await wait('document.getElementById("niche-panel").getAttribute("aria-busy") === "false" && document.querySelectorAll(".niche-card").length === 10');
  const requests = await value('window.nicheTestCalls');
  assert.equal(requests.filter(p => p.endsWith('/search')).length, 20); assert.equal(requests.length, 60);
  assert.match(await value('document.getElementById("niche-results").textContent'), /Sin historial suficiente/);
  assert.equal(await value('window.nicheAiCalls'), 0);
  assert.equal(await value('localStorage.getItem("ytNicheRadarV1").includes("offline-niche-test-key")'), false);
  await value(`(() => {
    document.querySelector('.niche-scenarios').open=true;
    document.getElementById('niche-order').value='margin'; document.getElementById('niche-order').dispatchEvent(new Event('change'));
    const rpm=document.querySelector('[data-niche-rpm="archviz"]'); rpm.value='15'; rpm.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`);
  assert.equal(await value('document.querySelector(".niche-card [data-niche-id]").dataset.nicheId'), 'archviz');
  assert.equal(await value('window.nicheTestCalls.length'), 60);
  const muted = await value(`(() => {const el=document.querySelector('.niche-card-heading p'); return {colour:getComputedStyle(el).color,background:getComputedStyle(el.closest('.niche-card')).backgroundColor};})()`);
  assert.ok(contrast(muted.colour, muted.background) >= 4.5);
  await value('document.querySelector(".niche-scenarios").open=false; true');
  await screenshot('niche-ranking-desktop.png', '#niche-panel');
  await screenshot('niche-cards-desktop.png', '.niche-results');
  await browser('set', 'viewport', '390', '844');
  await screenshot('niche-ranking-mobile.png', '#niche-panel');
  await screenshot('niche-card-mobile.png', '.niche-card:first-child');
  const layout = await value(`(() => {
    const panel=document.getElementById('niche-panel');
    const rect=panel.getBoundingClientRect();
    return {left:rect.left,right:rect.right,width:panel.clientWidth,scrollWidth:panel.scrollWidth,
      cards:[...panel.querySelectorAll('.niche-card')].map(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth})),
      controls:[...panel.querySelectorAll('.niche-controls button')].map(el=>el.getBoundingClientRect().height)};
  })()`);
  assert.ok(layout.left >= 0 && layout.right <= 390 && layout.scrollWidth <= layout.width + 2, JSON.stringify(layout));
  assert.ok(layout.cards.every(card => card.scrollWidth <= card.width + 2), JSON.stringify(layout));
  assert.ok(layout.controls.every(height => height >= 44), JSON.stringify(layout));
  await click('.niche-card:first-child [data-niche-action="script"]');
  assert.match(await value('document.getElementById("creator-context").textContent'), /Top 10/);
  assert.equal(await value('window.nicheAiCalls'), 0);
  await browser('set', 'viewport', String(viewport[0]), String(viewport[1]));
  await value('youtubeClient.fetchJson=window.nicheRealFetch; document.getElementById("ytApiKeyInput").value=""; true');
  await browser('reload');
  await wait('document.querySelectorAll(".niche-card").length === 10 && typeof window.getCreatorProduction === "function"');
  assert.equal(await value('document.querySelector(".niche-card [data-niche-id]").dataset.nicheId'), 'archviz');
  await fs.writeFile(path.join(output,'niche-theme-report.json'),JSON.stringify({requests:requests.length,searches:20,aiCalls:0,colours,muted,mobile:layout},null,2));
  console.log('Real browser niche and theme checks passed: bounded public reads, manual scenarios, source selection, reload, dark surfaces, text contrast and mobile layout.');
}

async function verifyScriptContinuation() {
  const previous = core.validateProject(completeProject()), slots = core.timeline(previous.profile.duration);
  const pending = slots.map(block); pending[4].narration = Array(447).fill('ejemplo').join(' ');
  const draft = core.scriptDraftBackup({format:'yt-creator-script-draft', version:1, updatedAt:new Date().toISOString(),
    context:{profile:previous.profile, topic:'Continuar el guion pendiente', angle:previous.angle, sampleTopic:'Software', sources:previous.sources},
    variants:previous.variants, selected:previous.selected, blocks:pending, generatedParts:[0, 1], publishing:publishing()});
  assert.equal(await value('document.getElementById("creator-continue-btn").disabled'), true);
  await value('localStorage.setItem("ytCreatorProductionV1", ' + JSON.stringify(JSON.stringify(previous)) + '); localStorage.setItem("ytCreatorScriptDraftV1", ' + JSON.stringify(JSON.stringify(draft)) + '); true');
  await browser('reload');
  await wait('typeof window.getCreatorProduction === "function" && !document.getElementById("creator-continue-btn").disabled');
  assert.equal(await value('window.getCreatorProduction().topic'), previous.topic);
  assert.match(await value('document.getElementById("creator-draft-status").textContent'), /5 de 6 bloques validados.*Guardado en este navegador/);
  await screenshot('continue-script-desktop.png', '#creator-draft-panel');
  const viewport = await value('[innerWidth, innerHeight]');
  await browser('set', 'viewport', '390', '844');
  await browser('scrollintoview', '#creator-continue-btn');
  const layout = await value('(() => {const el = document.getElementById("creator-continue-btn"), r = el.getBoundingClientRect(); return {left:r.left, right:r.right, height:r.height, disabled:el.disabled, hidden:!!el.closest(".hidden")};})()');
  assert.ok(layout.left >= 0 && layout.right <= 390 && layout.height >= 40 && !layout.disabled && !layout.hidden, JSON.stringify(layout));
  await screenshot('continue-script-mobile.png', '#creator-draft-panel');
  await browser('set', 'viewport', String(viewport[0]), String(viewport[1]));
  const repaired = {blocks:[{index:4, narration:block(slots[4]).narration}]};
  await value('window.scriptRepairCalls = []; document.getElementById("geminiApiKeyInput").value = "fake-offline-key"; window.smartFetchAI = async prompt => {window.scriptRepairCalls.push(prompt); return ' + JSON.stringify(repaired) + ';}; true');
  await click('#creator-tab-daily');
  await click('#creator-continue-btn');
  await wait('!document.getElementById("creator-package-btn").disabled && localStorage.getItem("ytCreatorScriptDraftV1") === null');
  const calls = await value('window.scriptRepairCalls');
  assert.equal(calls.length, 1); assert.match(calls[0], /REPARACIÓN SELECTIVA DE GUION/);
  const correction = JSON.parse(calls[0].match(/\nDevuelve solamente estos índices pendientes: ([^\n]+)/)[1]);
  assert.deepEqual(correction.map(c => [c.index, c.wordsReceived]), [[4, 447]]);
  const completed = await value('window.getCreatorProduction()');
  assert.equal(completed.topic, draft.context.topic); assert.equal(completed.description, draft.publishing.description);
  for (const slot of slots.filter(s => s.index !== 4)) assert.equal(completed.blocks[slot.index].narration, draft.blocks[slot.index].narration);
  assert.equal(await value('document.getElementById("creator-panel-studio").classList.contains("hidden")'), false);
  assert.equal(await value('document.getElementById("creator-continue-btn").disabled'), true);
  await fs.writeFile(path.join(output, 'continue-script-report.json'), JSON.stringify({acceptedBefore:5, repairedIndices:correction.map(c => c.index), aiRequests:calls.length, mobile:layout}, null, 2));
  console.log('Real browser script continuation passed: checkpoint restore, five preserved blocks, one selective repair, visible desktop/mobile button and no duplicate requests.');
}

async function main() {
  await fs.mkdir(output, {recursive: true});
  const fixture = path.join(output, 'fixture');
  await command(python, ['-m', 'backend.tests.media_fixture', '--output', fixture]);
  const exported = JSON.parse(await fs.readFile(path.join(fixture, 'project', 'remotion-input.json'), 'utf8'));
  assert.ok(exported.music && exported.scenes.some(s => s.sourceStartFrame > 0));

  // Start the dev server and immediately verify it with agent-browser.
  const server = spawn(python, ['-m', 'backend'], {cwd: root, env, stdio: ['ignore', 'pipe', 'pipe']});
  let serverLog = '';
  const capture = chunk => { serverLog = (serverLog + chunk.toString()).slice(-50000); };
  server.stdout.on('data', capture); server.stderr.on('data', capture);
  try {
    const started = Date.now();
    while (!serverLog.includes('Application startup complete')) {
      if (server.exitCode !== null || Date.now() - started > 20000) throw new Error('Backend failed to start: ' + serverLog);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal((await fetch(base + '/healthz')).status, 200);
    assert.equal((await fetch(base)).status, 401);
    await browser('set', 'credentials', 'alejandro', token);
    await browser('open', base);
    await wait('document.body.innerText.length > 100 && typeof window.getCreatorProduction === "function"');
    const comparison = await value('({images: document.getElementById("replicate-value-rows-image").children.length, videos: document.getElementById("replicate-value-rows-video").children.length, position: getComputedStyle(document.getElementById("replicate-value-panel")).position, hiddenAncestor: !!document.getElementById("replicate-value-panel").closest(".hidden")})');
    assert.deepEqual(comparison, {images:29, videos:47, position:'fixed', hiddenAncestor:false});
    await screenshot('model-comparison-desktop.png', '#replicate-value-panel');
    await fs.writeFile(path.join(output, 'page-snapshot.json'), JSON.stringify(await browser('snapshot', '-i'), null, 2));
    assert.equal(await value('!!document.querySelector("[data-nextjs-dialog], .vite-error-overlay")'), false);
    await verifyNichesAndTheme();
    await verifyScriptContinuation();
    await click('#creator-tab-studio');
    await browser('fill', '#video-access', token); await click('#video-connect');
    await wait('document.getElementById("video-connection").textContent.includes("Motor conectado")');
    await wait('getComputedStyle(document.getElementById("video-factory")).borderTopWidth === "1px"');
    assert.equal((await api('/health')).worker, true);
    assert.equal((await api('/jobs')).length, 0);
    assert.ok((await fetch(base + '/docs/video-production.md', {headers: {Authorization: 'Basic ' + Buffer.from('alejandro:' + token).toString('base64')}})).ok);

    await click('#video-render-form details summary');
    const assets = path.join(fixture, 'data', 'assets');
    const files = JSON.parse(await fs.readFile(path.join(fixture, 'fixture.json'), 'utf8')).assets;
    // The fixture uses opaque asset names; label their copies for the UI selectors.
    await fs.copyFile(path.join(assets, files.voice), path.join(output, 'voice.wav'));
    await fs.copyFile(path.join(assets, files.music), path.join(output, 'music.wav'));
    await browser('upload', '#video-upload', path.join(output, 'voice.wav'), path.join(assets, files.video), path.join(output, 'music.wav'));
    await wait('document.getElementById("video-assets").querySelectorAll("[data-remove-asset]").length === 3 && !document.getElementById("video-refresh").disabled');
    const uploaded = await api('/assets');
    await browser('select', '#video-materials', 'own'); await browser('select', '#video-tts', 'uploaded');
    await browser('select', '#video-audio', uploaded.find(a => a.name === 'voice.wav').id);
    await browser('select', '#video-music', uploaded.find(a => a.name === 'music.wav').id);
    for (let i = 1; i < 6; i++) await browser('uncheck', '[data-render-block="' + i + '"]');
    await screenshot('factory-desktop.png', '#video-factory');
    await click('#video-render');
    await wait('document.querySelector("[data-video-action=preview]") !== null');
    const jobs = await api('/jobs'), original = jobs.find(j => j.kind === 'render');
    assert.equal(original.state, 'completed');
    assert.ok(Math.abs(original.result.durationSeconds - 6) < .2);
    await click('[data-video-action="preview"]');
    await wait('document.getElementById("video-preview").readyState >= 1 && !document.getElementById("video-refresh").disabled');
    assert.ok(await value('document.getElementById("video-preview").videoWidth > 0 && !document.getElementById("video-preview").error'));
    await value('document.getElementById("video-preview").play().then(() => true)');
    await wait('document.getElementById("video-preview").currentTime > .25');
    await value('document.getElementById("video-preview").pause()');
    await screenshot('jobs-desktop.png', '#video-jobs');
    await click('[data-video-action="transcript"]');
    await wait('document.getElementById("video-transcript").querySelector("button") !== null');
    await value('document.getElementById("video-transcript").closest("details").open = true');
    await click('#video-transcript button:first-child');
    await browser('fill', '#video-cut-start', '0');
    await browser('fill', '#video-cut-end', '1');
    await click('#video-cut');
    await wait('document.querySelectorAll("[data-video-action=preview]").length === 2');
    const clipped = (await api('/jobs')).find(j => j.kind === 'clip');
    assert.equal(clipped.state, 'completed'); assert.equal(clipped.result.width, 720); assert.equal(clipped.result.height, 1280);
    const pageErrors = await browser('errors');
    assert.ok(Array.isArray(pageErrors.errors), 'Browser did not return its error report');
    assert.equal(pageErrors.errors.length, 0, JSON.stringify(pageErrors));
    await browser('set', 'viewport', '390', '844');
    const comparisonLayout = await value('(() => {const p = document.getElementById("replicate-value-panel"), r = p.getBoundingClientRect(); const lists = [...p.querySelectorAll(".value-scroll")].map(el => ({height: el.clientHeight, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth})); return {left:r.left, right:r.right, bottom:r.bottom, lists};})()');
    assert.ok(comparisonLayout.left >= 0 && comparisonLayout.right <= 390 && comparisonLayout.bottom <= 844);
    assert.ok(comparisonLayout.lists.every(l => l.height > 20 && l.scrollWidth <= l.clientWidth + 2), 'Permanent model lists must remain visible without overflow on mobile: ' + JSON.stringify(comparisonLayout));
    await fs.writeFile(path.join(output, 'model-comparison-layout.json'), JSON.stringify(comparisonLayout, null, 2));
    await screenshot('model-comparison-mobile.png', '#replicate-value-panel');
    await screenshot('factory-mobile.png', '#video-factory');
    await screenshot('jobs-mobile.png', '#video-jobs');
    const layout = await value('(() => {const box = document.getElementById("video-factory"), rect = box.getBoundingClientRect(); return {clientWidth: box.clientWidth, scrollWidth: box.scrollWidth, overflow: [...box.querySelectorAll("*")].filter(el => {const r = el.getBoundingClientRect(); return r.width > 0 && r.right > rect.right + 2;}).slice(0, 20).map(el => ({tag: el.tagName, id: el.id, class: el.className, text: el.textContent.slice(0, 120)}))};})()');
    await fs.writeFile(path.join(output, 'mobile-layout.json'), JSON.stringify(layout, null, 2));
    assert.ok(layout.scrollWidth <= layout.clientWidth + 2, 'Factory overflows on mobile: ' + JSON.stringify(layout));
    await fs.writeFile(path.join(output, 'browser-report.json'), JSON.stringify({pageErrors, original: original.result, clip: clipped.result, mobileWidth: 390}, null, 2));
    await wait('!document.getElementById("video-clean-temp").disabled');
    await value('window.cleanupClicks = 0; window.cleanupConfirmations = 0; document.getElementById("video-clean-temp").addEventListener("click", () => window.cleanupClicks++); window.confirm = () => {window.cleanupConfirmations++; return true;}; true');
    await click('#video-clean-temp');
    await wait('document.getElementById("video-connection").textContent.includes("Temporales eliminados")');
    assert.equal(await value('window.cleanupClicks'), 1);
    assert.equal(await value('window.cleanupConfirmations'), 1);
    assert.equal((await api('/jobs')).length, 0); assert.equal((await api('/assets')).length, 0);
    assert.equal((await fs.readdir(path.join(output, 'server-data', 'jobs'))).length, 0);
    assert.equal((await fs.readdir(path.join(output, 'server-data', 'assets'))).length, 0);
    assert.ok(await value('!!window.getCreatorProduction()'));
    assert.equal((await browser('errors')).errors.length, 0);
    console.log('Real browser check passed: private site, connect, upload, render, playable preview, transcript, portrait clip, mobile layout and temporary-file cleanup.');
  } catch (error) {
    await fs.writeFile(path.join(output, 'server.log'), serverLog);
    const failure = await value('({status: document.getElementById("video-connection")?.textContent, error: document.getElementById("video-error")?.textContent, cleanDisabled: document.getElementById("video-clean-temp")?.disabled, cleanupClicks: window.cleanupClicks, cleanupConfirmations: window.cleanupConfirmations})').catch(() => null);
    await fs.writeFile(path.join(output, 'failure-state.json'), JSON.stringify(failure, null, 2));
    console.error('Browser failure state:', failure);
    await browser('screenshot', path.join(output, 'error.png')).catch(() => {});
    throw error;
  } finally {
    await browser('close').catch(() => {}); server.kill('SIGINT');
    await new Promise(resolve => { if (server.exitCode !== null) return resolve(); const timeout = setTimeout(() => {server.kill('SIGKILL'); resolve();}, 10000); server.once('exit', () => {clearTimeout(timeout); resolve();}); });
  }

  const render = path.join(root, 'remotion', 'node_modules', '.bin', process.platform === 'win32' ? 'remotion.cmd' : 'remotion');
  const rendered = path.join(output, 'remotion.mp4');
  const args = ['render', 'src/index.tsx', 'StudioVideo', rendered, '--props=' + path.join(fixture, 'project', 'remotion-input.json'), '--public-dir=' + path.join(fixture, 'project'), '--concurrency=2', '--timeout=60000'];
  if (process.env.YT_BROWSER_BIN) args.push('--browser-executable=' + process.env.YT_BROWSER_BIN);
  try { await command(render, args, {cwd: path.join(root, 'remotion')}); }
  catch (error) { await fs.writeFile(path.join(output, 'remotion.log'), (error.stdout || '') + (error.stderr || '')); throw error; }
  const meta = await metadata(rendered), video = meta.streams.find(s => s.codec_type === 'video');
  assert.equal(video.width, exported.width); assert.equal(video.height, exported.height);
  assert.equal(video.codec_name, 'h264'); assert.ok(meta.streams.some(s => s.codec_type === 'audio'));
  assert.ok(Math.abs(Number(meta.format.duration) - exported.durationInFrames / exported.fps) < .2);
  const pcm = (await command('ffmpeg', ['-v', 'error', '-i', rendered, '-t', '1', '-ac', '1', '-ar', '24000', '-f', 's16le', 'pipe:1'], {encoding: null})).stdout;
  const amplitude = frequency => {
    let sine = 0, cosine = 0;
    for (let i = 0; i < pcm.length / 2; i++) {const sample = pcm.readInt16LE(i * 2); sine += sample * Math.sin(2 * Math.PI * frequency * i / 24000); cosine += sample * Math.cos(2 * Math.PI * frequency * i / 24000);}
    return Math.hypot(sine, cosine);
  };
  const musicRatio = amplitude(880) / amplitude(220);
  assert.ok(musicRatio > .05 && musicRatio < .3, 'The rendered soundtrack must contain the selected music at reduced volume');
  await command('ffmpeg', ['-y', '-v', 'error', '-ss', '3', '-i', rendered, '-frames:v', '1', '-update', '1', path.join(output, 'remotion-frame.png')]);
  await fs.writeFile(path.join(output, 'remotion-report.json'), JSON.stringify({duration: meta.format.duration, width: video.width, height: video.height, codec: video.codec_name, musicRatio, music: exported.music, scenes: exported.scenes.length}, null, 2));
  console.log('Real Remotion render passed: exported images, video seek, narration, looping music, captions and MP4 metadata.');
}
main().catch(error => {console.error(error.stack || error.message); process.exitCode = 1;});
