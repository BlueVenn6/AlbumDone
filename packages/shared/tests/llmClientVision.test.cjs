const assert = require('assert');
const { LLMClient } = require('../dist/api/llmClient');
const { PROVIDER_MODELS } = require('../dist/types');

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parseJsonBody(init) {
  assert.strictEqual(typeof init.body, 'string');
  return JSON.parse(init.body);
}

function getHeader(init, name) {
  const headers = init.headers || {};
  return headers[name] || headers[name.toLowerCase()];
}

function isConnectionProbe(init) {
  return typeof init.body === 'string' && init.body.includes('Reply with just');
}

function assertOpenAICompatibleImageRequest(call, expected) {
  assert.strictEqual(call.url, expected.url);
  assert.strictEqual(getHeader(call.init, 'Authorization'), `Bearer ${expected.apiKey}`);

  const body = parseJsonBody(call.init);
  assert.strictEqual(body.model, expected.model);
  assert(Array.isArray(body.messages));
  assert.strictEqual(body.messages.length, 1);

  const content = body.messages[0].content;
  assert(Array.isArray(content));
  const mimeType = expected.mimeType || 'image/jpeg';
  const imageBase64 = expected.imageBase64 || 'ZmFrZS1pbWFnZQ==';
  const prompt = expected.prompt || 'read the screenshot';
  assert.deepStrictEqual(content[0], {
    type: 'image_url',
    image_url: {
      url: `data:${mimeType};base64,${imageBase64}`,
      detail: 'high',
    },
  });
  assert.deepStrictEqual(content[1], {
    type: 'text',
    text: prompt,
  });
}

function assertOpenAIResponsesImageRequest(call, expected) {
  assert.strictEqual(call.url, expected.url);
  assert.strictEqual(getHeader(call.init, 'Authorization'), `Bearer ${expected.apiKey}`);

  const body = parseJsonBody(call.init);
  assert.strictEqual(body.model, expected.model);
  assert(Array.isArray(body.input));
  assert.strictEqual(body.input.length, 1);

  const content = body.input[0].content;
  assert(Array.isArray(content));
  const mimeType = expected.mimeType || 'image/jpeg';
  const imageBase64 = expected.imageBase64 || 'ZmFrZS1pbWFnZQ==';
  const prompt = expected.prompt || 'read the screenshot';
  assert.deepStrictEqual(content[0], {
    type: 'input_image',
    image_url: `data:${mimeType};base64,${imageBase64}`,
    detail: 'high',
  });
  assert.deepStrictEqual(content[1], {
    type: 'input_text',
    text: prompt,
  });
}

