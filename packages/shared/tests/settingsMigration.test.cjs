const assert = require('assert');
const storageEntries = new Map();
global.localStorage = {
  getItem: (key) => storageEntries.get(key) ?? null,
  setItem: (key, value) => storageEntries.set(key, value),
  removeItem: (key) => storageEntries.delete(key),
  clear: () => storageEntries.clear(),
};

const storage = global.localStorage;

storage.setItem('photo-manager-settings', JSON.stringify({
  state: {
    providers: {
      minimax: {
        provider: 'minimax',
        model: 'MiniMax-VL-01',
        hasApiKey: true,
        supportsVision: true,
        mode: 'direct',
      },
    },
    defaultVisionProvider: 'minimax',
    defaultTextProvider: 'minimax',
  },
  version: 0,
}));

const { useSettingsStore } = require('../dist/store/settingsStore');

(async () => {
  await useSettingsStore.persist.rehydrate();
  const state = useSettingsStore.getState();
  assert.strictEqual(state.providers.minimax.model, 'MiniMax-M3');
  assert.strictEqual(state.defaultVisionProvider, 'minimax');
  assert.strictEqual(state.defaultTextProvider, 'minimax');

  const persisted = JSON.parse(storage.getItem('photo-manager-settings'));
  assert.strictEqual(persisted.state.providers.minimax.model, 'MiniMax-M3');
  assert.strictEqual(persisted.state.providers.minimax.apiKey, undefined);

  console.log('settings persistence migration tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
