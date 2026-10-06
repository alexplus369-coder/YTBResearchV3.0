/* Real browser + FFmpeg + Remotion check. Only generated fixtures, never cloud providers. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { completeProject } = require('../tests/helpers/creator-fixtures.cjs');
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
    await browser('open', base);
    await wait('document.body.innerText.length > 100 && typeof window.getCreatorProduction === "function"');
    await fs.writeFile(path.join(output, 'page-snapshot.json'), JSON.stringify(await browser('snapshot', '-i'), null, 2));
    assert.equal(await value('!!document.querySelector("[data-nextjs-dialog], .vite-error-overlay")'), false);
    await value('localStorage.setItem("ytCreatorProductionV1", ' + JSON.stringify(JSON.stringify(core.validateProject(completeProject()))) + ')');
    await browser('reload');
    await browser('click', '#creator-tab-studio');
    await browser('fill', '#video-access', token); await browser('click', '#video-connect');
    await wait('document.getElementById("video-connection").textContent.includes("Motor conectado")');
    await wait('getComputedStyle(document.getElementById("video-factory")).borderTopWidth === "1px"');
    assert.equal((await api('/health')).worker, true);
    assert.equal((await api('/jobs')).length, 0);
    assert.ok((await fetch(base + '/docs/video-production.md')).ok);

    await browser('click', '#video-render-form details summary');
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
    await browser('click', '#video-render');
    await wait('document.querySelector("[data-video-action=preview]") !== null');
    const jobs = await api('/jobs'), original = jobs.find(j => j.kind === 'render');
    assert.equal(original.state, 'completed');
    assert.ok(Math.abs(original.result.durationSeconds - 6) < .2);
    await browser('click', '[data-video-action="preview"]');
    await wait('document.getElementById("video-preview").readyState >= 1 && !document.getElementById("video-refresh").disabled');
    assert.ok(await value('document.getElementById("video-preview").videoWidth > 0 && !document.getElementById("video-preview").error'));
    await value('document.getElementById("video-preview").play().then(() => true)');
    await wait('document.getElementById("video-preview").currentTime > .25');
    await value('document.getElementById("video-preview").pause()');
    await screenshot('jobs-desktop.png', '#video-jobs');
    await browser('click', '[data-video-action="transcript"]');
    await wait('document.getElementById("video-transcript").querySelector("button") !== null');
    await value('document.getElementById("video-transcript").closest("details").open = true');
    await browser('click', '#video-transcript button:first-child');
    await browser('fill', '#video-cut-start', '0');
    await browser('fill', '#video-cut-end', '1');
    await browser('click', '#video-cut');
    await wait('document.querySelectorAll("[data-video-action=preview]").length === 2');
    const clipped = (await api('/jobs')).find(j => j.kind === 'clip');
    assert.equal(clipped.state, 'completed'); assert.equal(clipped.result.width, 720); assert.equal(clipped.result.height, 1280);
    const pageErrors = await browser('errors');
    assert.ok(Array.isArray(pageErrors.errors), 'Browser did not return its error report');
    assert.equal(pageErrors.errors.length, 0, JSON.stringify(pageErrors));
    await browser('set', 'viewport', '390', '844');
    await screenshot('factory-mobile.png', '#video-factory');
    await screenshot('jobs-mobile.png', '#video-jobs');
    const layout = await value('(() => {const box = document.getElementById("video-factory"), rect = box.getBoundingClientRect(); return {clientWidth: box.clientWidth, scrollWidth: box.scrollWidth, overflow: [...box.querySelectorAll("*")].filter(el => {const r = el.getBoundingClientRect(); return r.width > 0 && r.right > rect.right + 2;}).slice(0, 20).map(el => ({tag: el.tagName, id: el.id, class: el.className, text: el.textContent.slice(0, 120)}))};})()');
    await fs.writeFile(path.join(output, 'mobile-layout.json'), JSON.stringify(layout, null, 2));
    assert.ok(layout.scrollWidth <= layout.clientWidth + 2, 'Factory overflows on mobile: ' + JSON.stringify(layout));
    await fs.writeFile(path.join(output, 'browser-report.json'), JSON.stringify({pageErrors, original: original.result, clip: clipped.result, mobileWidth: 390}, null, 2));
    console.log('Real browser check passed: connect, upload, render, playable preview, transcript, portrait clip and mobile layout.');
  } catch (error) {
    await fs.writeFile(path.join(output, 'server.log'), serverLog);
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
