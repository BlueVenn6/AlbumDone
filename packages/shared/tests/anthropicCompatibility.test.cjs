const assert = require('node:assert/strict');
const persistedSettings = new Map([['photo-manager-settings', JSON.stringify({ version: 1, state: {
  providers: { anthropic: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', hasApiKey: true, supportsVision: true, mode: 'direct' } },
  defaultVisionProvider: 'anthropic', defaultTextProvider: 'anthropic',
}})]]);
global.localStorage = {
  getItem: key => persistedSettings.get(key) ?? null,
  setItem: (key, value) => persistedSettings.set(key, value),
  removeItem: key => persistedSettings.delete(key),
};
const { LLMClient } = require('../dist');
const { PROVIDER_MODELS, normalizeProviderModel } = require('../dist/types');

(async () => {
  for (const model of ['claude-opus-4-7', 'claude-opus-4-8', 'claude-sonnet-5',
    'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5']) {
    const client = new LLMClient({ provider: 'anthropic', model, apiKey: 'local-compatibility-key', supportsVision: true },
      async (_url, request) => {
        const body = JSON.parse(request.body);
        assert(!Object.hasOwn(body, 'temperature'), `${model} will reject the unsupported sampling parameter with HTTP 400`);
        assert.equal(body.model, model);
        return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'known test result' }] }) };
      });
    assert.equal((await client.chatWithImage('Describe this test image', 'dGVzdA==', 'image/png', { temperature: 0.3 })).content, 'known test result');
  }
  const legacy = new LLMClient({ provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'local-compatibility-key', supportsVision: true },
    async (_url, request) => {
      assert.equal(JSON.parse(request.body).temperature, 0.3, 'Do not change sampling on models that support it.');
      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) };
    });
  await legacy.chat([{ role: 'user', content: 'test' }], { temperature: 0.3 });
  for (const model of ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5']) assert(PROVIDER_MODELS.anthropic.models.includes(model));
  assert(PROVIDER_MODELS.qwen.models.includes('qwen3.8-max'));
  assert.equal(normalizeProviderModel('anthropic', 'claude-3-5-sonnet-20241022'), 'claude-sonnet-5-5');
  assert.equal(normalizeProviderModel('anthropic', 'claude-3-7-sonnet-20250219'), 'claude-sonnet-5-5');
  assert.equal(normalizeProviderModel('anthropic', 'claude-opus-4-1-20250805'), 'claude-opus-4-8');
  assert.equal(normalizeProviderModel('anthropic', 'claude-3-5-haiku-20241022'), 'claude-haiku-4-5-20251001');
  assert.equal(normalizeProviderModel('anthropic', 'claude-sonnet-5'), 'claude-sonnet-5', 'An active saved model must remain selected.');
  assert.equal(normalizeProviderModel('custom', 'claude-3-5-sonnet-20241022'), 'claude-3-5-sonnet-20241022', 'Do not migrate proxy-owned custom model IDs.');
  const { useSettingsStore } = require('../dist/store/settingsStore');
  assert.equal(useSettingsStore.getState().providers.anthropic.model, 'claude-sonnet-5-5', 'An existing persisted configuration was not migrated.');
  assert.equal(useSettingsStore.getState().defaultVisionProvider, 'anthropic');
  useSettingsStore.getState().updateProvider('anthropic', { provider: 'anthropic', model: 'claude-sonnet-5', hasApiKey: true, supportsVision: true });
  assert.equal(useSettingsStore.getState().providers.anthropic.model, 'claude-sonnet-5', 'Do not override a saved active configuration.');
  console.log('Anthropic sampling restrictions, active catalog, retired-model migration and preserved saved models passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
