const assert = require('assert');
const path = require('path');
const WebSocket = require('ws');

const port = Number(process.argv[2] || 9226);
const albumPath = path.resolve(process.argv[3] || '');
const cancelOnly = process.argv.includes('--cancel-only');
let activeSocket = null;

async function main() {
  assert(albumPath, 'Album path is required.');
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const target = targets.find((item) => item.type === 'page' && item.title === 'AlbumDone');
  assert(target?.webSocketDebuggerUrl, 'AlbumDone renderer was not found.');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  activeSocket = socket;
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  let id = 0;
  const pending = new Map();
  socket.on('message', (raw) => {
    const message = JSON.parse(String(raw));
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const commandId = ++id;
    pending.set(commandId, { resolve, reject });
    socket.send(JSON.stringify({ id: commandId, method, params }));
  });
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || 'Renderer evaluation failed.');
    }
    return response.result.value;
  };
  const waitFor = async (expression, timeoutMs) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await evaluate(expression)) return Date.now() - startedAt;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  };
  const click = (labels) => evaluate(`(() => {
    const labels = ${JSON.stringify(labels.map((label) => label.toLowerCase()))};
    const button = [...document.querySelectorAll('button')].find((item) => {
      const text = (item.textContent || '').trim().toLowerCase();
      return labels.some((label) => text === label || text.includes(label));
    });
    if (!button) return false;
    button.click();
    return true;
  })()`);

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
  const largeLibraryTimeoutMs = photoCount > 5000 ? 30 * 60 * 1000 : 6 * 60 * 1000;
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

  const scopeMs = await waitFor(
    `document.body.textContent.includes('All ${photoCount} selected photos are included in this run.')`,
    120000,
  );
  await waitFor(
    `(
      document.body.textContent.includes('Candidate hashing:')
      || document.body.textContent.includes('Generating missing visual signatures:')
      || document.body.textContent.includes('生成缺失的视觉签名')
    )
      && (
        document.body.textContent.includes('(from ${photoCount} input photos)')
        || document.body.textContent.includes('/ ${photoCount}')
      )
      || document.body.textContent.includes('Comparing candidate pairs:')
      || document.body.textContent.includes('Found ')
      || document.body.textContent.includes('No duplicate groups found')`,
    largeLibraryTimeoutMs,
  );
  const progressText = await evaluate(`document.body.innerText`);
  const candidateLine = progressText.split(/\r?\n/).find((line) => line.includes('Candidate hashing:')) || '';
  if (candidateLine) {
    assert(candidateLine.includes(`from ${photoCount} input photos`));
  }

  const completionStartedAt = Date.now();
  let maximumCandidatePairs = 0;
  while (Date.now() - completionStartedAt < largeLibraryTimeoutMs) {
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
    `Deduplication did not finish within ${Math.round(largeLibraryTimeoutMs / 60000)} minutes.`,
  );
  const completionText = await evaluate(`document.body.innerText`);
  const resultUi = await evaluate(`({
    expanded: document.body.innerText.includes('▼'),
    imageCount: document.querySelectorAll('img').length,
  })`);
  socket.terminate();
  activeSocket = null;
  process.stdout.write(`${JSON.stringify({
    photoCount,
    scopeMs,
    candidateLine: candidateLine || 'All candidate hashes were served from the persistent cache.',
    maximumCandidatePairs,
    completionMs,
    completionSummary: completionText.split(/\r?\n/).filter((line) => /Found |No duplicate/.test(line)).slice(0, 3),
    resultUi,
  })}\n`);
}

main().catch((error) => {
  activeSocket?.terminate();
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
