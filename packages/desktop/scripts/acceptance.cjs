const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const WebSocket = require('ws');
const { connectToAlbumDone } = require('./cdp-client.cjs');
const { createCanvas } = require('@napi-rs/canvas');

let completed = false;
process.on('beforeExit', code => {
  if (code === 0 && !completed) process.exitCode = 1;
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const appRoot = path.resolve(__dirname, '..');
const evidence = path.resolve(process.env.ALBUMDONE_ACCEPTANCE_OUTPUT || path.join(appRoot, 'test-results/acceptance'));
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'albumdone-acceptance-'));
const profile = path.join(fixtureRoot, 'profile');
const unique = path.join(fixtureRoot, 'Unique');
const duplicates = path.join(fixtureRoot, 'Duplicates');
const memories = path.join(fixtureRoot, 'Memories');
const deletion = path.join(fixtureRoot, 'Deletion');
for (const directory of [evidence, profile, unique, duplicates, memories, deletion]) fs.mkdirSync(directory, { recursive: true });
function fixture(directory, name, seed, date = new Date()) {
  const canvas = createCanvas(640, 480);
  const ctx = canvas.getContext('2d');
  const bytes = createHash('sha512').update(String(seed)).digest();
  for (let row = 0; row < 8; row++) for (let column = 0; column < 8; column++) {
    const index = (row * 8 + column) % 64;
    ctx.fillStyle = `rgb(${bytes[index]},${bytes[(index + 19) % 64]},${bytes[(index + 37) % 64]})`;
    ctx.fillRect(column * 80, row * 60, 80, 60);
  }
  const filename = path.join(directory, name);
  fs.writeFileSync(filename, canvas.toBuffer('image/jpeg'));
  fs.utimesSync(filename, date, date);
  return filename;
}
for (let index = 0; index < 130; index++) fixture(unique, `journey-${index}.jpg`, index);
const original = fixture(duplicates, 'original.jpg', 'duplicate');
fs.copyFileSync(original, path.join(duplicates, 'copy.jpg'));
fixture(duplicates, 'different.jpg', 'different');
fs.copyFileSync(original, path.join(deletion, 'original.jpg'));
fs.copyFileSync(original, path.join(deletion, 'copy.jpg'));
for (let month = 0; month < 11; month++) for (let candidate = 0; candidate < 2; candidate++) {
  const date = new Date(); date.setMonth(date.getMonth() - month, 1 + candidate * 3); date.setHours(12, 0, 0, 0);
  fixture(memories, `memory-${month}-${candidate}.jpg`, `memory-${month}-${candidate}`, date);
}
fs.writeFileSync(path.join(profile, 'recent-folders.json'), JSON.stringify([
  { id: unique, title: 'Unique', photoCount: 130 },
  { id: duplicates, title: 'Duplicates', photoCount: 3 },
  { id: memories, title: 'Memories', photoCount: 22 },
  { id: deletion, title: 'Deletion', photoCount: 2 },
]));

