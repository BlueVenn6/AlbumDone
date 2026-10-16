const assert = require('node:assert/strict');

const storedValues = new Map();
global.localStorage = {
  getItem: key => storedValues.get(key) ?? null,
  setItem: (key, value) => storedValues.set(key, value),
  removeItem: key => storedValues.delete(key),
};

const { LLMClient, resolveLLMEndpoint, useSettingsStore } = require('../dist');
const { configSupportsVision } = require('../dist/types');
const CONNECTION_TEST_IMAGE_MARKER = 'iVBORw0KGgo';

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

(async () => {
  const config = {
    provider: 'custom',
    mode: 'proxy',
    model: 'customer-model-alias',
    baseUrl: 'https://example.test/v1',
    apiKey: 'synthetic-test-key',
    supportsVision: true,
  };
  const calls = [];
  const transport = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body });
    const serialized = JSON.stringify(body);
    const text = serialized.includes('dominant color')
      ? 'red'
      : serialized.includes('AA==')
        ? 'photo-result'
        : 'ok';
    return response(200, { choices: [{ message: { content: text } }] });
  };

  assert.equal(resolveLLMEndpoint(config).protocol, 'chat_completions');
  assert.equal(configSupportsVision(config), true);

  const client = new LLMClient(config, transport);
  assert.equal((await client.testConnection()).success, true);
  assert.deepEqual(calls.map(call => new URL(call.url).pathname), [
    '/v1/chat/completions',
  ]);
  for (const call of calls) {
    assert(JSON.stringify(call.body).includes('dominant color'), 'Connection test must verify that the model receives an image.');
    assert(JSON.stringify(call.body).includes(CONNECTION_TEST_IMAGE_MARKER), 'Connection test image bytes were dropped.');
    assert.equal(call.headers.Authorization, `Bearer ${config.apiKey}`);
  }

  useSettingsStore.getState().updateProvider('custom', {
    ...config,
    protocol: 'chat_completions',
  });
  const saved = JSON.parse(storedValues.get('photo-manager-settings')).state.providers.custom;
  assert(!Object.hasOwn(saved, 'protocol'), 'Retired protocol state must not survive persistence.');
  assert.equal(saved.mode, 'proxy');
  assert.equal(saved.model, 'customer-model-alias');
  assert(!Object.hasOwn(saved, 'connectionTests'));
  assert(!Object.hasOwn(saved, 'apiKey'), 'Settings persistence must never store the API key.');

  await useSettingsStore.persist.rehydrate();
  const hydrated = useSettingsStore.getState().providers.custom;
  assert.equal(configSupportsVision(hydrated), true);
  assert(!Object.hasOwn(hydrated, 'protocol'));

  calls.length = 0;
  const result = await new LLMClient(config, transport).chatWithImage(
    'Describe this image',
    'AA==',
    'image/png',
  );
  assert.equal(result.content, 'photo-result');
  assert.deepEqual(calls.map(call => new URL(call.url).pathname), [
    '/v1/chat/completions',
  ]);
  for (const call of calls) {
    const body = JSON.stringify(call.body);
    assert(body.includes('AA=='), 'The runtime request must include the selected photo bytes.');
    assert(body.includes('Describe this image'), 'The runtime request must include the instruction.');
  }

  useSettingsStore.getState().updateProvider('custom', { ...config, model: 'changed-alias' });
  assert.equal(useSettingsStore.getState().providers.custom.model, 'changed-alias');
  assert.equal(useSettingsStore.getState().providers.custom.supportsVision, true);
  assert.equal(useSettingsStore.getState().defaultVisionProvider, 'custom');

  console.log('Custom endpoint Chat Completions routing, legacy migration, arbitrary model aliases and runtime image routing passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
