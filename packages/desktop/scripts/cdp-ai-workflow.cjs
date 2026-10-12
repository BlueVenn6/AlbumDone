const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { connectToAlbumDone } = require('./cdp-client.cjs');

let completed = false;
process.on('beforeExit', (code) => { if (!code && !completed) process.exitCode = 1; });

async function main() {
  const port = Number(process.argv[2]);
  const albumPath = path.resolve(process.argv[3]);
  const client = await connectToAlbumDone(port);
  const { socket, send, evaluate, waitFor, click } = client;
  let savedSettings;
  let testKeyCreated = false;
  let provider;
  let replyMode = 'probe';
  let abortedRequest = false;
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const payload = JSON.parse(body);
      requests.push({ url: request.url, payload });
      const mode = replyMode;
      const respond = () => {
        response.setHeader('Content-Type', 'application/json');
        if (mode === 'error') {
          response.writeHead(503);
          response.end(JSON.stringify({ error: { message: 'Synthetic temporary outage' } }));
        } else {
          const content = mode === 'invalid-probe' ? 'Invalid API key'
            : mode === 'probe' ? 'ok' : mode === 'delay' ? 'LATE_RESULT_MUST_NOT_APPEAR' : 'KNOWN_TEST_RESULT_42';
          response.end(JSON.stringify(request.url.endsWith('/responses')
            ? { output_text: content } : { choices: [{ message: { content } }] }));
        }
      };
      if (mode === 'delay') {
        const timer = setTimeout(respond, 20000);
        response.on('close', () => { clearTimeout(timer); abortedRequest = true; });
      } else respond();
    });
  });
  try {
    const userData = await evaluate(`window.electronAPI.app.getPath('userData')`);
    const relative = path.relative(os.tmpdir(), userData);
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative)
      && path.basename(path.dirname(userData)).startsWith('albumdone-ui-'), 'This check requires an isolated test profile.');
    const candidates = { custom: 'test-vision-model', qwen: 'qwen3.7-plus', minimax: 'MiniMax-M3', moonshot: 'kimi-k2.5', zhipu: 'glm-5v-turbo', deepseek: 'deepseek-flash' };
    for (const candidate of Object.keys(candidates)) {
      if (!await evaluate(`window.electronAPI.settings.getApiKeyStatus(${JSON.stringify(candidate)}).then(status => status.hasApiKey)`)) {
        provider = candidate;
        break;
      }
    }
    // Existing credentials stay inside the application's normal main-process transport.
    // The local fixture never reads or records request headers and never forwards requests.
    provider ??= 'custom';
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const config = { provider, model: candidates[provider], mode: 'direct', supportsVision: true,
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`, hasApiKey: true };
    const probe = await evaluate(`window.electronAPI.llm.testConnection(${JSON.stringify({ ...config, apiKey: 'albumdone-local-workflow-key' })})`);
    assert.equal(probe.success, true, JSON.stringify(probe));
    replyMode = 'invalid-probe';
    const rejected = await evaluate(`window.electronAPI.llm.testConnection(${JSON.stringify({ ...config, apiKey: 'albumdone-local-workflow-key' })})`);
    assert.equal(rejected.success, false, 'A 200 response containing an API error passed the connection check.');
    savedSettings = await evaluate(`localStorage.getItem('photo-manager-settings')`);
    if (!await evaluate(`window.electronAPI.settings.getApiKeyStatus(${JSON.stringify(provider)}).then(status => status.hasApiKey)`)) {
      await evaluate(`window.electronAPI.settings.setApiKey(${JSON.stringify(provider)}, 'albumdone-local-workflow-key')`);
      testKeyCreated = true;
    }
    await evaluate(`(() => {
      localStorage.setItem('photo-manager-settings', JSON.stringify({ version: 1, state: {
        providers: ${JSON.stringify({ [provider]: config })}, defaultVisionProvider: ${JSON.stringify(provider)}, defaultTextProvider: ${JSON.stringify(provider)},
        customInstructions: [], trashRetentionDays: 30,
      }}));
      history.replaceState({ usr: { albumId: ${JSON.stringify(albumPath)}, albumTitle: 'Synthetic AI test' }, key: 'ai-workflow' }, '', '#/screenshots');
    })()`);
    await send('Page.reload', { ignoreCache: true });
    await waitFor(`document.body.innerText.includes('Screenshots (')`);
    await waitFor(`document.querySelector('img')?.complete && document.querySelector('img')?.naturalWidth > 0`);
    await waitFor(`[...document.querySelectorAll('div')].some(row =>
      row.style.position === 'absolute' && row.style.top && row.textContent.includes('Screenshot_'))`);
    await evaluate(`(() => {
      const row = [...document.querySelectorAll('div')].find(item =>
        item.style.position === 'absolute' && item.style.top && item.textContent.includes('Screenshot_'));
      if (!row) throw new Error('Screenshot row missing.');
      row.click();
    })()`);
    await waitFor(`(() => { const input = document.querySelector('input[placeholder="Custom instruction…"]'); return input && !input.disabled; })()`);
    const execute = async (prompt) => {
      await evaluate(`(() => {
        const input = document.querySelector('input[placeholder="Custom instruction…"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(prompt)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await waitFor(`[...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Execute' && !button.disabled)`);
      assert(await click(['execute'], true));
    };
    replyMode = 'success';
    await execute('Return the known test number.');
    await waitFor(`document.querySelector('textarea')?.value === 'KNOWN_TEST_RESULT_42'`);
    const successfulRequest = requests.at(-1);
    assert.equal(successfulRequest.url, provider === 'custom' ? '/v1/responses' : '/v1/chat/completions');
    const parts = (successfulRequest.payload.messages || successfulRequest.payload.input)
      .flatMap((message) => Array.isArray(message.content) ? message.content : []);
    assert(parts.some((part) => (part.type === 'image_url' || part.type === 'input_image')
      && /^data:image\/(png|jpeg|webp);base64,/.test(typeof part.image_url === 'string' ? part.image_url : part.image_url.url)));
    assert(parts.some((part) => (part.type === 'text' || part.type === 'input_text') && part.text.includes('Return the known test number.')));
    replyMode = 'error';
    await execute('Exercise a temporary provider failure.');
    await waitFor(`document.querySelector('textarea')?.value.includes('Error:')`);
    replyMode = 'success';
    await execute('Retry after the temporary failure.');
    await waitFor(`document.querySelector('textarea')?.value === 'KNOWN_TEST_RESULT_42'`);
    replyMode = 'delay';
    const previousRequests = requests.length;
    await execute('Exercise cancellation.');
    const requestDeadline = Date.now() + 10000;
    while (requests.length === previousRequests && Date.now() < requestDeadline) await new Promise(resolve => setTimeout(resolve, 100));
    assert(requests.length > previousRequests, 'The delayed request never reached the server.');
    assert(await click(['cancel'], true));
    await waitFor(`![...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Cancel')`);
    const abortDeadline = Date.now() + 5000;
    while (!abortedRequest && Date.now() < abortDeadline) await new Promise(resolve => setTimeout(resolve, 100));
    assert(abortedRequest, 'Cancel did not abort the actual HTTP request.');
    assert.equal(await evaluate(`document.querySelector('textarea')?.value.includes('LATE_RESULT_MUST_NOT_APPEAR') || false`), false);
    completed = true;
    console.log(JSON.stringify({ connectionProbe: true, invalid200Rejected: true, promptAndPhotoTransmitted: true,
      resultVisible: true, failureThenRetry: true, cancelledHttpRequest: true, requests: requests.length,
      scope: 'Production UI / preload / main IPC / local HTTP fixture; no real provider accuracy claim.' }));
  } finally {
    if (testKeyCreated) await evaluate(`window.electronAPI.settings.deleteApiKey(${JSON.stringify(provider)})`);
    if (savedSettings !== undefined) {
      await evaluate(savedSettings === null ? `localStorage.removeItem('photo-manager-settings')`
        : `localStorage.setItem('photo-manager-settings', ${JSON.stringify(savedSettings)})`);
    }
    socket.terminate();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