async function getTargets(port) {
  return new Promise((resolve, reject) => {
    const request = http.get(`http://127.0.0.1:${port}/json/list`, response => {
      let body = ''; response.on('data', chunk => { body += chunk; });
      response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
      response.on('error', reject);
    });
    request.on('error', reject); request.setTimeout(3000, () => request.destroy(new Error('CDP discovery timed out')));
  });
}
async function freePort() {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address(); await new Promise(resolve => server.close(resolve)); return port;
}
async function main() {
  const executable = process.env.ALBUMDONE_ACCEPTANCE_EXE || require('electron');
  const port = await freePort();
  const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`];
  if (!process.env.ALBUMDONE_ACCEPTANCE_EXE) args.unshift(appRoot);
  const environment = { ...process.env, NODE_ENV: 'production' };
  delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, args, { cwd: appRoot, windowsHide: true,
    env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  const errors = []; const steps = []; let socket;
  const record = step => { steps.push(step); process.stderr.write(`${step}\n`); };
  try {
    let target;
    for (let attempt = 0; attempt < 150; attempt++) {
      try { target = (await getTargets(port)).find(item => item.type === 'page'); } catch { /* App is starting. */ }
      if (target) break;
      if (child.exitCode !== null) throw new Error(`Application exited: ${child.exitCode}\n${output}`);
      await pause(200);
    }
    assert(target, `Production renderer did not start. ${output}`);
    const client = await connectToAlbumDone(port);
    socket = client.socket;
    const command = client.send;
    const evaluate = client.evaluate;
    socket.on('message', raw => {
      const message = JSON.parse(String(raw));
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
      if (message.method === 'Page.javascriptDialogOpening') {
        void command('Page.handleJavaScriptDialog', { accept: true }).catch(error => errors.push(error.message));
      }
    });
    async function until(expression, message, timeout = 120000) {
      const started = Date.now();
      while (Date.now() - started < timeout) {
        if (await evaluate(`Boolean(${expression})`)) return;
        await pause(100);
      }
      throw new Error(`${message}\n${await evaluate('document.body.innerText')}`);
    }
    async function click(selector) {
      await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, `Missing ${selector}`);
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
      await pause(120);
    }
    async function button(text) {
      await until(`[...document.querySelectorAll('button')].some(b => b.innerText.trim() === ${JSON.stringify(text)})`, `Missing button: ${text}`);
      await evaluate(`[...document.querySelectorAll('button')].find(b => b.innerText.trim() === ${JSON.stringify(text)}).click()`);
      await pause(120);
    }
    async function screenshot(name) {
      const result = await command('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(evidence, `${name}.png`), Buffer.from(result.data, 'base64'));
    }
    async function language(locale) {
      await evaluate(`(() => { const s = document.querySelector('[data-testid="language-select"]'); s.value = ${JSON.stringify(locale)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await until(`document.documentElement.lang === ${JSON.stringify(locale)}`, `Locale failed: ${locale}`);
    }
    async function home() { await evaluate(`location.hash = '#/'`); await until(`document.querySelectorAll('[data-testid^="mode-"]').length === 3`, 'Home did not show three workflows'); }
    async function album(name) { await home(); await until(`[...document.querySelectorAll('button')].some(b => b.querySelector('strong')?.textContent === ${JSON.stringify(name)})`, `Recent folder missing: ${name}`); await evaluate(`[...document.querySelectorAll('button')].find(b => b.querySelector('strong')?.textContent === ${JSON.stringify(name)}).click()`); await pause(150); }
    await command('Runtime.enable');
    await command('Page.enable');
    await until(`document.querySelector('[data-testid="language-select"]')`, 'Language selector did not appear');
    await language('en');
    assert.equal(await evaluate(`window.electronAPI.app.getPath('userData')`), profile, 'Acceptance must use the isolated profile');
    record('Production launch and isolated real SQLite profile');
    await album('Unique'); await click('[data-testid="mode-dedup"]');
    await until(`document.querySelector('[data-testid="dedupe-start"]')`, 'Fresh dedupe setup missing');
    assert.equal(await evaluate(`Boolean(document.querySelector('[data-testid="dedupe-resume"], [data-testid="dedupe-restart"]'))`), false, 'Fresh library must not claim an old task');
    await button('100'); await click('[data-testid="dedupe-start"]');
    await until(`document.querySelector('[data-testid="dedupe-choose-batch"]')`, 'First scan did not complete');
    const firstResult = await evaluate('document.body.innerText');
    assert.match(firstResult, /100\s*\/\s*130/);
    assert.match(firstResult, /No duplicate|No similar/i, 'Synthetic distinct photos must have no matches');
    await screenshot('dedupe-100-no-matches');
    await click('[data-testid="dedupe-choose-batch"]');
    await until(`document.querySelector('[data-testid="dedupe-start"]')`, 'Return must open batch setup');
    assert.equal(await evaluate(`Boolean(document.querySelector('[data-testid="dedupe-resume"]'))`), false, 'Completed no-match scan must not appear interrupted');
    await button('500'); await click('[data-testid="dedupe-start"]');
    await until(`document.querySelector('[data-testid="dedupe-choose-batch"]')`, 'Remaining scan did not complete');
    assert.match(await evaluate('document.body.innerText'), /30\s*\/\s*130/);
    await click('[data-testid="dedupe-choose-batch"]');
    assert.match(await evaluate('document.body.innerText'), /130/);
    record('100-photo no-match return, quantity change and remaining 30-photo batch');

    await album('Duplicates'); await click('[data-testid="mode-dedup"]');
    await click('[data-testid="dedupe-start"]');
    await until(`document.querySelector('[data-testid="dedupe-choose-batch"]')`, 'Duplicate review missing');
    assert.match(await evaluate('document.body.innerText'), /1\s+(?:photo|selected|to delete)|delete\s+1/i);
    await screenshot('dedupe-group-preview');
    const preserve = (await evaluate('document.body.innerText')).match(/(?:Preview|preview)[^\n]*/g);
    assert(preserve?.length, 'Group preview needs an explicit preview label');
    const keepAll = JSON.parse(fs.readFileSync(path.join(appRoot, '../shared/src/i18n/locales/en.json'), 'utf8'))['dedup.keepGroupAll'];
    await button(keepAll);
    await screenshot('dedupe-keep-all');
    record('Exact duplicate default selection, labelled group preview and keep-all action');

    await album('Duplicates'); await click('[data-testid="mode-culling"]');
    await until(`document.querySelector('[data-testid="culling-start"]')`, 'Manual setup missing');
    await button('Custom');
    await evaluate(`(() => { const input = document.querySelector('input[type="number"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '2');
      input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await click('[data-testid="culling-start"]');
    await until(`document.querySelector('[data-testid="culling-keep"]')`, 'Manual review did not start');
    const firstManualPhoto = await evaluate(`document.querySelector('img:not([aria-hidden])').alt`);
    await click('[data-testid="culling-delete"]'); await pause(320);
    const dictionaryEn = JSON.parse(fs.readFileSync(path.join(appRoot, '../shared/src/i18n/locales/en.json'), 'utf8'));
    await click(`button[title=${JSON.stringify(dictionaryEn['culling.undoHint'])}]`); await pause(100);
    assert.equal(await evaluate(`document.querySelector('img:not([aria-hidden])').alt`), firstManualPhoto, 'Undo must return to the decided photo');
    for (let index = 0; index < 2; index++) { await click('[data-testid="culling-keep"]'); await pause(320); }
    await until(`document.querySelector('[data-testid="culling-next-batch"]')`, 'Manual completion missing');
    await screenshot('manual-review-complete');
    await click('[data-testid="culling-next-batch"]');
    await click('[data-testid="culling-start"]');
    await until(`document.querySelector('[data-testid="culling-keep"]')`, 'Manual next batch did not start');
    assert.notEqual(await evaluate(`document.querySelector('img:not([aria-hidden])').alt`), firstManualPhoto, 'Next batch must advance past reviewed items');
    await click('[data-testid="culling-keep"]'); await pause(320);
    await until(`document.querySelector('[data-testid="culling-next-batch"]')`, 'Final manual completion missing');
    record('Manual custom batch, keep/delete, undo, next batch and remaining-photo selection');

    await album('Memories'); await click('[data-testid="mode-yearInReview"]');
    await click('button.primary-action');
    await until(`document.querySelectorAll('[data-month]').length === 12`, 'Year review must show twelve actual months');
    await until(`[...document.querySelectorAll('[data-month] img')].every(i => i.complete && i.naturalWidth > 0)`, 'Review images did not load');
    const originalReviewPhoto = await evaluate(`document.querySelector('[data-month] img').src`);
    await evaluate(`document.querySelector('[data-month] img').closest('article').querySelector('button').click()`);
    await until(`document.querySelector('[role="dialog"]')`, 'Month photo chooser missing');
    await evaluate(`document.querySelector('[role="dialog"] button[aria-pressed="false"]').click()`);
    await until(`!document.querySelector('[role="dialog"]')`, 'Photo chooser did not close');
    assert.notEqual(await evaluate(`document.querySelector('[data-month] img').src`), originalReviewPhoto);
    await screenshot('year-review-12-months');
    const dictionary = JSON.parse(fs.readFileSync(path.join(appRoot, '../shared/src/i18n/locales/en.json'), 'utf8'));
    await button(dictionary['common.save']);
    await until(`document.body.innerText.includes('AlbumDone-review-')`, 'Year export did not save');
    record('Twelve-month local image rendering and actual native JPG export');

    const locales = fs.readdirSync(path.join(appRoot, '../shared/src/i18n/locales')).map(file => file.replace('.json', ''));
    const encouragements = require('@photo-manager/shared').MONTHLY_ENCOURAGEMENTS;
    for (const width of [900, 1280]) {
      await command('Emulation.setDeviceMetricsOverride', { width, height: width === 900 ? 600 : 800, deviceScaleFactor: 1, mobile: false });
      for (const locale of locales) {
        await language(locale); await pause(100);
        const quote = await evaluate(`document.querySelector('[data-month] button[aria-label] span').textContent`);
        assert(encouragements[locale].includes(quote), `${locale}: previously generated quotes must switch language`);
        await screenshot(`year-${locale}-${width}`);
      }
    }
    await language('en'); await album('Memories'); await click('[data-testid="mode-culling"]');
    await click('[data-testid="culling-start"]');
    await until(`document.querySelector('[data-testid="culling-keep"]')`, 'Manual image view missing');
    await until(`document.querySelector('img:not([aria-hidden])')?.naturalWidth > 0`, 'Manual image must load');
    for (const width of [900, 1280]) {
      await command('Emulation.setDeviceMetricsOverride', { width, height: width === 900 ? 600 : 800, deviceScaleFactor: 1, mobile: false });
      for (const locale of locales) {
        await language(locale); await screenshot(`manual-${locale}-${width}`);
      }
    }
    for (const width of [900, 1280]) {
      await command('Emulation.setDeviceMetricsOverride', { width, height: width === 900 ? 600 : 800, deviceScaleFactor: 1, mobile: false });
      for (const locale of locales) {
        await home(); await language(locale); await pause(100);
        const dictionary = JSON.parse(fs.readFileSync(path.join(appRoot, '../shared/src/i18n/locales', `${locale}.json`), 'utf8'));
        assert.equal(await evaluate(`document.querySelector('h1').textContent`), dictionary['home.title']);
        for (const [mode, keys] of Object.entries({ dedup: ['home.modes.dedup.title', 'home.modes.dedup.shortSubtitle', 'dedup.startCheck'], culling: ['home.modes.culling.title', 'home.modes.culling.shortSubtitle', 'culling.startCulling'], yearInReview: ['yearInReview.title', 'yearInReviewSubtitle', 'yearInReview.generate'] })) {
          const text = await evaluate(`document.querySelector('[data-testid="mode-${mode}"]').innerText`);
          for (const key of keys) assert(text.includes(dictionary[key]), `${locale}: untranslated home card ${key}`);
        }
        assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `${locale}/${width}: horizontal overflow`);
        await screenshot(`home-${locale}-${width}`);
        await click('[data-testid="mode-dedup"]');
        await until(`document.querySelector('[data-testid="dedupe-start"]')`, `${locale}: dedupe setup missing`);
        assert(await evaluate(`document.body.innerText.includes(${JSON.stringify(dictionary['dedup.checkQuantity'])})`));
        await screenshot(`dedupe-${locale}-${width}`);
      }
    }
    record('15 languages × 2 viewport sizes: home, batch setup, manual photo view and twelve-month review captured');
    await language('en'); await album('Deletion'); await click('[data-testid="mode-dedup"]');
    await click('[data-testid="dedupe-start"]');
    await until(`document.querySelector('[data-testid="dedupe-confirm"]:not(:disabled)')`, 'Synthetic deletion selection missing');
    await click('[data-testid="dedupe-confirm"]');
    await until(`!document.querySelector('[data-testid="dedupe-confirm"]')`, 'Confirmed deletion did not finish');
    assert.equal(fs.readdirSync(deletion).filter(name => /\.jpg$/i.test(name)).length, 1, 'Only the selected duplicate should leave its source folder');
    await screenshot('confirmed-real-trash');
    record('Actual UI confirmation and native recycle-bin deletion of one synthetic duplicate');
    assert.deepEqual(errors, [], 'Production renderer exceptions');
    fs.writeFileSync(path.join(evidence, 'runtime-report.json'), JSON.stringify({ executable, profile, fixtures: fixtureRoot,
      steps, errors, timestamp: new Date().toISOString(), version: await evaluate('window.electronAPI.app.getVersion()') }, null, 2));
    completed = true;
    console.log(JSON.stringify({ passed: true, evidence, steps }));
  } finally {
    fs.writeFileSync(path.join(evidence, 'process.log'), output);
    if (socket?.readyState === WebSocket.OPEN) socket.close();
    child.kill();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
