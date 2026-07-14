const assert = require('assert');
const path = require('path');
const WebSocket = require('ws');

const port = Number(process.argv[2] || 9223);
const albumPath = path.resolve(process.argv[3] || '');
const resetTestCheckpoint = process.argv.includes('--reset-test-checkpoint');
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
  const waitFor = async (expression, timeoutMs = 30000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await evaluate(expression)) return Date.now() - startedAt;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  };
  const click = (labels, exact = false) => evaluate(`(() => {
    const labels = ${JSON.stringify(labels.map((label) => label.toLowerCase()))};
    const button = [...document.querySelectorAll('button')].find((item) => {
      const text = (item.textContent || '').trim().toLowerCase();
      return labels.some((label) => ${exact ? 'text === label' : 'text.includes(label)'});
    });
    if (!button) return false;
    button.click();
    return true;
  })()`);

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

  socket.terminate();
  process.stdout.write(`${JSON.stringify({
    scan,
    transitions,
    maxTransitionMs: Math.max(...transitions.map((transition) => transition.imageMs)),
  })}\n`);
}

main().catch((error) => {
  activeSocket?.terminate();
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
