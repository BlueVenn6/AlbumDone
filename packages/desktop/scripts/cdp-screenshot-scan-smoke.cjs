const assert = require('assert');
const path = require('path');
const WebSocket = require('ws');

const port = Number(process.argv[2] || 9226);
const albumPath = path.resolve(process.argv[3] || '');
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
  const waitFor = async (expression, timeoutMs = 120000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await evaluate(expression)) return Date.now() - startedAt;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  };

  await send('Runtime.enable');
  await send('Page.enable');
  const albumLiteral = JSON.stringify(albumPath);
  const scan = await evaluate(`(async () => {
    await window.electronAPI.saveAlbum(${albumLiteral}, 0, 0);
    const startedAt = performance.now();
    const photos = await window.electronAPI.getPhotos(${albumLiteral}, { mode: 'full' });
    await window.electronAPI.saveAlbum(
      ${albumLiteral},
      photos.length,
      photos.reduce((total, photo) => total + photo.fileSize, 0),
    );
    return {
      count: photos.length,
      elapsedMs: performance.now() - startedAt,
      zeroDimensions: photos.filter((photo) => photo.width <= 0 || photo.height <= 0).length,
      screenshots: photos.filter((photo) => photo.isScreenshot).length,
      foreignAlbumPhotos: photos.filter((photo) => photo.albumId !== ${albumLiteral}).length,
    };
  })()`);
  assert(scan.count > 1000);
  assert.strictEqual(scan.zeroDimensions, 0);
  assert.strictEqual(scan.foreignAlbumPhotos, 0);

  const albumTitle = path.basename(albumPath);
  await evaluate(`history.replaceState({
    usr: { albumId: ${albumLiteral}, albumTitle: ${JSON.stringify(albumTitle)} },
    key: 'screenshot-scan-smoke',
    idx: (history.state?.idx || 0) + 1,
  }, '', '#/screenshots')`);
  await send('Page.reload', { ignoreCache: true });
  await waitFor(`document.body && location.hash.includes('/screenshots')`);
  const uiMs = await waitFor(`document.body.textContent.replace(/\\s+/g, '').includes(${JSON.stringify(`Screenshots(${scan.screenshots})`)})`);
  const ui = await evaluate(`({
    title: document.body.textContent.match(/Screenshots\\s*\\(\\d+\\)/)?.[0] || '',
    renderedImages: document.querySelectorAll('img').length,
    visibleImageNames: [...document.querySelectorAll('img')].map((image) => image.alt).filter(Boolean),
    errors: [...document.querySelectorAll('[role="alert"]')].map((item) => item.textContent),
  })`);
  assert(ui.renderedImages < Math.max(50, scan.screenshots));
  const scrolled = await evaluate(`(() => {
    const scroller = [...document.querySelectorAll('div')].find((item) => {
      const style = getComputedStyle(item);
      return item.scrollHeight > item.clientHeight && ['auto', 'scroll'].includes(style.overflowY);
    });
    if (!scroller) return false;
    scroller.scrollTop = scroller.scrollHeight;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    return true;
  })()`);
  assert(scrolled, 'Screenshot virtual-list scroller was not found.');
  await waitFor(`(() => {
    const names = [...document.querySelectorAll('img')].map((image) => image.alt).filter(Boolean);
    return JSON.stringify(names) !== ${JSON.stringify(JSON.stringify(ui.visibleImageNames))};
  })()`, 10000);
  const bottomVisibleImageNames = await evaluate(
    `[...document.querySelectorAll('img')].map((image) => image.alt).filter(Boolean)`,
  );
  assert.notDeepStrictEqual(bottomVisibleImageNames, ui.visibleImageNames);

  socket.terminate();
  activeSocket = null;
  process.stdout.write(`${JSON.stringify({ scan, uiMs, ui, bottomVisibleImageNames })}\n`);
}

main().catch((error) => {
  activeSocket?.terminate();
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
