const assert = require('assert');
const fs = require('fs');
const sharp = require('sharp');
const WebSocket = require('ws');

const port = Number(process.argv[2] || 9223);
const screenshotPath = process.argv[3];
let activeSocket = null;

async function main() {
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
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  };
  const click = (labels) => evaluate(`(() => {
    const labels = ${JSON.stringify(labels.map((label) => label.toLowerCase()))};
    const button = [...document.querySelectorAll('button')]
      .find((item) => labels.some((label) => item.textContent?.toLowerCase().includes(label)));
    if (!button) return false;
    button.click();
    return true;
  })()`);

  await send('Runtime.enable');
  await send('Page.enable');
  await evaluate(`location.hash = '#/'`);
  await waitFor(`document.body.innerText.includes('Year in Review')`, 30000);
  assert(await click(['year in review', '年度回看', '年度回顧']));
  await waitFor(`location.hash.includes('/year-in-review')`, 10000);
  assert(await click(['this year', '本年', '今年']));

  const startedAt = Date.now();
  assert(await click(['generate year in review', '生成年回顾', '生成年回顧']));
  const renderMs = await waitFor(
    `document.body.innerText.includes('Open File') || document.body.innerText.includes('打开文件') || document.body.innerText.includes('開啟檔案')`,
    30000,
  );
  const bodyText = await evaluate('document.body.innerText');
  assert(!/该月没有照片|該月沒有照片/u.test(bodyText), 'English Year in Review rendered a Chinese empty-month reason.');
  const outputPath = bodyText.match(/[A-Za-z]:\\[^\r\n]*year-in-review-[^\r\n]*\.jpg/i)?.[0];
  assert(outputPath && fs.existsSync(outputPath), 'Rendered export path does not exist.');
  const metadata = await sharp(outputPath).metadata();
  assert.strictEqual(metadata.width, 400);
  assert.strictEqual(metadata.height, 2840);
  assert.strictEqual(await evaluate('1 + 1'), 2, 'Renderer stopped responding after generation.');

  const result = {
    outputPath,
    width: metadata.width,
    height: metadata.height,
    renderMs,
    totalMs: Date.now() - startedAt,
  };
  if (screenshotPath) {
    const screenshot = await Promise.race([
      send('Page.captureScreenshot', { format: 'png' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Screenshot capture timed out.')), 5000)),
    ]);
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  }
  socket.terminate();
  activeSocket = null;
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  activeSocket?.terminate();
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
