const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { _electron: electron } = require('playwright-core');
const { createPerformanceGallery } = require('./generate-performance-gallery.cjs');

const desktopRoot = path.resolve(__dirname, '..');

async function navigate(page, hash, gallery) {
  await page.evaluate(({ nextHash, albumPath }) => {
    history.replaceState({
      usr: { albumId: albumPath, albumTitle: 'AlbumDone Performance Gallery' },
      key: `benchmark-${Date.now()}`,
      idx: (history.state?.idx || 0) + 1,
    }, '', nextHash);
  }, { nextHash: hash, albumPath: gallery });
  await page.reload();
  await page.waitForFunction((expected) => location.hash === expected, hash);
}

async function clickButton(page, labels) {
  const button = page.locator('button').filter({ hasText: new RegExp(labels.join('|'), 'i') }).first();
  await button.waitFor({ state: 'visible', timeout: 60000 });
  await button.click();
}

async function main() {
  const count = Number.parseInt(process.argv[2] ?? '100', 10);
  const reportPath = process.argv[3] ? path.resolve(process.argv[3]) : null;
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), `albumdone-benchmark-${count}-`));
  const gallery = path.join(runRoot, 'gallery');
  const generationStarted = performance.now();
  const fixture = createPerformanceGallery(gallery, count);
  const generationMs = performance.now() - generationStarted;
  let electronApp;
  let peakWorkingSetBytes = 0;
  let sampling = true;

  try {
    const env = {
      ...process.env,
      NODE_ENV: 'production',
      ALBUMDONE_TEST_USER_DATA: path.join(runRoot, 'user-data'),
      ALBUMDONE_TEST_PHOTO_ROOT: gallery,
      ALBUMDONE_TEST_OUTPUT_ROOT: path.join(runRoot, 'outputs'),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    electronApp = await electron.launch({
      executablePath: require('electron'),
      args: ['.'],
      cwd: desktopRoot,
      env,
      timeout: 30000,
    });
    const sampleMemory = async () => {
      const bytes = await electronApp.evaluate(({ app }) => (
        app.getAppMetrics().reduce(
          (total, metric) => total + metric.memory.workingSetSize * 1024,
          0,
        )
      )).catch(() => 0);
      peakWorkingSetBytes = Math.max(peakWorkingSetBytes, bytes);
    };
    const sampler = (async () => {
      while (sampling) {
        await sampleMemory();
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    })();

    const page = await electronApp.firstWindow({ timeout: 30000 });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => Boolean(window.electronAPI));

    const scanStarted = performance.now();
    const scan = await page.evaluate(async ({ albumPath }) => {
      const startedAt = performance.now();
      let firstBatchMs = null;
      const photos = await window.electronAPI.getPhotos(albumPath, {
        mode: 'full',
        scanId: `benchmark_${Date.now()}`,
        onBatch: (batch) => {
          if (firstBatchMs === null && batch.length > 0) {
            firstBatchMs = performance.now() - startedAt;
          }
        },
      });
      await window.electronAPI.saveAlbum(
        albumPath,
        photos.length,
        photos.reduce((total, photo) => total + photo.fileSize, 0),
      );
      return {
        count: photos.length,
        screenshots: photos.filter((photo) => photo.isScreenshot).length,
        firstBatchMs,
        photos,
      };
    }, { albumPath: gallery });
    const scanMs = performance.now() - scanStarted;
    assert.strictEqual(scan.count, count);

    const cullingStarted = performance.now();
    await navigate(page, '#/culling', gallery);
    await clickButton(page, ['50']);
    await clickButton(page, ['Start Culling', '开始筛选', '開始篩選']);
    await page.waitForFunction(() => {
      const image = document.querySelector('img:not([aria-hidden="true"])');
      return Boolean(image && image.complete && image.naturalWidth > 0);
    }, undefined, { timeout: 60000 });
    const cullingFirstImageMs = performance.now() - cullingStarted;

    const dedupStarted = performance.now();
    await navigate(page, '#/deduplication', gallery);
    await clickButton(page, ['All', '全部']);
    await clickButton(page, ['Start analysis', '开始分析', '開始分析']);
    await page.waitForFunction(() => (
      /similar-photo groups|similar photos|相似图片|相似圖片|No similar/i.test(document.body.innerText)
    ), undefined, { timeout: Math.max(120000, count * 300) });
    const dedupMs = performance.now() - dedupStarted;
    const dedupText = await page.locator('body').innerText();
    const groupMatch = dedupText.match(/(?:Found\s+)?(\d+)\s+(?:similar-photo groups|groups of similar photos)/i);

    const screenshotStarted = performance.now();
    await navigate(page, '#/screenshots', gallery);
    await page.waitForFunction((expected) => (
      document.body.innerText.replace(/\s+/g, '').includes(`Screenshots(${expected})`)
    ), scan.screenshots, { timeout: 60000 });
    const screenshotFilterMs = performance.now() - screenshotStarted;

    const reviewStarted = performance.now();
    const review = await page.evaluate(async (photos) => (
      window.electronAPI.yearInReview.generate(photos, 'calendar')
    ), scan.photos);
    const yearInReviewMs = performance.now() - reviewStarted;
    assert(fs.existsSync(review.outputPath));

    sampling = false;
    await sampler;
    const report = {
      generatedAt: new Date().toISOString(),
      fixture,
      generationMs,
      scan: {
        count: scan.count,
        firstBatchMs: scan.firstBatchMs,
        totalMs: scanMs,
      },
      cullingFirstImageMs,
      dedup: {
        totalMs: dedupMs,
        renderedGroups: groupMatch ? Number(groupMatch[1]) : null,
      },
      screenshots: {
        count: scan.screenshots,
        filterAndRenderMs: screenshotFilterMs,
      },
      yearInReviewMs,
      peakWorkingSetBytes,
    };
    if (reportPath) {
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    }
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally {
    sampling = false;
    await electronApp?.close().catch(() => undefined);
    fs.rmSync(runRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
