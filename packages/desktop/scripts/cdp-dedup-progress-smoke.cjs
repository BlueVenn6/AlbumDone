const assert = require('assert');
const path = require('path');
const { connectToAlbumDone } = require('./cdp-client.cjs');
let completed = false;
process.on('beforeExit', (code) => { if (code === 0 && !completed) process.exitCode = 1; });

const port = Number(process.argv[2] || 9226);
const albumPath = path.resolve(process.argv[3] || '');
const cancelOnly = process.argv.includes('--cancel-only');
let activeSocket = null;

async function main() {
  assert(albumPath, 'Album path is required.');
  const { socket, send, evaluate, waitFor, click } = await connectToAlbumDone(port);
  activeSocket = socket;

  await send('Runtime.enable');
  await send('Page.enable');
  if (cancelOnly) {
    const cancelled = await click(['cancel', '取消']);
    assert(cancelled, 'Active dedupe Cancel button was not found.');
    await waitFor(
      `![...document.querySelectorAll('button')].some((item) => ['cancel', '取消'].includes((item.textContent || '').trim().toLowerCase()))`,
      30000,
    );
    socket.terminate();
    activeSocket = null;
    completed = true;
    process.stdout.write(`${JSON.stringify({ cancelled: true })}\n`);
    return;
  }
  const albumLiteral = JSON.stringify(albumPath);
  const albumTitle = path.basename(albumPath);
  const photoCount = await evaluate(`(async () => {
    await window.electronAPI.saveAlbum(${albumLiteral}, 0, 0);
    return (await window.electronAPI.getPhotos(${albumLiteral}, { mode: 'fast' })).length;
  })()`);
  assert(photoCount > 1000);
  const checkpointKey = `photo-task:v1:deduplication:${encodeURIComponent(albumPath)}`;
  await evaluate(`window.electronAPI.tasks.deleteCheckpoint(${JSON.stringify(checkpointKey)})`);
  await evaluate(`history.replaceState({
    usr: { albumId: ${albumLiteral}, albumTitle: ${JSON.stringify(albumTitle)} },
    key: 'dedup-progress-smoke',
    idx: (history.state?.idx || 0) + 1,
  }, '', '#/deduplication')`);
  await send('Page.reload', { ignoreCache: true });
  await waitFor(`[...document.querySelectorAll('button')].some((item) => (item.textContent || '').trim() === 'All')`, 120000);
  assert(await click(['all']));
  assert(await click(['start analysis']));

  if (process.argv.includes('--cancel-at-start')) {
    await waitFor(`[...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Cancel')`, 10000);
    const cancelStartedAt = Date.now();
    assert(await click(['cancel'], true));
    await waitFor(`![...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Cancel')`, 10000);
    const remaining = await evaluate(`window.electronAPI.getPhotos(${albumLiteral}, { mode: 'fast' }).then(photos => photos.length)`);
    assert.strictEqual(remaining, photoCount, 'Cancelling analysis changed the original files.');
    socket.terminate();
    completed = true;
    process.stdout.write(`${JSON.stringify({ cancelled: true, elapsedMs: Date.now() - cancelStartedAt, photoCount, originalsUnchanged: true })}\n`);
    return;
  }

  const scopeMs = await waitFor(
    `document.body.textContent.includes('All ${photoCount} selected photos are included in this run.')`,
    120000,
  );
  await waitFor(
    `(
      document.body.textContent.includes('Candidate hashing:')
      && document.body.textContent.includes('(from ${photoCount} input photos)')
    ) || document.body.textContent.includes('Comparing candidate pairs:')
      || document.body.textContent.includes('Found ')
      || document.body.textContent.includes('No duplicate groups found')`,
    120000,
  );
  const progressText = await evaluate(`document.body.innerText`);
  const candidateLine = progressText.split(/\r?\n/).find((line) => line.includes('Candidate hashing:')) || '';
  if (candidateLine) {
    assert(candidateLine.includes(`from ${photoCount} input photos`));
  }

  const completionStartedAt = Date.now();
  let maximumCandidatePairs = 0;
  while (Date.now() - completionStartedAt < 360000) {
    const state = await evaluate(String.raw`(() => {
      const text = document.body.innerText;
      const match = text.match(/Comparing candidate pairs:\s*[\d,]+\s*\/\s*([\d,]+)/i);
      return {
        complete: text.includes('Found ') || text.includes('No duplicate groups found'),
        candidatePairs: match ? Number(match[1].replace(/,/g, '')) : 0,
      };
    })()`);
    maximumCandidatePairs = Math.max(maximumCandidatePairs, state.candidatePairs);
    if (state.complete) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const completionMs = Date.now() - completionStartedAt;
  assert(
    await evaluate(`document.body.textContent.includes('Found ') || document.body.textContent.includes('No duplicate groups found')`),
    'Deduplication did not finish within six minutes.',
  );
  const completionText = await evaluate(`document.body.innerText`);
  const resultUi = await evaluate(`({
    expanded: document.body.innerText.includes('▼'),
    imageCount: document.querySelectorAll('img').length,
  })`);
  let largeGroup = null;
  if (process.argv.includes('--verify-large-group')) {
    await evaluate(`(() => {
      const grid = [...document.querySelectorAll('div')].find(element => element.style.overflowY === 'auto' && element.style.height === '500px');
      if (!grid) throw new Error('Large duplicate group was not virtualized.');
      grid.scrollIntoView({ block: 'center' });
    })()`);
    await waitFor(`[...document.querySelectorAll('img')].some(image => image.complete && image.naturalWidth > 0)`);
    const readGrid = `(() => {
      const grid = [...document.querySelectorAll('div')].find(element => element.style.overflowY === 'auto' && element.style.height === '500px');
      if (!grid) throw new Error('Large duplicate group was not virtualized.');
      const cards = [...grid.firstElementChild.children];
      return { count: cards.length, first: cards[0]?.innerText, last: cards.at(-1)?.innerText, height: grid.scrollHeight, viewport: grid.clientHeight };
    })()`;
    const before = await evaluate(readGrid);
    assert(before.count > 0 && before.count < 100, 'A large duplicate group mounted too many cards.');
    assert(before.height > before.viewport * 2);
    await evaluate(`(() => {
      const grid = [...document.querySelectorAll('div')].find(element => element.style.overflowY === 'auto' && element.style.height === '500px');
      grid.scrollTop = grid.scrollHeight;
      grid.dispatchEvent(new Event('scroll', { bubbles: true }));
    })()`);
    await waitFor(`(${readGrid}).last !== ${JSON.stringify(before.last)}`);
    await waitFor(`(() => {
      const grid = [...document.querySelectorAll('div')].find(element => element.style.overflowY === 'auto' && element.style.height === '500px');
      return [...grid.querySelectorAll('img')].some(image => image.complete && image.naturalWidth > 0);
    })()`);
    const bottom = await evaluate(readGrid);
    const selected = await evaluate(`(() => {
      const grid = [...document.querySelectorAll('div')].find(element => element.style.overflowY === 'auto' && element.style.height === '500px');
      const card = grid.firstElementChild.lastElementChild;
      const filename = card.lastElementChild.textContent;
      const decision = card.innerText;
      card.click();
      return { filename, decision };
    })()`);
    await waitFor(`(${readGrid}).last !== ${JSON.stringify(selected.decision)}`);
    const afterSelection = await evaluate(readGrid);
    await evaluate(`(() => {
      const grid = [...document.querySelectorAll('div')].find(element => element.style.overflowY === 'auto' && element.style.height === '500px');
      grid.scrollTop = 0; grid.dispatchEvent(new Event('scroll', { bubbles: true }));
    })()`);
    await waitFor(`(${readGrid}).first === ${JSON.stringify(before.first)}`);
    await evaluate(`(() => {
      const grid = [...document.querySelectorAll('div')].find(element => element.style.overflowY === 'auto' && element.style.height === '500px');
      grid.scrollTop = grid.scrollHeight; grid.dispatchEvent(new Event('scroll', { bubbles: true }));
    })()`);
    await waitFor(`(${readGrid}).last === ${JSON.stringify(afterSelection.last)}`);
    largeGroup = { before, bottom, selectedFilename: selected.filename, selectionSurvivedScroll: true };
  }
  socket.terminate();
  activeSocket = null;
  completed = true;
  process.stdout.write(`${JSON.stringify({
    photoCount,
    scopeMs,
    candidateLine: candidateLine || 'All candidate hashes were served from the persistent cache.',
    maximumCandidatePairs,
    completionMs,
    completionSummary: completionText.split(/\r?\n/).filter((line) => /Found |No duplicate/.test(line)).slice(0, 3),
    resultUi,
    largeGroup,
  })}\n`);
}

main().catch((error) => {
  activeSocket?.terminate();
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
