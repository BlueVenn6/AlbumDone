const assert = require('assert');
const {
  formatProviderRouteLabel,
  modelSupportsVision,
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
      model: 'deepseek-chat',
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
  assert.strictEqual(modelSupportsVision('google', 'gemini-2.5-flash'), true);

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
