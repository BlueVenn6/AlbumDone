const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const WebSocket = require('ws');

let activeSocket = null;

const debugPort = Number(process.argv[2] || 9222);
const albumPath = process.argv[3];
const evidenceDir = process.argv[4];
const expectedPhotoCount = Number(process.argv[5] || 0);

if (!albumPath || !evidenceDir) {
  throw new Error('Usage: node cdp-pre-release-smoke.cjs <port> <album-path> <evidence-dir> [expected-photo-count]');
}

async function getPageTarget() {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  const targets = await response.json();
  const page = targets.find((target) => target.type === 'page' && target.title === 'AlbumDone');
  if (!page?.webSocketDebuggerUrl) {
    throw new Error('AlbumDone CDP page target was not found.');
  }
  return page;
}

async function main() {
  const smokeStartedAt = Date.now();
  const reportStage = (stage) => {
    process.stderr.write(`[ui-smoke +${Date.now() - smokeStartedAt}ms] ${stage}\n`);
  };
  reportStage('connecting to Electron');
  const target = await getPageTarget();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  activeSocket = socket;
  let commandId = 0;
  const pending = new Map();

  socket.on('message', (raw) => {
    const message = JSON.parse(String(raw));
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });

  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++commandId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || 'Renderer evaluation failed.');
    }
    return result.result.value;
  };
  const waitFor = async (expression, timeoutMs = 20000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for renderer condition: ${expression}`);
  };
  const clickButtonContainingAny = (labels) => evaluate(`(() => {
    const labels = ${JSON.stringify(labels.map((label) => label.toLowerCase()))};
    const button = [...document.querySelectorAll('button')]
      .find((item) => labels.some((label) => item.textContent?.toLowerCase().includes(label)));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  let screenshotCaptureAvailable = true;
  let screenshotsCaptured = 0;
  const capture = async (filename) => {
    if (!screenshotCaptureAvailable) return;
    try {
      const result = await Promise.race([
        send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }),
        new Promise((_, reject) => setTimeout(
          () => reject(new Error('CDP screenshot capture timed out.')),
          5000,
        )),
      ]);
      fs.mkdirSync(evidenceDir, { recursive: true });
      fs.writeFileSync(path.join(evidenceDir, filename), Buffer.from(result.data, 'base64'));
      screenshotsCaptured += 1;
    } catch (error) {
      screenshotCaptureAvailable = false;
      process.stderr.write(`[ui-smoke] screenshot evidence unavailable: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await waitFor(`document.readyState === 'complete'`);

  reportStage('scanning album through renderer/preload/IPC');
  const albumLiteral = JSON.stringify(path.resolve(albumPath));
  const albumTitleLiteral = JSON.stringify(path.basename(albumPath));
  const navigateToAlbumFeature = async (hash, key) => {
    await evaluate(`history.replaceState({
      usr: { albumId: ${albumLiteral}, albumTitle: ${albumTitleLiteral} },
      key: ${JSON.stringify(key)},
      idx: (history.state?.idx || 0) + 1,
    }, '', ${JSON.stringify(hash)})`);
    await send('Page.reload', { ignoreCache: true });
    await waitFor(`document.readyState === 'complete' && location.hash === ${JSON.stringify(hash)}`, 30000);
  };
  const scan = await evaluate(`(async () => {
    const scanId = 'ui_smoke_' + Date.now();
    const startedAt = performance.now();
    let firstBatchMs = null;
    let firstBatchCount = 0;
    const photos = await Promise.race([
      window.electronAPI.getPhotos(${albumLiteral}, {
        mode: 'fast',
        scanId,
        onBatch: (batch) => {
          if (firstBatchMs === null && batch.length > 0) {
            firstBatchMs = performance.now() - startedAt;
            firstBatchCount = batch.length;
          }
        },
      }),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error('Renderer photo scan exceeded 90 seconds.')),
        90000,
      )),
    ]);
    const firstScreenshot = photos.find((photo) => photo.isScreenshot);
    return {
      count: photos.length,
      totalBytes: photos.reduce((total, photo) => total + photo.fileSize, 0),
      firstBatchMs,
      firstBatchCount,
      totalMs: performance.now() - startedAt,
      screenshots: photos.filter((photo) => photo.isScreenshot).length,
      firstScreenshotPath: firstScreenshot?.path ?? null,
    };
  })()`);
  if (expectedPhotoCount > 0) {
    assert.strictEqual(scan.count, expectedPhotoCount);
  } else {
    assert(scan.count > 0, 'Album scan returned no photos.');
  }
  assert(scan.firstBatchCount > 0);
  assert(scan.firstBatchMs !== null);
  assert(scan.firstScreenshotPath);

  reportStage('reading a bounded screenshot preview');
  const preview = await evaluate(`(async () => {
    const startedAt = performance.now();
    const result = await window.electronAPI.fs.readImagePreviewAsBase64(
      ${JSON.stringify(scan.firstScreenshotPath)},
      1536,
    );
    return {
      elapsedMs: performance.now() - startedAt,
      bytes: Math.floor(result.base64.length * 0.75),
      mimeType: result.mimeType,
    };
  })()`);
  assert(preview.bytes > 0);
  assert(['image/jpeg', 'image/png', 'image/webp'].includes(preview.mimeType));

  reportStage('saving album and reloading renderer');
  await evaluate(`window.electronAPI.saveAlbum(${albumLiteral}, ${scan.count}, ${scan.totalBytes})`);
  await evaluate(`location.hash = '#/'`);
  await waitFor(`location.hash === '#/' && document.body.innerText.includes('Auto Dedup')`);
  await send('Page.reload', { ignoreCache: true });
  await waitFor(
    `document.readyState === 'complete' && document.body.innerText.includes(${JSON.stringify(String(expectedPhotoCount || scan.count))})`,
    30000,
  );
  const homeText = await evaluate('document.body.innerText');
  assert(!/native module version mismatch|node_module_version/i.test(homeText));
  await capture('01-home.png');

  reportStage('opening manual culling batch setup');
  await navigateToAlbumFeature('#/culling', 'release-smoke-culling');
  await waitFor(`(document.body.innerText.includes('Batch size') || document.body.innerText.includes('处理数量') || document.body.innerText.includes('處理數量')) && document.body.innerText.includes('500')`, 30000);
  await capture('02-culling-batch.png');

  reportStage('opening dedupe batch setup');
  await navigateToAlbumFeature('#/deduplication', 'release-smoke-deduplication');
  await waitFor(`(document.body.innerText.includes('Start analysis') || document.body.innerText.includes('开始分析') || document.body.innerText.includes('開始分析')) && document.body.innerText.includes('500')`, 30000);
  await capture('03-dedup-batch.png');

  reportStage('opening screenshots module');
  await navigateToAlbumFeature('#/screenshots', 'release-smoke-screenshots');
  await waitFor(`document.body.innerText.includes('Screenshots (')`, 30000);
  const screenshotText = await evaluate('document.body.innerText');
  assert(!/fetch failed|native module version mismatch/i.test(screenshotText));
  await capture('04-screenshots.png');

  reportStage('opening year in review');
  await navigateToAlbumFeature('#/year-in-review', 'release-smoke-year-in-review');
  await waitFor(`(document.body.innerText.includes('Last 12 Months') || document.body.innerText.includes('Past 12 Months') || document.body.innerText.includes('过去 12 个月') || document.body.innerText.includes('過去 12 個月')) && (document.body.innerText.includes('This Year') || document.body.innerText.includes('本年') || document.body.innerText.includes('今年'))`);
  await capture('05-year-review.png');

  reportStage('generating and validating year in review export');
  const reviewStartedAt = Date.now();
  assert(await clickButtonContainingAny([
    'generate year in review',
    '生成年回顾',
    '生成年回顧',
  ]));
  await waitFor(`document.body.innerText.includes('Open File') || document.body.innerText.includes('打开文件') || document.body.innerText.includes('開啟檔案')`, 120000);
  const reviewText = await evaluate('document.body.innerText');
  assert(!/failed|error|失败|失敗/i.test(reviewText));
  const outputPathMatch = reviewText.match(/[A-Za-z]:\\[^\r\n]*year-in-review-[^\r\n]*\.jpg/i);
  assert(outputPathMatch, 'Year in Review output path was not rendered.');
  const reviewOutputPath = outputPathMatch[0];
  assert(fs.existsSync(reviewOutputPath), `Year in Review output does not exist: ${reviewOutputPath}`);
  const reviewMetadata = await sharp(reviewOutputPath).metadata();
  const reviewStats = await sharp(reviewOutputPath).stats();
  assert.strictEqual(reviewMetadata.width, 1600);
  assert.strictEqual(reviewMetadata.height, 1240);
  assert(reviewStats.channels.some((channel) => channel.stdev > 8), 'Year in Review export is visually blank.');
  await capture('06-year-review-result.png');

  const result = {
    scan,
    preview,
    yearInReview: {
      elapsedMs: Date.now() - reviewStartedAt,
      outputPath: reviewOutputPath,
      width: reviewMetadata.width,
      height: reviewMetadata.height,
    },
    screenshotEvidence: {
      available: screenshotCaptureAvailable,
      captured: screenshotsCaptured,
    },
    evidenceDir: path.resolve(evidenceDir),
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  reportStage('completed');
  socket.close();
  activeSocket = null;
}

main().catch((error) => {
  activeSocket?.terminate();
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