(async () => {
  const originalFetch = global.fetch;
  const originalURL = global.URL;
  const calls = [];

  try {
    assert.deepStrictEqual(PROVIDER_MODELS.google.models, [
      'gemini-2.5-flash',
      'gemini-2.5-pro',
    ]);

    global.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      const bodyText = String(init.body || '');
      const content = bodyText.includes('dominant color')
        ? 'red'
        : isConnectionProbe(init) ? 'ok' : 'vision ok';
      if (String(url).endsWith('/responses')) {
        return jsonResponse({
          output_text: content,
          usage: {
            input_tokens: 11,
            output_tokens: 3,
          },
        });
      }
      return jsonResponse({
        choices: [
          {
            message: {
              content,
            },
          },
        ],
        usage: {
          prompt_tokens: 11,
          completion_tokens: 3,
        },
      });
    };

    global.URL = class HermesIncompleteURL {
      constructor() {
        throw new Error('URL.protocol is not implemented');
      }
    };
    const hermesClient = new LLMClient({
      provider: 'zhipu',
      apiKey: 'zhipu-key',
      model: 'glm-4v-plus',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      supportsVision: true,
      mode: 'direct',
    });
    const hermesResult = await hermesClient.chatWithImage(
      'read the screenshot',
      'ZmFrZS1pbWFnZQ==',
      'image/jpeg',
    );
    assert.strictEqual(hermesResult.content, 'vision ok');
    assert.strictEqual(calls[0].url, 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
    global.URL = originalURL;
    calls.length = 0;

    const responsesDirect = [
      {
        provider: 'openai',
        model: 'gpt-5.6',
        baseUrl: 'https://api.openai.test/v1',
        expectedUrl: 'https://api.openai.test/v1/responses',
      },
    ];

    for (const config of responsesDirect) {
      calls.length = 0;
      const apiKey = `key-${config.provider}`;
      const client = new LLMClient({
        provider: config.provider,
        apiKey,
        model: config.model,
        baseUrl: config.baseUrl,
        supportsVision: true,
        mode: 'direct',
      });

      const result = await client.chatWithImage(
        'read the screenshot',
        'ZmFrZS1pbWFnZQ==',
        'image/jpeg',
      );

      assert.strictEqual(result.content, 'vision ok');
      assert.strictEqual(calls.length, 1);
      assertOpenAIResponsesImageRequest(calls[0], {
        url: config.expectedUrl,
        apiKey,
        model: config.model,
      });
    }

    calls.length = 0;
    const openAIConnectionClient = new LLMClient({
      provider: 'openai',
      apiKey: 'openai-test-key',
      model: 'gpt-5.6',
      baseUrl: 'https://api.openai.test/v1',
      supportsVision: true,
      mode: 'direct',
    });
    const openAIConnectionResult = await openAIConnectionClient.testConnection();
    assert.deepStrictEqual(openAIConnectionResult, { success: true, mode: 'vision' });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, 'https://api.openai.test/v1/responses');
    const openAIConnectionBody = parseJsonBody(calls[0].init);
    assert.strictEqual(openAIConnectionBody.input[0].content[0].type, 'input_image');
    assert.match(openAIConnectionBody.input[0].content[0].image_url, /^data:image\/png;base64,iVBORw0KGgo/);
    assert.match(openAIConnectionBody.input[0].content[1].text, /dominant color/);
    assert.strictEqual(openAIConnectionBody.temperature, undefined);

    const openAICompatibleDirect = [
      {
        provider: 'moonshot',
        model: 'kimi-k2.5',
        baseUrl: 'https://api.moonshot.cn/v1',
        expectedUrl: 'https://api.moonshot.cn/v1/chat/completions',
      },
      {
        provider: 'zhipu',
        model: 'glm-5v-turbo',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        expectedUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      },
      {
        provider: 'qwen',
        model: 'qwen3.7-plus',
        baseUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
        expectedUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
      },
      {
        provider: 'minimax',
        model: 'MiniMax-M3',
        baseUrl: 'https://api.minimaxi.com/v1',
        expectedUrl: 'https://api.minimaxi.com/v1/chat/completions',
      },
    ];

    for (const config of openAICompatibleDirect) {
      calls.length = 0;
      const apiKey = `key-${config.provider}`;
      const client = new LLMClient({
        provider: config.provider,
        apiKey,
        model: config.model,
        baseUrl: config.baseUrl,
        supportsVision: true,
        mode: 'direct',
      });

      const result = await client.chatWithImage(
        'read the screenshot',
        'ZmFrZS1pbWFnZQ==',
        'image/jpeg',
      );

      assert.strictEqual(result.content, 'vision ok');
      assert.strictEqual(calls.length, 1);
      assertOpenAICompatibleImageRequest(calls[0], {
        url: config.expectedUrl,
        apiKey,
        model: config.model,
      });

      calls.length = 0;
      const connectionResult = await client.testConnection();
      assert.deepStrictEqual(connectionResult, { success: true, mode: 'vision' });
      const connectionBody = parseJsonBody(calls[0].init);
      assert(Array.isArray(connectionBody.messages[0].content));
      assert.match(connectionBody.messages[0].content[0].image_url.url, /^data:image\/png;base64,iVBORw0KGgo/);
      assert.match(connectionBody.messages[0].content[1].text, /dominant color/);
      if (config.provider === 'minimax') {
        assert.strictEqual(connectionBody.max_tokens, 512);
      }
    }

    calls.length = 0;
    const proxyClient = new LLMClient({
      provider: 'deepseek',
      apiKey: 'proxy-key',
      model: 'gpt-4o',
      baseUrl: 'https://proxy.example.com/v1',
      supportsVision: true,
      mode: 'proxy',
    });
    const proxyResult = await proxyClient.chatWithImage(
      'read the screenshot',
      'ZmFrZS1pbWFnZQ==',
      'image/jpeg',
    );
    assert.strictEqual(proxyResult.content, 'vision ok');
    assert.strictEqual(calls.length, 1);
    assertOpenAICompatibleImageRequest(calls[0], {
      url: 'https://proxy.example.com/v1/chat/completions',
      apiKey: 'proxy-key',
      model: 'gpt-4o',
    });

    calls.length = 0;
    const proxyTestResult = await proxyClient.testConnection();
    assert.deepStrictEqual(proxyTestResult, { success: true, mode: 'vision' });
    assert.strictEqual(calls.length, 1);
    const proxyTestBody = parseJsonBody(calls[0].init);
    assert.strictEqual(calls[0].url, 'https://proxy.example.com/v1/chat/completions');
    assert(Array.isArray(proxyTestBody.messages[0].content));
    assert.match(proxyTestBody.messages[0].content[0].image_url.url, /^data:image\/png;base64,iVBORw0KGgo/);

    calls.length = 0;
    const responsesProxyClient = new LLMClient({
      provider: 'anthropic',
      apiKey: 'proxy-key',
      model: 'claude-sonnet-5',
      baseUrl: 'https://proxy.example.com/v1',
      supportsVision: true,
      mode: 'proxy',
    });
    const responsesProxyResult = await responsesProxyClient.chatWithImage(
      'read the screenshot',
      'ZmFrZS1pbWFnZQ==',
      'image/jpeg',
    );
    assert.strictEqual(responsesProxyResult.content, 'vision ok');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, 'https://proxy.example.com/v1/chat/completions');

    calls.length = 0;
    global.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ error: { message: 'unsupported request shape' } }, 400);
    };
    const fixedAnthropicProxyClient = new LLMClient({
      provider: 'anthropic',
      apiKey: 'proxy-key',
      model: 'claude-sonnet-5',
      baseUrl: 'https://proxy.example.com/v1',
      supportsVision: true,
      mode: 'proxy',
    });
    const fixedAnthropicResult = await fixedAnthropicProxyClient.testConnection();
    assert.strictEqual(fixedAnthropicResult.success, false);
    assert.strictEqual(fixedAnthropicResult.category, 'request_format');
    assert.deepStrictEqual(calls.map((call) => call.url), [
      'https://proxy.example.com/v1/chat/completions',
    ], 'An Anthropic relay must use the same Chat Completions route as the working legacy flow.');

    calls.length = 0;
    global.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ choices: [{ message: { content: 'proxy ok' } }] });
    };
    const fallbackProxyClient = new LLMClient({
      provider: 'custom',
      apiKey: 'proxy-key',
      model: 'vision-model',
      baseUrl: 'https://proxy.example.com/v1',
      supportsVision: true,
      mode: 'proxy',
    });
    const fallbackResult = await fallbackProxyClient.chatWithImage(
      'read the screenshot', 'ZmFrZS1pbWFnZQ==', 'image/jpeg',
    );
    assert.strictEqual(fallbackResult.content, 'proxy ok');
    assert.deepStrictEqual(calls.map((call) => call.url), [
      'https://proxy.example.com/v1/chat/completions',
    ], 'A custom relay must use Chat Completions without hidden protocol retries.');
    for (const call of calls) {
      const requestBody = JSON.stringify(parseJsonBody(call.init));
      assert(requestBody.includes('ZmFrZS1pbWFnZQ=='), 'The proxy request must include the selected photo bytes.');
      assert(requestBody.includes('read the screenshot'), 'The proxy request must include the instruction.');
    }

    calls.length = 0;
    global.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        choices: [{ message: { content: '', reasoning_content: 'red' } }],
      });
    };
    const glmReasoningClient = new LLMClient({
      provider: 'zhipu',
      apiKey: 'glm-key',
      model: 'glm-5v-turbo',
      supportsVision: true,
      mode: 'direct',
    });
    const glmReasoningResult = await glmReasoningClient.testConnection();
    assert.deepStrictEqual(glmReasoningResult, { success: true, mode: 'vision' });
    assert.strictEqual(parseJsonBody(calls[0].init).max_tokens, 512);

    calls.length = 0;
    global.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      const content = String(init.body || '').includes('dominant color') ? 'red' : 'ok';
      return jsonResponse({ choices: [{ message: { content } }] });
    };
    const textOnlyClient = new LLMClient({
      provider: 'moonshot',
      apiKey: 'moonshot-key',
      model: 'moonshot-v1-8k',
      baseUrl: 'https://api.moonshot.cn/v1',
      supportsVision: false,
      mode: 'direct',
    });
    const textOnlyTestResult = await textOnlyClient.testConnection();
    assert.deepStrictEqual(textOnlyTestResult, { success: true, mode: 'text' });
    assert.strictEqual(calls.length, 1);
    const textOnlyBody = parseJsonBody(calls[0].init);
    assert.strictEqual(typeof textOnlyBody.messages[0].content, 'string');

    calls.length = 0;
    const deepSeekClient = new LLMClient({
      provider: 'deepseek',
      apiKey: 'deepseek-key',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      supportsVision: false,
      mode: 'direct',
    });
    const deepSeekConnection = await deepSeekClient.testConnection();
    assert.deepStrictEqual(deepSeekConnection, { success: true, mode: 'vision' });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, 'https://api.deepseek.com/v1/chat/completions');
    const deepSeekBody = parseJsonBody(calls[0].init);
    assert.strictEqual(deepSeekBody.model, 'deepseek-flash');
    assert(Array.isArray(deepSeekBody.messages[0].content));
    assert.match(deepSeekBody.messages[0].content[0].image_url.url, /^data:image\/png;base64,iVBORw0KGgo/);

    const staleProxyClient = new LLMClient({
      provider: 'moonshot',
      apiKey: 'proxy-key',
      model: 'moonshot-v1-8k',
      baseUrl: 'https://proxy.example.com/v1',
      supportsVision: true,
      mode: 'proxy',
    });
    await assert.rejects(
      () => staleProxyClient.chatWithImage(
        'read the screenshot',
        'ZmFrZS1pbWFnZQ==',
        'image/jpeg',
      ),
      /does not support vision/,
    );

    calls.length = 0;
    global.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      const bodyText = String(init.body || '');
      const content = bodyText.includes('dominant color')
        ? 'red'
        : isConnectionProbe(init) ? 'ok' : 'anthropic vision ok';
      return jsonResponse({
        content: [{ type: 'text', text: content }],
        usage: { input_tokens: 9, output_tokens: 4 },
      });
    };
    const anthropicClient = new LLMClient({
      provider: 'anthropic',
      apiKey: 'anthropic-key',
      model: 'claude-sonnet-5',
      baseUrl: 'https://api.anthropic.com/v1',
      supportsVision: true,
      mode: 'direct',
    });
    const anthropicResult = await anthropicClient.chatWithImage(
      'read the screenshot',
      'ZmFrZS1pbWFnZQ==',
      'image/png',
    );
    assert.strictEqual(anthropicResult.content, 'anthropic vision ok');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, 'https://api.anthropic.com/v1/messages');
    assert.strictEqual(getHeader(calls[0].init, 'x-api-key'), 'anthropic-key');
    assert.strictEqual(getHeader(calls[0].init, 'anthropic-version'), '2023-06-01');

    const anthropicBody = parseJsonBody(calls[0].init);
    assert.strictEqual(anthropicBody.model, 'claude-sonnet-5');
    assert.deepStrictEqual(anthropicBody.messages[0].content[0], {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: 'ZmFrZS1pbWFnZQ==',
      },
    });
    assert.deepStrictEqual(anthropicBody.messages[0].content[1], {
      type: 'text',
      text: 'read the screenshot',
    });

    calls.length = 0;
    const anthropicConnection = await anthropicClient.testConnection();
    assert.deepStrictEqual(anthropicConnection, { success: true, mode: 'vision' });
    const anthropicConnectionBody = parseJsonBody(calls[0].init);
    assert(Array.isArray(anthropicConnectionBody.messages[0].content));
    assert.strictEqual(anthropicConnectionBody.messages[0].content[0].type, 'image');
    assert.match(anthropicConnectionBody.messages[0].content[0].source.data, /^iVBORw0KGgo/);

    calls.length = 0;
    global.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      const bodyText = String(init.body || '');
      const content = bodyText.includes('dominant color')
        ? 'red'
        : isConnectionProbe(init) ? 'ok' : 'google vision ok';
      return jsonResponse({
        candidates: [
          {
            content: {
              parts: [{ text: content }],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 7,
          candidatesTokenCount: 3,
        },
      });
    };
    const googleClient = new LLMClient({
      provider: 'google',
      apiKey: 'google-key',
      model: 'gemini-2.5-flash',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      supportsVision: true,
      mode: 'direct',
    });
    const googleResult = await googleClient.chatWithImage(
      'read the screenshot',
      'ZmFrZS1pbWFnZQ==',
      'image/webp',
    );
    assert.strictEqual(googleResult.content, 'google vision ok');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(
      calls[0].url,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    );
    assert.strictEqual(getHeader(calls[0].init, 'x-goog-api-key'), 'google-key');

    const googleBody = parseJsonBody(calls[0].init);
    assert.deepStrictEqual(googleBody.contents[0].parts[0], {
      inline_data: {
        mime_type: 'image/webp',
        data: 'ZmFrZS1pbWFnZQ==',
      },
    });
    assert.deepStrictEqual(googleBody.contents[0].parts[1], {
      text: 'read the screenshot',
    });

    calls.length = 0;
    const googleConnection = await googleClient.testConnection();
    assert.deepStrictEqual(googleConnection, { success: true, mode: 'vision' });
    const googleConnectionBody = parseJsonBody(calls[0].init);
    assert.match(googleConnectionBody.contents[0].parts[0].inline_data.data, /^iVBORw0KGgo/);
    assert.match(googleConnectionBody.contents[0].parts[1].text, /dominant color/);

    const googleFailureCases = [
      {
        status: 401,
        body: { error: { message: 'API key not valid' } },
        category: 'api_key',
      },
      {
        status: 403,
        body: { error: { message: 'Permission denied' } },
        category: 'permission',
      },
      {
        status: 404,
        body: { error: { message: 'Model gemini-missing was not found' } },
        category: 'model_not_found',
      },
      {
        status: 429,
        body: { error: { message: 'Quota exceeded' } },
        category: 'rate_limited',
      },
    ];

    for (const failureCase of googleFailureCases) {
      global.fetch = async () => jsonResponse(failureCase.body, failureCase.status);
      const result = await googleClient.testConnection();
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.status, failureCase.status);
      assert.strictEqual(result.category, failureCase.category);
    }

    global.fetch = async () => {
      throw new TypeError('Network request failed: google-key');
    };
    const googleNetworkFailure = await googleClient.testConnection();
    assert.strictEqual(googleNetworkFailure.success, false);
    assert.strictEqual(googleNetworkFailure.category, 'base_url');
    assert(!googleNetworkFailure.error.includes('google-key'));

    const failureClient = new LLMClient({
      provider: 'openai',
      apiKey: 'sk-never-log-this',
      model: 'gpt-5.6',
      baseUrl: 'https://api.openai.test/v1',
      supportsVision: true,
      mode: 'direct',
    });

    global.fetch = async () => {
      throw new TypeError('fetch failed: sk-never-log-this');
    };
    const networkResult = await failureClient.testConnection();
    assert.strictEqual(networkResult.success, false);
    assert.strictEqual(networkResult.category, 'base_url');
    assert(!networkResult.error.includes('sk-never-log-this'));

    global.fetch = async (_url, init = {}) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'));
      }, { once: true });
    });
    await assert.rejects(
      () => failureClient.chat(
        [{ role: 'user', content: 'timeout test' }],
        { timeoutMs: 50 },
      ),
      (error) => error?.category === 'timeout',
    );

    const abortController = new AbortController();
    const cancelledRequest = failureClient.chat(
      [{ role: 'user', content: 'cancel test' }],
      { signal: abortController.signal, timeoutMs: 5000 },
    );
    abortController.abort();
    await assert.rejects(
      () => cancelledRequest,
      (error) => error?.category === 'cancelled',
    );

    console.log('llmClient vision tests passed');
  } finally {
    global.fetch = originalFetch;
    global.URL = originalURL;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
