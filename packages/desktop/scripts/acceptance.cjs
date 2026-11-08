const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const WebSocket = require('ws');
const { connectToAlbumDone } = require('./cdp-client.cjs');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

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
const largeGroup = path.join(fixtureRoot, 'LargeGroup');
for (const directory of [evidence, profile, unique, duplicates, memories, deletion, largeGroup]) fs.mkdirSync(directory, { recursive: true });
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
fs.copyFileSync(original, path.join(duplicates, 'third.jpg'));
fs.copyFileSync(original, path.join(deletion, 'original.jpg'));
fs.copyFileSync(original, path.join(deletion, 'copy.jpg'));
for (let index = 0; index < 30; index++) fs.copyFileSync(original, path.join(largeGroup, `copy-${index}.jpg`));
for (let month = 0; month < 11; month++) for (let candidate = 0; candidate < 2; candidate++) {
  const date = new Date(); date.setMonth(date.getMonth() - month, 1 + candidate * 3); date.setHours(12, 0, 0, 0);
  fixture(memories, `memory-${month}-${candidate}.jpg`, `memory-${month}-${candidate}`, date);
}
fs.writeFileSync(path.join(profile, 'recent-folders.json'), JSON.stringify([
  { id: unique, title: 'Unique', photoCount: 130 },
  { id: duplicates, title: 'Duplicates', photoCount: 3 },
  { id: memories, title: 'Memories', photoCount: 22 },
  { id: deletion, title: 'Deletion', photoCount: 2 },
  { id: largeGroup, title: 'LargeGroup', photoCount: 30 },
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
  const errors = []; const steps = []; const dialogs = []; let socket;
  let allowDeletionConfirmation = false;
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
    const callFunction = client.callFunction;
    socket.on('message', raw => {
      const message = JSON.parse(String(raw));
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
      if (message.method === 'Page.javascriptDialogOpening') {
        dialogs.push(message.params.message);
        if (!allowDeletionConfirmation) errors.push(`Unexpected dialog: ${message.params.message}`);
        void command('Page.handleJavaScriptDialog', { accept: allowDeletionConfirmation }).catch(error => errors.push(error.message));
      }
    });
    async function until(expression, message, timeout = 120000, args = []) {
      const started = Date.now();
      while (Date.now() - started < timeout) {
        const result = typeof expression === 'function'
          ? await callFunction(expression, ...args)
          : await evaluate(`Boolean(${expression})`);
        if (result) return result;
        await pause(100);
      }
      throw new Error(`${message}\n${await evaluate('document.body.innerText')}`);
    }
    async function pointer(selector, match = {}) {
      const point = await until(function (selector, match) {
        const elements = Array.from(document.querySelectorAll(selector));
        const element = match.text !== undefined
          ? elements.find(item => item.innerText.trim() === match.text)
          : match.title !== undefined
            ? elements.find(item => item.querySelector('strong')?.textContent === match.title)
            : elements[0];
        if (!element) return null;
        if (element.disabled) throw new Error('Cannot click disabled control');
        element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        const rect = element.getBoundingClientRect();
        const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
        if (!rect.width || !rect.height || !element.contains(document.elementFromPoint(x, y))) {
          throw new Error('Control is obscured or outside the viewport');
        }
        return { x, y };
      }, `Missing pointer target: ${selector}`, 120000, [selector, match]);
      await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
      await command('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
      await command('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
      await pause(120);
    }
    async function click(selector) {
      await pointer(selector);
    }
    async function button(text) {
      await pointer('button', { text });
    }
    async function screenshot(name) {
      const result = await command('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(evidence, `${name}.png`), Buffer.from(result.data, 'base64'));
    }
    async function language(locale) {
      await callFunction(function (locale) {
        const s = document.querySelector('[data-testid="language-select"]');
        s.value = locale; s.dispatchEvent(new Event('change', { bubbles: true }));
      }, locale);
      await until(function (locale) { return document.documentElement.lang === locale; }, `Locale failed: ${locale}`, 120000, [locale]);
    }
    async function home() { await evaluate(`location.hash = '#/'`); await until(`document.querySelectorAll('[data-testid^="mode-"]').length === 3`, 'Home did not show three workflows'); }
    async function album(name) { await home(); await pointer('button', { title: name }); await pause(150); }
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
    assert.match(await evaluate('document.querySelector(\'[data-testid="dedupe-confirm"]\').innerText'), /2/);
    await screenshot('dedupe-group-preview');
    const preserve = (await evaluate('document.body.innerText')).match(/(?:Preview|preview)[^\n]*/g);
    assert(preserve?.length, 'Group preview needs an explicit preview label');
    await click('[data-testid="dedupe-thumbnail"]:nth-child(3) [data-testid="dedupe-keep-only"]');
    assert.equal(await evaluate(`document.querySelectorAll('[data-testid="dedupe-thumbnail"]')[2].querySelector('[data-testid="dedupe-toggle-delete"]').disabled`), true, 'The last keeper must be visibly protected');
    assert.equal(await evaluate(`document.querySelectorAll('[data-testid="dedupe-preview"]')[2].getAttribute('aria-pressed')`), 'true', 'Keep-only must update the preview');
    await click('[data-testid="dedupe-preview"]');
    assert.equal(await evaluate(`document.querySelectorAll('[data-testid="dedupe-preview"]')[0].getAttribute('aria-pressed')`), 'true');
    assert.equal(await evaluate(`document.querySelectorAll('[data-testid="dedupe-thumbnail"]')[2].querySelector('[data-testid="dedupe-toggle-delete"]').disabled`), true, 'Previewing another photo must preserve the keeper');
    await language('zh-Hant'); await pause(500); await language('en'); await pause(500);
    assert.equal(await evaluate(`document.querySelectorAll('[data-testid="dedupe-thumbnail"]')[2].querySelector('[data-testid="dedupe-toggle-delete"]').disabled`), true, 'Language changes must preserve review choices');
    await click('[data-testid="dedupe-choose-batch"]');
    await click('[data-testid="dedupe-resume"]');
    await until(`document.querySelectorAll('[data-testid="dedupe-thumbnail"]').length === 3`, 'Saved review did not resume');
    assert.equal(await evaluate(`document.querySelectorAll('[data-testid="dedupe-thumbnail"]')[2].querySelector('[data-testid="dedupe-toggle-delete"]').disabled`), true, 'Returning to setup must preserve review choices');
    await click('[data-testid="dedupe-keep-all"]');
    assert.equal(await evaluate(`document.querySelector('[data-testid="dedupe-confirm"]').disabled`), true, 'Keep-all must clear every pending deletion');
    await click('[data-testid="dedupe-toggle-delete"]');
    assert.match(await evaluate(`document.querySelector('[data-testid="dedupe-confirm"]').innerText`), /1/);
    await click('[data-testid="dedupe-toggle-delete"]');
    assert.equal(await evaluate(`document.querySelector('[data-testid="dedupe-confirm"]').disabled`), true, 'Cancelling a pending deletion must keep the photo');
    await screenshot('dedupe-keep-all');
    record('Real pointer: three-photo default selection, keeper replacement, independent preview, keep-all, cancellation and review persistence across locale/route changes');

    await album('Duplicates'); await click('[data-testid="mode-culling"]');
    await until(`document.querySelector('[data-testid="culling-start"]')`, 'Manual setup missing');
    await button('Custom');
    await evaluate(`(() => { const input = document.querySelector('input[type="number"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '2');
      input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await click('[data-testid="culling-start"]');
    await until(`document.querySelector('[data-testid="culling-keep"]')`, 'Manual review did not start');
    const firstManualPhoto = await evaluate(`document.querySelector('img:not([aria-hidden])').alt`);
    assert.equal(await evaluate(`document.querySelector('[data-testid="culling-prev"]').disabled`), true);
    await click('[data-testid="culling-next"]');
    assert.notEqual(await evaluate(`document.querySelector('img:not([aria-hidden])').alt`), firstManualPhoto);
    await click('[data-testid="culling-prev"]');
    assert.equal(await evaluate(`document.querySelector('img:not([aria-hidden])').alt`), firstManualPhoto, 'Mouse navigation must not decide or skip photos');
    await screenshot('manual-mouse-navigation');
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
    const rangeColor = await evaluate(`getComputedStyle(document.querySelector('[data-testid="year-range-rolling"]')).backgroundColor`);
    await click('[data-testid="year-range-previousYear"]');
    assert.equal(await evaluate(`document.querySelector('[data-testid="year-range-previousYear"]').getAttribute('aria-pressed')`), 'true');
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-testid="year-range-previousYear"]')).backgroundColor`), rangeColor);
    assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('[data-testid="year-range-rolling"]')).backgroundColor`), rangeColor, 'Range choice needs visible selection feedback');
    await screenshot('year-range-selection');
    await click('[data-testid="year-range-rolling"]');
    await click('[data-testid="year-generate"]');
    await until(`document.querySelectorAll('[data-month]').length === 12`, 'Year review must show twelve actual months');
    await until(`[...document.querySelectorAll('[data-month] img')].every(i => i.complete && i.naturalWidth > 0)`, 'Review images did not load');
    const originalReviewPhoto = await evaluate(`document.querySelector('[data-month] img').src`);
    await click('article[data-month]:has(img) button');
    await until(`document.querySelector('[role="dialog"]')`, 'Month photo chooser missing');
    await click('[role="dialog"] button[aria-pressed="false"]');
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
    await language('zh-Hant');
    await click('[data-testid="year-save"]');
    await until(`document.body.innerText.includes('AlbumDone-review-')`, 'Chinese export did not save');
    const chineseExport = await evaluate(`Array.from(document.querySelectorAll('p')).map(p => p.textContent).find(text => /AlbumDone-review-.*\\.jpg$/.test(text))`);
    assert(chineseExport && fs.existsSync(chineseExport), 'Chinese export must be an actual saved JPG');
    fs.copyFileSync(chineseExport, path.join(evidence, 'year-export-zh-Hant.jpg'));
    const exportedImage = await loadImage(chineseExport);
    const exportedCanvas = createCanvas(exportedImage.width, exportedImage.height);
    const exportedContext = exportedCanvas.getContext('2d'); exportedContext.drawImage(exportedImage, 0, 0);
    const titleInk = exportedContext.getImageData(20, 8, 1400, 45).data;
    const titleRows = new Set();
    for (let y = 0; y < 45; y++) for (let x = 0; x < 1400; x++) {
      const offset = (y * 1400 + x) * 4;
      if (titleInk[offset] < 100 && titleInk[offset + 1] < 110 && titleInk[offset + 2] < 130) titleRows.add(y);
    }
    assert(titleRows.size >= 20, 'Packaged Chinese export must contain full-height readable title glyphs');
    record('Actual Chinese JPG export copied and checked for readable title glyphs');
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
          const text = await callFunction(function (mode) { return document.querySelector(`[data-testid="mode-${mode}"]`).innerText; }, mode);
          for (const key of keys) assert(text.includes(dictionary[key]), `${locale}: untranslated home card ${key}`);
        }
        assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `${locale}/${width}: horizontal overflow`);
        await screenshot(`home-${locale}-${width}`);
        await click('[data-testid="mode-dedup"]');
        await until(`document.querySelector('[data-testid="dedupe-start"]')`, `${locale}: dedupe setup missing`);
        assert(await callFunction(function (text) { return document.body.innerText.includes(text); }, dictionary['dedup.checkQuantity']));
        await screenshot(`dedupe-${locale}-${width}`);
      }
    }
    await language('en'); await album('LargeGroup'); await click('[data-testid="mode-dedup"]');
    await click('[data-testid="dedupe-start"]');
    await until(`document.querySelector('[data-testid="dedupe-group"]')`, 'Virtualized duplicate group missing');
    for (const width of [900, 1280]) {
      await command('Emulation.setDeviceMetricsOverride', { width, height: width === 900 ? 600 : 800, deviceScaleFactor: 1, mobile: false });
      for (const locale of locales) {
        await language(locale); await pause(100);
        assert.equal(await evaluate(`Array.from(document.querySelectorAll('[data-testid="dedupe-thumbnail"]')).every(card => {
          const bounds = card.getBoundingClientRect();
          return Array.from(card.querySelectorAll('button')).every(button => {
            const rect = button.getBoundingClientRect(); return rect.bottom <= bounds.bottom + 1 && rect.right <= bounds.right + 1;
          }); })`), true, `${locale}/${width}: duplicate actions clipped`);
        const dictionary = JSON.parse(fs.readFileSync(path.join(appRoot, '../shared/src/i18n/locales', `${locale}.json`), 'utf8'));
        assert.equal(await evaluate(`document.querySelector('[data-testid="local-processing-info"] p').innerText`), dictionary['home.privacyBody']);
        await click('[data-testid="dedupe-keep-all"]');
        assert.equal(await evaluate(`document.querySelector('[data-testid="dedupe-confirm"]').disabled`), true);
        await click('[data-testid="dedupe-keep-only"]');
        assert.match(await evaluate(`document.querySelector('[data-testid="dedupe-confirm"]').innerText`), /29/);
        await screenshot(`dedupe-review-${locale}-${width}`);
      }
    }
    record('15 languages × 2 viewport sizes: home, batch setup, manual view, year review and virtualized duplicate actions checked with real pointer input');
    await language('en'); await album('Deletion'); await click('[data-testid="mode-dedup"]');
    await click('[data-testid="dedupe-start"]');
    await until(`document.querySelector('[data-testid="dedupe-confirm"]:not(:disabled)')`, 'Synthetic deletion selection missing');
    allowDeletionConfirmation = true;
    await click('[data-testid="dedupe-confirm"]');
    await until(`!document.querySelector('[data-testid="dedupe-confirm"]')`, 'Confirmed deletion did not finish');
    allowDeletionConfirmation = false;
    assert.equal(dialogs.length, 1, 'Only the requested real deletion should open a confirmation dialog');
    assert.equal(fs.readdirSync(deletion).filter(name => /\.jpg$/i.test(name)).length, 1, 'Only the selected duplicate should leave its source folder');
    await screenshot('confirmed-real-trash');
    record('Actual UI confirmation and native recycle-bin deletion of one synthetic duplicate');
    assert.deepEqual(errors, [], 'Production renderer exceptions');
    fs.writeFileSync(path.join(evidence, 'runtime-report.json'), JSON.stringify({ executable, profile, fixtures: fixtureRoot,
      steps, errors, dialogs, timestamp: new Date().toISOString(), version: await evaluate('window.electronAPI.app.getVersion()') }, null, 2));
    completed = true;
    console.log(JSON.stringify({ passed: true, evidence, steps }));
  } finally {
    fs.writeFileSync(path.join(evidence, 'process.log'), output);
    if (socket?.readyState === WebSocket.OPEN) socket.close();
    child.kill();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
