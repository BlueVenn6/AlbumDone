const assert = require('node:assert/strict');

const customInstruction = { id: 'saved-prompt', name: 'My prompt', prompt: 'Describe the photo', createdAt: 1 };
const values = new Map([['photo-manager-settings', JSON.stringify({ version: 1, state: {
  providers: {
    anthropic: { provider: 'anthropic', model: 'claude-3-7-sonnet-20250219', hasApiKey: true, supportsVision: true, mode: 'direct' },
    custom: { provider: 'custom', model: 'gpt-4o', hasApiKey: true, supportsVision: true, mode: 'proxy', baseUrl: 'https://example.test/v1' },
  },
  defaultVisionProvider: 'custom', defaultTextProvider: 'anthropic',
  trashRetentionDays: 7, customInstructions: [customInstruction], ocrLanguage: 'eng',
}})]]);

// React Native installs AsyncStorage before importing the shared store. Exercise
// actual asynchronous hydration, including the same persisted schema version.
global.localStorage = {
  getItem: async key => {
    await new Promise(resolve => setTimeout(resolve, 10));
    return values.get(key) ?? null;
  },
  setItem: async (key, value) => { values.set(key, value); },
  removeItem: async key => { values.delete(key); },
};

(async () => {
  const { useSettingsStore } = require('../dist/store/settingsStore');
  if (!useSettingsStore.persist.hasHydrated()) {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { unsubscribe(); reject(new Error('Settings hydration did not finish.')); }, 10000);
      const unsubscribe = useSettingsStore.persist.onFinishHydration(() => { clearTimeout(timeout); unsubscribe(); resolve(); });
    });
  }
  const state = useSettingsStore.getState();
  assert.equal(state.providers.anthropic.model, 'claude-3-7-sonnet-20250219');
  assert.equal(state.providers.anthropic.hasApiKey, true);
  assert.deepEqual(state.providers.custom, {
    provider: 'custom', model: 'gpt-4o', hasApiKey: true, supportsVision: true, mode: 'proxy', baseUrl: 'https://example.test/v1',
  });
  assert.equal(state.defaultVisionProvider, 'custom');
  assert.equal(state.defaultTextProvider, 'anthropic');
  assert.equal(state.trashRetentionDays, 7);
  assert.equal(state.ocrLanguage, 'eng');
  assert.deepEqual(state.customInstructions, [customInstruction]);
  state.updateProvider('custom', { ...state.providers.custom, apiKey: 'synthetic-runtime-key' });
  assert.equal(useSettingsStore.getState().providers.custom.apiKey, 'synthetic-runtime-key');
  const persisted = JSON.parse(values.get('photo-manager-settings'));
  assert.equal(persisted.state.providers.custom.hasApiKey, true);
  assert(!Object.hasOwn(persisted.state.providers.custom, 'apiKey'), 'A runtime credential must not enter settings storage.');
  console.log('Asynchronous same-version settings hydration, saved configuration and credential separation passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
