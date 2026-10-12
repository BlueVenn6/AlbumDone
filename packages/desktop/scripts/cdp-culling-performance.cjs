const assert = require('assert');
const path = require('path');
const { connectToAlbumDone } = require('./cdp-client.cjs');
let completed = false;
process.on('beforeExit', (code) => { if (code === 0 && !completed) process.exitCode = 1; });

const port = Number(process.argv[2] || 9223);
const albumPath = path.resolve(process.argv[3] || '');
const resetTestCheckpoint = process.argv.includes('--reset-test-checkpoint');
let activeSocket = null;

async function main() {
  assert(albumPath, 'Album path is required.');
  const { socket, send, evaluate, waitFor, click } = await connectToAlbumDone(port);
  activeSocket = socket;

  await send('Runtime.enable');
  await send('Page.enable');
  const albumLiteral = JSON.stringify(albumPath);
  const scan = await evaluate(`(async () => {
    const startedAt = performance.now();
    await window.electronAPI.saveAlbum(${albumLiteral}, 0, 0);
    const photos = await window.electronAPI.getPhotos(${albumLiteral}, { mode: 'fast' });
    await window.electronAPI.saveAlbum(
      ${albumLiteral},
      photos.length,
      photos.reduce((total, photo) => total + photo.fileSize, 0),
    );
    return { count: photos.length, elapsedMs: performance.now() - startedAt };
  })()`);
  assert(scan.count > 1000, `Expected a large album, received ${scan.count}.`);
  if (resetTestCheckpoint) {
    const checkpointKey = `photo-task:v1:culling:${encodeURIComponent(albumPath)}`;
    await evaluate(`window.electronAPI.tasks.deleteCheckpoint(${JSON.stringify(checkpointKey)})`);
  }

  const albumTitle = path.basename(albumPath);
  await evaluate(`(() => {
    const state = {
      usr: { albumId: ${albumLiteral}, albumTitle: ${JSON.stringify(albumTitle)} },
      key: 'culling-performance',
      idx: (history.state?.idx || 0) + 1,
    };
    history.replaceState(state, '', '#/culling');
  })()`);
  await send('Page.reload', { ignoreCache: true });
  await waitFor(`document.body && location.hash.includes('/culling')`);
  await waitFor(`location.hash.includes('/culling')`);
  await waitFor(`[...document.querySelectorAll('button')].some((item) => (item.textContent || '').trim() === '500')`, 60000);
  const selectedFifty = await click(['50']);
  if (!selectedFifty) {
    const pageState = await evaluate(`({
      hash: location.hash,
      text: document.body.innerText.slice(0, 1200),
      buttons: [...document.querySelectorAll('button')].map((item) => (item.textContent || '').trim()),
    })`);
    throw new Error(`Culling batch controls were not available: ${JSON.stringify(pageState)}`);
  }
  assert(await click(['start culling', '开始筛选', '開始篩選']));
  await waitFor(`document.body.textContent.includes('1 / 50')`, 30000);
  await waitFor(`(() => { const image = document.querySelector('img:not([aria-hidden="true"])'); return image && image.complete && image.naturalWidth > 0; })()`);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  if (process.argv.includes('--rapid-decisions')) {
    const checkpointKey = `photo-task:v1:culling:${encodeURIComponent(albumPath)}`;
    await evaluate(`(() => {
      const buttons = [...document.querySelectorAll('button')];
      buttons.find(button => button.textContent.trim() === '✓ Keep').click();
      buttons.find(button => button.textContent.trim() === '✗ Delete').click();
    })()`);
    await waitFor(`document.body.textContent.includes('2 / 50')`);
    const raw = await evaluate(`window.electronAPI.tasks.getCheckpoint(${JSON.stringify(checkpointKey)})`);
    const checkpoint = typeof raw === 'string' ? JSON.parse(raw) : raw;
    assert.strictEqual(checkpoint.decisions[checkpoint.photoIds[0]], 'keep', 'A rapid second click overwrote the accepted decision.');
    socket.terminate();
    completed = true;
    process.stdout.write(`${JSON.stringify({ rapidSecondClickIgnored: true, firstDecisionPreserved: true })}\n`);
    return;
  }

  const transitions = [];
  for (let expected = 2; expected <= 4; expected += 1) {
    const preload = await evaluate(`(() => {
      const images = [...document.querySelectorAll('img[aria-hidden="true"]')];
      return {
        total: images.length,
        ready: images.filter((image) => image.complete && image.naturalWidth > 0).length,
        sources: images.map((image) => image.src),
      };
    })()`);
    const previousSrc = await evaluate(`document.querySelector('img:not([aria-hidden="true"])')?.src || ''`);
    const startedAt = Date.now();
    assert(await click(['keep', '保留']));
    await waitFor(`document.body.textContent.includes('${expected} / 50')`, 5000);
    const decisionMs = Date.now() - startedAt;
    await waitFor(`(() => {
      const image = document.querySelector('img:not([aria-hidden="true"])');
      return image && image.src !== ${JSON.stringify(previousSrc)} && image.complete && image.naturalWidth > 0;
    })()`, 5000);
    transitions.push({ preload, decisionMs, imageMs: Date.now() - startedAt });
  }

  const fourthSource = await evaluate(`document.querySelector('img:not([aria-hidden="true"])')?.src`);
  assert(await click(['↩'], true), 'Undo was unavailable after a decision.');
  await waitFor(`document.body.textContent.includes('3 / 50')`);
  assert(await click(['✗ delete', '✗ 删除', '✗ 刪除'], true));
  await waitFor(`document.body.textContent.includes('4 / 50')`);
  await waitFor(`document.querySelector('img:not([aria-hidden="true"])')?.src === ${JSON.stringify(fourthSource)}`);
  const checkpointKey = `photo-task:v1:culling:${encodeURIComponent(albumPath)}`;
  await waitFor(`(async () => {
    const raw = await window.electronAPI.tasks.getCheckpoint(${JSON.stringify(checkpointKey)});
    const checkpoint = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return checkpoint?.currentIndex === 3
      && Object.values(checkpoint.decisions).filter(value => value === 'keep').length === 2
      && Object.values(checkpoint.decisions).filter(value => value === 'delete').length === 1;
  })()`);
  await send('Page.reload', { ignoreCache: true });
  await waitFor(`document.body.textContent.includes('4 / 50')`, 30000);
  await waitFor(`document.querySelector('img:not([aria-hidden="true"])')?.src === ${JSON.stringify(fourthSource)}`);
  socket.terminate();
  completed = true;
  process.stdout.write(`${JSON.stringify({
    scan,
    transitions,
    maxTransitionMs: Math.max(...transitions.map((transition) => transition.imageMs)),
    undoAndDelete: true,
    persistedDecisions: { keep: 2, delete: 1, currentIndex: 3 },
    rendererReloadResumedSamePhoto: true,
  })}\n`);
}

main().catch((error) => {
  activeSocket?.terminate();
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
