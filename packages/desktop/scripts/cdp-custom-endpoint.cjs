const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { connectToAlbumDone } = require('./cdp-client.cjs');

let completed = false;
process.on('beforeExit', code => { if (!code && !completed) process.exitCode = 1; });

(async () => {
  const client = await connectToAlbumDone(Number(process.argv[2]));
  const { socket, evaluate, send, waitFor, click } = client;
  const requests = [];
  let responseMode = 'valid';
  let delayMs = 0;
  const server = http.createServer((request, response) => {
    let raw = '';
    request.on('data', chunk => { raw += chunk; });
    request.on('end', () => {
      const body = JSON.parse(raw);
      const hasImage = JSON.stringify(body).includes('iVBORw0KGgoAAAANSUhEUgAAAEAAAABA');
      const hasRuntimeImage = JSON.stringify(body).includes('AA==');
      requests.push({ path: request.url, body, hasImage, hasRuntimeImage });
      const auth = request.headers.authorization || request.headers['x-api-key'] || request.headers['x-goog-api-key'];
      if (!['synthetic-custom-ui-key', 'Bearer synthetic-custom-ui-key'].includes(auth)) {
        response.writeHead(401); response.end(JSON.stringify({ error: { message: 'Synthetic credential missing' } })); return;
      }
      const text = responseMode === 'wrong-color' ? 'blue' : hasImage ? 'red' : hasRuntimeImage ? 'runtime-photo-result' : 'ok';
      const payload = request.url.endsWith('/responses') ? { output_text: text }
        : request.url.endsWith('/messages') ? { content: [{ type: 'text', text }] }
          : request.url.includes(':generateContent') ? { candidates: [{ content: { parts: [{ text }] } }] }
            : { choices: [{ message: { content: text } }] };
      setTimeout(() => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(payload)); }, delayMs);
    });
  });
  try {
    const userData = await evaluate("window.electronAPI.app.getPath('userData')");
    assert.equal(path.basename(path.dirname(userData)), 'albumdone-ui-custom-20261012');
    assert(!path.relative(os.tmpdir(), userData).startsWith('..'));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    await evaluate(`localStorage.setItem('photo-manager-settings', JSON.stringify({version:1,state:{language:'en',providers:{},customInstructions:[]}})); history.replaceState(null, '', '#/settings');`);
    await send('Page.reload', { ignoreCache: true });
    await waitFor("document.body.innerText.includes('Custom Endpoint')");
    assert(await click(['Custom Endpoint']));
    const setInput = async (index, value) => {
      await evaluate(`(() => {
        const header = [...document.querySelectorAll('button')].find(button => button.textContent.trim().startsWith('Custom Endpoint'));
        const input = header.parentElement.querySelectorAll('input')[${index}];
        if (!input || input.disabled) throw new Error('Input unavailable');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
    };
    const savedConfig = () => evaluate("JSON.parse(localStorage.getItem('photo-manager-settings')).state.providers.custom");
    await setInput(0, 'synthetic-custom-ui-key');
    await setInput(1, origin + '/v1');
    await setInput(2, 'customer-alias');
    assert.equal(await evaluate("document.querySelector('select[aria-label=\"Request protocol\"]')"), null);
    assert.equal(await evaluate("document.body.innerText.includes('Responses API') || document.body.innerText.includes('Chat Completions API')"), false);
    assert(await click(['Test Connection'], true));
    await waitFor("document.body.innerText.includes('Connection successful')");
    assert.equal(requests.at(-1).path, '/v1/chat/completions');
    assert.equal(requests.at(-1).hasImage, true);
    const verified = await savedConfig();
    assert.equal(verified.model, 'customer-alias');
    assert.equal(verified.mode, 'proxy');
    assert.equal(verified.supportsVision, true);
    assert(!Object.hasOwn(verified, 'protocol'));
    assert(!Object.hasOwn(verified, 'connectionTests'));
    assert(!Object.hasOwn(verified, 'apiKey'));
    const runtime = await evaluate(`window.electronAPI.llm.chatWithImage(${JSON.stringify({
      ...verified, prompt: 'Describe this synthetic image', imageBase64: 'AA==', mimeType: 'image/png',
    })})`);
    assert.equal(runtime.content, 'runtime-photo-result');
    assert.equal(requests.at(-1).path, '/v1/chat/completions');
    await send('Page.reload', { ignoreCache: true });
    await waitFor("document.body.innerText.includes('Custom Endpoint')");
    assert(await click(['Custom Endpoint']));
    await setInput(0, 'synthetic-custom-ui-key-replaced');
    const savedKeyStatus = await evaluate("window.electronAPI.settings.getApiKeyStatus('custom')");
    assert(await click(['Test Connection'], true));
    await waitFor("document.body.innerText.includes('API Key') && !document.querySelector('input[type=password]').disabled");
    assert.deepEqual(await evaluate("window.electronAPI.settings.getApiKeyStatus('custom')"), savedKeyStatus,
      'A failed test overwrote the previously saved secure Key.');
    assert.equal((await savedConfig()).model, 'customer-alias', 'A failed test changed the saved model.');
    await setInput(0, 'synthetic-custom-ui-key');
    responseMode = 'wrong-color';
    assert(await click(['Test Connection'], true));
    await waitFor("!document.querySelector('input[type=password]').disabled");
    assert.equal((await savedConfig()).supportsVision, true, 'A failed retest changed the saved route.');
    responseMode = 'valid';
    delayMs = 1000;
    assert(await click(['Test Connection'], true));
    await waitFor("document.querySelector('input[type=password]').disabled");
    await waitFor("document.body.innerText.includes('Connection successful')");
    const result = { protocolPickerRemoved: true, singleImageConnectionTest: true, imageColorValidated: true,
      chatCompletionsRelayPath: true, arbitraryModelAliasPreserved: true, runtimeUsesTestedRoute: true,
      persistedAfterReload: true, fieldsLockedDuringTest: true,
      failedTestPreservesSavedSecureKey: true,
      requestCount: requests.length,
      scope: 'Production renderer/preload/main/shared client; local HTTP service and isolated in-memory test credentials; not a packaged artifact or live vendor account.' };
    if (process.argv[3]) fs.writeFileSync(path.resolve(process.argv[3]), JSON.stringify(result, null, 2));
    completed = true;
    console.log(JSON.stringify(result));
  } finally {
    socket.terminate();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
