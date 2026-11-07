const http = require('node:http');
const WebSocket = require('ws');

async function connectToAlbumDone(port) {
  const targets = await new Promise((resolve, reject) => {
    const request = http.get(`http://127.0.0.1:${port}/json/list`, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
      response.on('error', reject);
    });
    request.setTimeout(15000, () => request.destroy(new Error('CDP target discovery timed out.')));
    request.on('error', reject);
  });
  const target = targets.find((item) => item.type === 'page');
  if (!target?.webSocketDebuggerUrl) throw new Error('AlbumDone renderer was not found.');
  const socket = new WebSocket(target.webSocketDebuggerUrl, { handshakeTimeout: 15000 });
  const pending = new Map();
  let commandId = 0;
  const rejectPending = (error) => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    pending.clear();
  };
  socket.on('error', rejectPending);
  socket.on('close', () => rejectPending(new Error('Electron closed before UI acceptance completed.')));
  socket.on('message', (raw) => {
    const message = JSON.parse(String(raw));
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
    socket.once('close', () => reject(new Error('Electron disconnected during connection.')));
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    if (socket.readyState !== WebSocket.OPEN) return reject(new Error('Electron is disconnected.'));
    const id = ++commandId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP command timed out: ${method}`));
    }, 30000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || 'Renderer evaluation failed.');
    }
    return response.result.value;
  };
  const waitFor = async (expression, timeoutMs = 30000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await evaluate(`Boolean(document.body && (${expression}))`)) return Date.now() - startedAt;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  };
  const click = (labels, exact = false) => evaluate(`(() => {
    const labels = ${JSON.stringify(labels.map((label) => label.toLowerCase()))};
    const button = [...document.querySelectorAll('button')].find((item) => {
      const text = (item.textContent || '').trim().toLowerCase();
      return labels.some((label) => ${exact ? 'text === label' : 'text.includes(label)'});
    });
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  return { socket, send, evaluate, waitFor, click };
}

module.exports = { connectToAlbumDone };
