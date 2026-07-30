const assert = require('assert');

const persisted = JSON.stringify({
  state: {
    providers: {
      minimax: {
        provider: 'minimax',
        model: 'MiniMax-VL-01',
        hasApiKey: true,
        mode: 'direct',
        supportsVision: true,
      },
      google: {
        provider: 'google',
        model: 'gemini-3.5-flash',
        hasApiKey: true,
        mode: 'direct',
        supportsVision: true,
      },
    },
    defaultVisionProvider: 'minimax',
    defaultTextProvider: 'minimax',
    trashRetentionDays: 7,
    customInstructions: [],
    ocrLanguage: 'chi_sim+eng',
  },
  version: 0,
});

global.localStorage = {
  getItem: (name) => name === 'photo-manager-settings' ? persisted : null,
  setItem: () => {},
  removeItem: () => {},
};

const { useSettingsStore } = require('../dist/store/settingsStore');
const state = useSettingsStore.getState();

assert.strictEqual(state.providers.minimax.model, 'MiniMax-M3');
assert.strictEqual(state.providers.google.model, 'gemini-2.5-flash');
assert.strictEqual(state.defaultVisionProvider, 'minimax');
assert.strictEqual(state.defaultTextProvider, 'minimax');

console.log('settings persistence migration tests passed');
