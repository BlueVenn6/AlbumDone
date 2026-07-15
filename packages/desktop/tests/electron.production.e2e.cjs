const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..', '..');
const fixtureRoot = path.join(repoRoot, 'packages', 'shared', 'tests', 'fixtures', 'dedupe-golden');

function createGallery(root) {
  const gallery = path.join(root, 'AlbumDone E2E Photos');
  fs.mkdirSync(gallery, { recursive: true });
  const imageFiles = fs.readdirSync(fixtureRoot)
    .filter((name) => /\.(jpe?g|png|webp)$/i.test(name));
  imageFiles.forEach((name, index) => {
    const destination = path.join(gallery, name);
    fs.copyFileSync(path.join(fixtureRoot, name), destination);
    const timestamp = new Date(2026, index % 6, Math.min(24, index + 1), 12, 0, 0);
    fs.utimesSync(destination, timestamp, timestamp);
  });

  const duplicateTarget = path.join(gallery, 'delete-verification-copy.png');
  fs.copyFileSync(path.join(fixtureRoot, 'base-scene.png'), duplicateTarget);
  const duplicateTime = new Date(2026, 6, 1, 12, 0, 0);
  fs.utimesSync(duplicateTarget, duplicateTime, duplicateTime);

  const corruptTarget = path.join(gallery, 'corrupt-image.jpg');
  fs.writeFileSync(corruptTarget, Buffer.from('not an image'));
  const corruptTime = new Date(2020, 0, 1, 12, 0, 0);
  fs.utimesSync(corruptTarget, corruptTime, corruptTime);

  return { gallery, duplicateTarget, expectedCount: imageFiles.length + 2 };
}

