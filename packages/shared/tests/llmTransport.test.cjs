const assert = require('assert');

const { LLMClient } = require('../dist');

const originalFetch = global.fetch;
global.fetch = async () => {
  throw new Error('Global fetch must not be used when a transport is injected.');
};

function response(status, body) {
  const payload = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return payload;
    },
    async json() {
      return body;
    },
  };
}

(async () => {
  const calls = [];
  const config = {
    provider: 'google',
    apiKey: 'test-key-not-real',
    model: 'gemini-2.5-flash',
    mode: 'direct',
  };
  const transport = async (url, init, timeoutMs) => {
    calls.push({ url, init, timeoutMs });
    return response(200, {
      candidates: [{ content: { parts: [{ text: 'ok' }] } }],
    });
  };

  const client = new LLMClient(config, transport);
  const tested = await client.testConnection();
  assert.strictEqual(tested.success, true);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(
    calls[0].url,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
  );
  assert.strictEqual(calls[0].init.method, 'POST');
  assert.strictEqual(calls[0].init.headers['x-goog-api-key'], config.apiKey);
  assert(Number.isFinite(calls[0].timeoutMs) && calls[0].timeoutMs > 0);
  const testBody = JSON.parse(calls[0].init.body);
  assert(Array.isArray(testBody.contents));
  assert(testBody.contents[0].parts.some((part) => typeof part.text === 'string'));
  assert(testBody.contents[0].parts.some((part) => part.inline_data?.data));

  const chatResult = await client.chatWithImage('Read this image', 'base64-image', 'image/jpeg');
  assert.strictEqual(chatResult.content, 'ok');
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[1].url, calls[0].url, 'Test and runtime must use the same endpoint.');

  const failed = new LLMClient(config, async () => response(404, {
    error: { message: 'not found' },
  }));
  const failedTest = await failed.testConnection();
  assert.strictEqual(failedTest.success, false);
  assert.strictEqual(failedTest.status, 404);

  const deepseekCalls = [];
  const deepseekClient = new LLMClient({
    provider: 'deepseek',
    apiKey: 'deepseek-test-key-not-real',
    model: 'deepseek-v4-flash',
    mode: 'direct',
  }, async (url, init, timeoutMs) => {
    deepseekCalls.push({ url, init, timeoutMs });
    return response(200, {
      choices: [{ message: { content: 'ok' } }],
    });
  });
  const deepseekTest = await deepseekClient.testConnection();
  assert.strictEqual(deepseekTest.success, true);
  assert.strictEqual(deepseekTest.mode, 'text');
  assert.strictEqual(deepseekCalls[0].url, 'https://api.deepseek.com/v1/chat/completions');
  const deepseekBody = JSON.parse(deepseekCalls[0].init.body);
  assert.strictEqual(deepseekBody.model, 'deepseek-v4-flash');
  assert(!JSON.stringify(deepseekBody.messages).includes('image_url'));

  const customDirectCalls = [];
  const customDirectClient = new LLMClient({
    provider: 'custom',
    apiKey: 'custom-direct-key-not-real',
    model: 'gpt-4.1',
    baseUrl: 'https://llm.example.com/v1',
    mode: 'direct',
  }, async (url, init, timeoutMs) => {
    customDirectCalls.push({ url, init, timeoutMs });
    return response(200, {
      output_text: 'ok',
    });
  });
  const customDirectTest = await customDirectClient.testConnection();
  assert.strictEqual(customDirectTest.success, true);
  assert.strictEqual(customDirectCalls[0].url, 'https://llm.example.com/v1/responses');
  const customDirectBody = JSON.parse(customDirectCalls[0].init.body);
  assert.strictEqual(customDirectBody.model, 'gpt-4.1');
  assert(Array.isArray(customDirectBody.input));

  const customProxyCalls = [];
  const customProxyClient = new LLMClient({
    provider: 'custom',
    apiKey: 'custom-proxy-key-not-real',
    model: 'qwen-vl-plus',
    baseUrl: 'https://proxy.example.com/v1',
    mode: 'proxy',
  }, async (url, init, timeoutMs) => {
    customProxyCalls.push({ url, init, timeoutMs });
    return response(200, {
      choices: [{ message: { content: 'ok' } }],
    });
  });
  const customProxyTest = await customProxyClient.testConnection();
  assert.strictEqual(customProxyTest.success, true);
  assert.strictEqual(customProxyTest.mode, 'vision');
  assert.strictEqual(customProxyCalls[0].url, 'https://proxy.example.com/v1/chat/completions');
  const customProxyBody = JSON.parse(customProxyCalls[0].init.body);
  assert.strictEqual(customProxyBody.model, 'qwen-vl-plus');
  assert(Array.isArray(customProxyBody.messages));

  console.log('shared injected LLM transport tests passed');
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    global.fetch = originalFetch;
  });
