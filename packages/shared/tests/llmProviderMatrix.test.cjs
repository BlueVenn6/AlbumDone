const assert = require('assert');

const { LLMClient } = require('../dist');
const { PROVIDER_MODELS, modelSupportsVision } = require('../dist/types');

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

function successBody(url, text = 'ok') {
  if (url.endsWith('/responses')) {
    return { output_text: text };
  }
  if (url.endsWith('/messages')) {
    return { content: [{ type: 'text', text }] };
  }
  if (url.includes(':generateContent')) {
    return { candidates: [{ content: { parts: [{ text }] } }] };
  }
  return { choices: [{ message: { content: text } }] };
}

function expectedProtocol(provider) {
  if (provider === 'openai') return '/responses';
  if (provider === 'anthropic') return '/messages';
  if (provider === 'google') return ':generateContent';
  return '/chat/completions';
}

(async () => {
  let testedModels = 0;

  for (const [provider, metadata] of Object.entries(PROVIDER_MODELS)) {
    for (const model of metadata.models) {
      const calls = [];
      let reply = 'ok';
      const client = new LLMClient({
        provider,
        apiKey: `matrix-key-${provider}`,
        model,
        supportsVision: metadata.supportsVision,
        mode: 'direct',
      }, async (url, init, timeoutMs) => {
        calls.push({ url, init, timeoutMs });
        return response(200, successBody(url, reply));
      });

      const result = await client.testConnection();
      assert.deepStrictEqual(result, {
        success: true,
        mode: modelSupportsVision(provider, model) ? 'vision' : 'text',
      }, `${provider}/${model} connection probe failed`);
      assert.strictEqual(calls.length, 1, `${provider}/${model} made an unexpected number of requests`);

      const request = calls[0];
      assert(request.url.includes(expectedProtocol(provider)), `${provider}/${model} used the wrong protocol: ${request.url}`);
      const body = JSON.parse(request.init.body);
      if (provider === 'google') {
        assert(request.url.includes(encodeURIComponent(model)), `${provider}/${model} was missing from the endpoint`);
      } else {
        assert.strictEqual(body.model, model, `${provider}/${model} was missing from the request body`);
      }

      for (const invalidReply of ['Invalid API key', 'I cannot read images.', 'not ok', '<html>OK</html>']) {
        reply = invalidReply;
        const rejected = await client.testConnection();
        assert.strictEqual(rejected.success, false, `${provider}/${model} accepted ${invalidReply}`);
        assert.strictEqual(rejected.category, 'invalid_response');
        assert(!rejected.error.includes(`matrix-key-${provider}`));
      }
      testedModels += 1;
    }
  }

  const probeConfig = {
    provider: 'custom', apiKey: 'probe-test-key', model: 'text-model',
    baseUrl: 'https://example.test/v1', supportsVision: false, mode: 'direct',
  };
  for (const reply of ['ok', ' OK. ', 'ok。', '```text\nok\n```']) {
    const client = new LLMClient(probeConfig, async (url) => response(200, successBody(url, reply)));
    assert.strictEqual((await client.testConnection()).success, true, `Valid acknowledgement rejected: ${reply}`);
  }
  const emptyClient = new LLMClient(probeConfig, async (url) => response(200, successBody(url, '')));
  assert.strictEqual((await emptyClient.testConnection()).success, false, 'An empty response must fail');

  assert.strictEqual(testedModels, Object.values(PROVIDER_MODELS).reduce((count, metadata) => count + metadata.models.length, 0));
  assert(testedModels > 0, 'The configured model catalog must not be empty');
  console.log(`LLM provider/model protocol matrix passed (${testedModels} models)`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
