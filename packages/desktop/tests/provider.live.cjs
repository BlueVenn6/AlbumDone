const { _electron: electron } = require('playwright-core');

async function main() {
  let electronApp;
  try {
    const electronPath = require('electron');
    const env = { ...process.env, NODE_ENV: 'production' };
    delete env.ELECTRON_RUN_AS_NODE;
    electronApp = await electron.launch({
      executablePath: electronPath,
      args: ['.'],
      cwd: require('node:path').resolve(__dirname, '..'),
      env,
      timeout: 30000,
    });
    const page = await electronApp.firstWindow({ timeout: 30000 });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => Boolean(window.electronAPI));

    const results = await page.evaluate(async ({ qwenBaseUrl, providerFilter }) => {
      const raw = localStorage.getItem('photo-manager-settings');
      const state = raw ? JSON.parse(raw).state : null;
      const providers = state?.providers ?? {};
      const output = [];
      for (const [provider, stored] of Object.entries(providers)) {
        if (providerFilter && provider !== providerFilter) continue;
        if (!stored?.hasApiKey) continue;
        const config = {
          provider,
          model: stored.model,
          mode: stored.mode ?? 'direct',
          supportsVision: Boolean(stored.supportsVision),
          ...(stored.baseUrl ? { baseUrl: stored.baseUrl } : {}),
        };
        if (provider === 'qwen' && !config.baseUrl && qwenBaseUrl) {
          config.baseUrl = qwenBaseUrl;
        }
        const result = await window.electronAPI.llm.testConnection(config);
        output.push({
          provider,
          model: config.model,
          mode: config.mode,
          hasBaseUrl: Boolean(config.baseUrl),
          ...result,
        });
        if (provider === 'anthropic' && config.mode === 'proxy' && !result.success) {
          const nativeResult = await window.electronAPI.llm.testConnection({
            ...config,
            mode: 'direct',
          });
          output.push({
            provider: 'anthropic-native-diagnostic',
            model: config.model,
            mode: 'direct',
            hasBaseUrl: Boolean(config.baseUrl),
            ...nativeResult,
          });
        }
      }
      return output;
    }, {
      qwenBaseUrl: process.env.ALBUMDONE_QWEN_BASE_URL || '',
      providerFilter: process.env.ALBUMDONE_PROVIDER_FILTER || '',
    });

    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    if (results.length === 0 || results.some((result) => !result.success)) {
      process.exitCode = 1;
    }
  } finally {
    await electronApp?.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