async function createMockServer() {
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body,
      });
      response.setHeader('Content-Type', 'application/json');
      if (request.headers.authorization === 'Bearer reject-key') {
        response.statusCode = 401;
        response.end(JSON.stringify({ error: { message: 'Mock key rejected', type: 'authentication_error' } }));
        return;
      }
      if (request.url?.endsWith('/responses')) {
        response.end(JSON.stringify({
          id: 'resp_mock',
          output_text: 'mock vision response',
          output: [{
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'mock vision response' }],
          }],
        }));
        return;
      }
      response.end(JSON.stringify({
        id: 'chatcmpl_mock',
        choices: [{ message: { role: 'assistant', content: 'mock vision response' } }],
      }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function navigateToFeature(page, hash, gallery) {
  await page.evaluate(({ nextHash, albumPath }) => {
    history.replaceState({
      usr: { albumId: albumPath, albumTitle: 'AlbumDone E2E Photos' },
      key: `e2e-${Date.now()}`,
      idx: (history.state?.idx || 0) + 1,
    }, '', nextHash);
  }, { nextHash: hash, albumPath: gallery });
  await page.reload();
  await page.waitForFunction((expectedHash) => location.hash === expectedHash, hash);
}

async function clickButton(page, labels) {
  const pattern = new RegExp(labels.join('|'), 'i');
  const button = page.locator('button').filter({ hasText: pattern }).first();
  await button.waitFor({ state: 'visible', timeout: 30000 });
  await button.click();
}

async function main() {
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'albumdone-electron-e2e-'));
  const userData = path.join(runRoot, 'user-data');
  const outputRoot = path.join(runRoot, 'outputs');
  const testResults = path.join(desktopRoot, 'test-results');
  const { gallery, duplicateTarget, expectedCount } = createGallery(runRoot);
  const mock = await createMockServer();
  let electronApp;

  try {
    const electronPath = require('electron');
    const env = {
      ...process.env,
      NODE_ENV: 'production',
      ALBUMDONE_TEST_USER_DATA: userData,
      ALBUMDONE_TEST_PHOTO_ROOT: gallery,
      ALBUMDONE_TEST_OUTPUT_ROOT: outputRoot,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    electronApp = await electron.launch({
      executablePath: electronPath,
      args: ['.'],
      cwd: desktopRoot,
      env,
      timeout: 30000,
    });
    const page = await electronApp.firstWindow({ timeout: 30000 });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => Boolean(window.electronAPI));

    const runtimeUserData = await electronApp.evaluate(({ app }) => app.getPath('userData'));
    assert.strictEqual(path.resolve(runtimeUserData), path.resolve(userData));

    const scan = await page.evaluate(async ({ albumPath }) => {
      const scanId = `e2e_${Date.now()}`;
      const photos = await window.electronAPI.getPhotos(albumPath, {
        mode: 'full',
        scanId,
        onBatch: () => undefined,
      });
      await window.electronAPI.saveAlbum(
        albumPath,
        photos.length,
        photos.reduce((total, photo) => total + photo.fileSize, 0),
      );
      return {
        count: photos.length,
        screenshots: photos.filter((photo) => photo.isScreenshot).length,
        photos,
      };
    }, { albumPath: gallery });
    assert.strictEqual(scan.count, expectedCount, 'Library and task source counts must match');
    assert(scan.screenshots >= 2, 'Screenshot fixture detection did not run');

    await page.evaluate(() => { location.hash = '#/'; });
    await page.reload();
    await page.waitForFunction(
      (count) => document.body.innerText.includes(String(count)),
      scan.count,
    );

    await navigateToFeature(page, '#/deduplication', gallery);
    await clickButton(page, ['All', '全部']);
    await clickButton(page, ['Start analysis', '开始分析', '開始分析']);
    await page.waitForFunction(() => {
      const text = document.body.innerText;
      return /similar-photo groups|similar photos|相似图片|相似圖片|No similar/i.test(text);
    }, undefined, { timeout: 90000 });
    const dedupeText = await page.locator('body').innerText();
    assert(!/native module version mismatch/i.test(dedupeText));

    await navigateToFeature(page, '#/culling', gallery);
    await clickButton(page, ['50']);
    await clickButton(page, ['Start Culling', '开始筛选', '開始篩選']);
    await page.waitForFunction(() => /1\s*\/\s*\d+/.test(document.body.innerText), undefined, {
      timeout: 30000,
    });
    await page.waitForFunction(() => {
      const image = document.querySelector('img:not([aria-hidden="true"])');
      return Boolean(image && image.complete && image.naturalWidth > 0);
    }, undefined, { timeout: 30000 });

    await navigateToFeature(page, '#/screenshots', gallery);
    await page.waitForFunction((count) => {
      const compact = document.body.innerText.replace(/\s+/g, '');
      return compact.includes(`Screenshots(${count})`);
    }, scan.screenshots, { timeout: 30000 });

    await navigateToFeature(page, '#/year-in-review', gallery);
    await page.waitForFunction(() => /Year in Review|年度回看/.test(document.body.innerText));
    const review = await page.evaluate(async (photos) => (
      window.electronAPI.yearInReview.generate(photos, 'calendar')
    ), scan.photos);
    assert(fs.existsSync(review.outputPath), 'Year in Review did not create its output');
    assert(
      path.resolve(review.outputPath).startsWith(`${path.resolve(outputRoot)}${path.sep}`),
      'Year in Review test output escaped the temporary directory',
    );

    const connection = await page.evaluate(async ({ baseUrl }) => (
      window.electronAPI.llm.testConnection({
        provider: 'custom',
        baseUrl,
        model: 'mock-vision',
        supportsVision: true,
        mode: 'proxy',
        apiKey: 'mock-key',
      })
    ), { baseUrl: mock.baseUrl });
    assert.strictEqual(connection.success, true, 'Mock AI connection should succeed');
    assert(mock.requests.some((request) => (
      request.authorization === 'Bearer mock-key'
      && /mock-vision/.test(request.body)
      && /image_url|input_image/.test(request.body)
    )), 'Mock server did not receive the expected vision request');

    const rejected = await page.evaluate(async ({ baseUrl }) => (
      window.electronAPI.llm.testConnection({
        provider: 'custom',
        baseUrl,
        model: 'mock-vision',
        supportsVision: true,
        mode: 'proxy',
        apiKey: 'reject-key',
      })
    ), { baseUrl: mock.baseUrl });
    assert.strictEqual(rejected.success, false, 'Mock authentication failure should be reported');
    assert.strictEqual(rejected.status, 401);

    const deletion = await page.evaluate(async (target) => (
      window.electronAPI.fs.deleteFiles([target])
    ), duplicateTarget);
    assert.strictEqual(deletion.successCount, 1);
    assert.strictEqual(fs.existsSync(duplicateTarget), false, 'Deleted fixture still exists on disk');

    fs.mkdirSync(testResults, { recursive: true });
    await page.screenshot({
      path: path.join(testResults, 'electron-production-smoke.png'),
      fullPage: false,
    });
    process.stdout.write(`${JSON.stringify({
      scanCount: scan.count,
      screenshotCount: scan.screenshots,
      dedupeRendered: true,
      cullingImageLoaded: true,
      yearReviewOutput: review.outputPath,
      mockRequests: mock.requests.length,
      deletionVerified: true,
    })}\n`);
  } finally {
    await electronApp?.close().catch(() => undefined);
    await mock.close().catch(() => undefined);
    fs.rmSync(runRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
