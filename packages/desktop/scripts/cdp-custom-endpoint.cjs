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
    const chooseProtocol = async protocol => {
      await evaluate(`(() => {
        const select = document.querySelector('select[aria-label="Request protocol"]');
        if (!select || select.disabled) throw new Error('Protocol unavailable');
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(protocol)});
        select.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
    };
    const savedConfig = () => evaluate("JSON.parse(localStorage.getItem('photo-manager-settings')).state.providers.custom");
    const statusText = () => evaluate("document.querySelector('[data-testid=custom-test-status]').innerText");
    await setInput(0, 'synthetic-custom-ui-key');
    await setInput(2, 'customer-alias');
    const protocols = {
      responses: '/v1/responses', chat_completions: '/v1/chat/completions',
      anthropic_messages: '/v1/messages', google_generate_content: '/v1beta/models/customer-alias:generateContent',
    };
    for (const [protocol, expectedPath] of Object.entries(protocols)) {
      await setInput(1, origin + (protocol === 'google_generate_content' ? '/v1beta' : '/v1'));
      await chooseProtocol(protocol);
      assert((await statusText()).includes('Retest required'));
      assert(await click(['Test text'], true));
      await waitFor("document.body.innerText.includes('Text test passed')");
      assert.equal(requests.at(-1).path, expectedPath);
      assert.equal(requests.at(-1).hasImage, false);
      const textOnly = await savedConfig();
      assert.equal(textOnly.supportsVision, false);
      assert.equal(textOnly.connectionTests.text, true);
      assert(!Object.hasOwn(textOnly, 'apiKey'));
      assert(await click(['Test image'], true));
      await waitFor("document.body.innerText.includes('Image test passed')");
      assert.equal(requests.at(-1).path, expectedPath);
      assert.equal(requests.at(-1).hasImage, true);
      const verified = await savedConfig();
      assert.equal(verified.protocol, protocol);
      assert.equal(verified.model, 'customer-alias');
      assert.equal(verified.supportsVision, true);
      const runtime = await evaluate(`window.electronAPI.llm.chatWithImage(${JSON.stringify({
        ...verified, prompt: 'Describe this synthetic image', imageBase64: 'AA==', mimeType: 'image/png',
      })})`);
      assert.equal(runtime.content, 'runtime-photo-result');
      assert.equal(requests.at(-1).path, expectedPath);
    }
    await send('Page.reload', { ignoreCache: true });
    await waitFor("document.body.innerText.includes('Custom Endpoint')");
    assert(await click(['Custom Endpoint']));
    await waitFor("document.querySelector('[data-testid=custom-test-status]')?.innerText.includes('Test image: Passed')");
    assert.equal(await evaluate("document.querySelector('select[aria-label=\"Request protocol\"]').value"), 'google_generate_content');
    await setInput(2, 'changed-alias');
    assert(!(await statusText()).includes('Passed'));
    await setInput(2, 'customer-alias');
    assert(!(await statusText()).includes('Passed'), 'Editing and restoring the model must still require retesting.');
    assert(await click(['Test image'], true));
    await waitFor("document.body.innerText.includes('Image test passed')");
    await setInput(0, 'synthetic-custom-ui-key-replaced');
    assert(!(await statusText()).includes('Passed'), 'Key changes did not invalidate previous tests.');
    const savedKeyStatus = await evaluate("window.electronAPI.settings.getApiKeyStatus('custom')");
    assert(await click(['Test text'], true));
    await waitFor("document.body.innerText.includes('API Key') && !document.querySelector('input[type=password]').disabled");
    assert.deepEqual(await evaluate("window.electronAPI.settings.getApiKeyStatus('custom')"), savedKeyStatus,
      'A failed test overwrote the previously saved secure Key.');
    assert(!(await statusText()).includes('Passed'), 'A failed replacement Key restored old successful test badges.');
    assert.equal((await savedConfig()).model, 'customer-alias', 'A failed test changed the saved model.');
    await setInput(0, 'synthetic-custom-ui-key');
    responseMode = 'wrong-color';
    assert(await click(['Test image'], true));
    await waitFor("document.body.innerText.includes('Request') || document.querySelector('[data-testid=custom-test-status]')?.innerText.includes('Retest required')");
    await waitFor("JSON.parse(localStorage.getItem('photo-manager-settings')).state.providers.custom.connectionTests?.vision === false");
    assert.equal((await savedConfig()).supportsVision, false);
    responseMode = 'valid';
    delayMs = 10000;
    assert(await click(['Test image'], true));
    await waitFor("document.querySelector('input[type=password]').disabled");
    assert.equal(await evaluate("document.querySelector('select[aria-label=\"Request protocol\"]').disabled"), true);
    await waitFor("document.body.innerText.includes('Image test passed')");
    const result = { fourProtocols: true, separateTextAndImageTests: true, imageColorValidated: true,
      arbitraryModelAliasPreserved: true, runtimeUsesTestedProtocol: true, persistedAfterReload: true,
      modelAndKeyEditsRequireRetest: true, failedImageTestDisablesVision: true, fieldsLockedDuringTest: true,
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
