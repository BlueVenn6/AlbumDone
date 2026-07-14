const assert = require('assert');
const fs = require('fs');
const path = require('path');

const mobileRoot = path.resolve(__dirname, '..');
const settings = fs.readFileSync(path.join(mobileRoot, 'src/screens/SettingsScreen.tsx'), 'utf8');
const card = fs.readFileSync(path.join(mobileRoot, 'src/components/ApiConfigCard.tsx'), 'utf8');
const runtime = fs.readFileSync(path.join(mobileRoot, 'src/utils/runtimeProviderConfig.ts'), 'utf8');
const screenshots = fs.readFileSync(path.join(mobileRoot, 'src/screens/ScreenshotScreen.tsx'), 'utf8');

assert(settings.includes('new LLMClient(config)'), 'Connection tests must use the shared LLM client.');
assert(card.indexOf('await handleSave()') < card.indexOf('await onTest(testConfig)'));
assert(runtime.includes('getStoredApiKey(config.provider)'), 'Runtime calls must load the same secure key saved by Settings.');
assert(runtime.includes('new LLMClient(runtimeConfig)'), 'Runtime calls must use the shared LLM client.');
assert(screenshots.includes('createRuntimeLLMClient(activeVisionRoute?.config)'));
assert(card.includes("provider === 'qwen' || provider === 'custom'"));

console.log('mobile model settings and runtime parity tests passed');
