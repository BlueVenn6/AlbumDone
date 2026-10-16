const assert = require('assert');
const {
  formatProviderRouteLabel,
  modelSupportsVision,
  normalizeProviderModel,
  getConfiguredProviders,
  resolveProviderRoute,
} = require('../dist/types/llm');

(() => {
  const providers = {
    moonshot: {
      provider: 'moonshot',
      model: 'kimi-k2.5',
      hasApiKey: true,
      supportsVision: true,
      mode: 'direct',
    },
    deepseek: {
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      hasApiKey: true,
      supportsVision: false,
      mode: 'direct',
    },
  };

  const visionProviders = getConfiguredProviders(providers, { requiresVision: true });
  assert.deepStrictEqual(visionProviders, ['moonshot']);

  const route = resolveProviderRoute(
    providers,
    { defaultTextProvider: 'deepseek' },
    { requiresVision: true },
  );

  assert(route);
  assert.strictEqual(route.provider, 'moonshot');
  assert.strictEqual(route.config.model, 'kimi-k2.5');
  assert.strictEqual(formatProviderRouteLabel(route), 'Moonshot (Kimi) · kimi-k2.5');
  assert.strictEqual(modelSupportsVision('openai', 'gpt-4.1'), true);
  assert.strictEqual(
    normalizeProviderModel('minimax', 'MiniMax-VL-01'),
    'MiniMax-M3',
  );
  const migratedMiniMaxRoute = resolveProviderRoute(
    {
      minimax: {
        provider: 'minimax',
        model: 'MiniMax-VL-01',
        hasApiKey: true,
        supportsVision: true,
        mode: 'direct',
      },
    },
    { defaultVisionProvider: 'minimax' },
    { requiresVision: true },
  );
  assert(migratedMiniMaxRoute, 'A migrated vision model must remain available without a separate image test.');
  assert.strictEqual(migratedMiniMaxRoute.config.model, 'MiniMax-M3');
  assert.strictEqual(modelSupportsVision('google', 'gemini-2.5-flash'), true);
  assert.strictEqual(
    normalizeProviderModel('google', 'gemini-3.5-flash'),
    'gemini-2.5-flash',
  );
  assert.strictEqual(
    normalizeProviderModel('google', 'gemini-3.1-flash-image'),
    'gemini-2.5-flash',
  );
  assert.strictEqual(
    normalizeProviderModel('deepseek', 'deepseek-chat'),
    'deepseek-flash',
  );
  assert.strictEqual(
    normalizeProviderModel('deepseek', 'deepseek-reasoner'),
    'deepseek-v4-pro',
  );

  for (const oldModel of ['deepseek-chat', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']) {
    assert.strictEqual(normalizeProviderModel('deepseek', oldModel), 'deepseek-flash');
    assert.strictEqual(modelSupportsVision('deepseek', oldModel), true);
    const migrated = resolveProviderRoute({ deepseek: { ...providers.deepseek, model: oldModel } }, {}, { requiresVision: true });
    assert(migrated, 'A migrated vision model must not be blocked by a removed image-test gate.');
  }
  assert.strictEqual(modelSupportsVision('deepseek', 'deepseek-v4-pro'), false);
  const deepseekOnly = resolveProviderRoute(
    { deepseek: providers.deepseek },
    { defaultTextProvider: 'deepseek' },
    { requiresVision: true },
  );
  assert.strictEqual(deepseekOnly, null);

  const proxyRoute = resolveProviderRoute(
    {
      custom: {
        provider: 'custom',
        model: 'gpt-4o',
        hasApiKey: true,
        supportsVision: true,
        mode: 'proxy',
      },
    },
    {},
    { requiresVision: true },
  );
  assert(proxyRoute);
  assert.strictEqual(proxyRoute.provider, 'custom');

  const textOnlyProxyRoute = resolveProviderRoute(
    {
      moonshot: {
        provider: 'moonshot',
        model: 'moonshot-v1-8k',
        hasApiKey: true,
        supportsVision: true,
        mode: 'proxy',
      },
    },
    {},
    { requiresVision: true },
  );
  assert.strictEqual(textOnlyProxyRoute, null);

  const storedKeyOnlyProviders = {
    moonshot: {
      provider: 'moonshot',
      model: 'kimi-k2.5',
      supportsVision: true,
      mode: 'direct',
    },
  };
  assert.deepStrictEqual(
    getConfiguredProviders(storedKeyOnlyProviders, {
      requiresVision: true,
      allowMissingApiKey: true,
    }),
    ['moonshot'],
  );
  assert.strictEqual(
    resolveProviderRoute(storedKeyOnlyProviders, {}, { requiresVision: true }),
    null,
  );

  console.log('provider route tests passed');
})();
