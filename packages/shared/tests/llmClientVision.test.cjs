const assert = require('assert');
const { LLMClient } = require('../dist/api/llmClient');

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
  const calls = [];

  try {
    global.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/responses')) {
        return jsonResponse({
          output_text: 'vision ok',
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
              content: 'vision ok',
            },
          },
        ],
        usage: {
          prompt_tokens: 11,
          completion_tokens: 3,
        },
      });
    };

    const responsesDirect = [
      {
        provider: 'openai',
        model: 'gpt-5.5',
        baseUrl: 'https://api.openai.test/v1',
        expectedUrl: 'https://api.openai.test/v1/responses',
      },
      {
        provider: 'custom',
        model: 'llava',
        baseUrl: 'https://relay.example.com/v1',
        expectedUrl: 'https://relay.example.com/v1/responses',
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
      model: 'gpt-5.5',
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
    assert.match(openAIConnectionBody.input[0].content[0].image_url, /^data:image\/jpeg;base64,/);
    const connectionImage = Buffer.from(
      openAIConnectionBody.input[0].content[0].image_url.split(',')[1],
      'base64',
    );
    assert(connectionImage.length > 2000);
    assert.strictEqual(connectionImage[0], 0xff);
    assert.strictEqual(connectionImage[1], 0xd8);
    assert.strictEqual(openAIConnectionBody.input[0].content[1].type, 'input_text');

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
        model: 'MiniMax-VL-01',
        baseUrl: 'https://api.minimax.chat/v1',
        expectedUrl: 'https://api.minimax.chat/v1/chat/completions',
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
      const connectionDataUrl = connectionBody.messages[0].content[0].image_url.url;
      assert.match(connectionDataUrl, /^data:image\/jpeg;base64,/);
      assert(Buffer.from(connectionDataUrl.split(',')[1], 'base64').length > 2000);
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
    assert.strictEqual(proxyTestBody.messages[0].content[0].type, 'image_url');
    assert.strictEqual(proxyTestBody.messages[0].content[1].type, 'text');

    calls.length = 0;
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
    assert.deepStrictEqual(deepSeekConnection, { success: true, mode: 'text' });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, 'https://api.deepseek.com/v1/chat/completions');
    const deepSeekBody = parseJsonBody(calls[0].init);
    assert.strictEqual(deepSeekBody.model, 'deepseek-chat');
    assert.strictEqual(typeof deepSeekBody.messages[0].content, 'string');

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
      return jsonResponse({
        content: [{ type: 'text', text: 'anthropic vision ok' }],
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
    assert.strictEqual(anthropicConnectionBody.messages[0].content[0].source.media_type, 'image/jpeg');
    assert(Buffer.from(
      anthropicConnectionBody.messages[0].content[0].source.data,
      'base64',
    ).length > 2000);

    calls.length = 0;
    global.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        candidates: [
          {
            content: {
              parts: [{ text: 'google vision ok' }],
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
      model: 'gemini-3.5-flash',
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
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
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
    assert.strictEqual(googleConnectionBody.contents[0].parts[0].inline_data.mime_type, 'image/jpeg');
    assert(Buffer.from(
      googleConnectionBody.contents[0].parts[0].inline_data.data,
      'base64',
    ).length > 2000);

    const failureClient = new LLMClient({
      provider: 'openai',
      apiKey: 'sk-never-log-this',
      model: 'gpt-5.5',
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
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
