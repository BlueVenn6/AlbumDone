const assert = require('node:assert/strict');
const storedValues = new Map();
global.localStorage = {
  getItem: key => storedValues.get(key) ?? null,
  setItem: (key, value) => storedValues.set(key, value),
  removeItem: key => storedValues.delete(key),
};
const { LLMClient, resolveLLMEndpoint, useSettingsStore } = require('../dist');
const { configSupportsVision, withConnectionTestResult } = require('../dist/types');

const protocols = {
  responses: { path: '/v1/responses', response: text => ({ output_text: text }) },
  chat_completions: { path: '/v1/chat/completions', response: text => ({ choices: [{ message: { content: text } }] }) },
  anthropic_messages: { path: '/v1/messages', response: text => ({ content: [{ type: 'text', text }] }) },
  google_generate_content: { path: '/v1beta/models/customer-alias:generateContent', response: text => ({ candidates: [{ content: { parts: [{ text }] } }] }) },
};

(async () => {
  for (const [protocol, fixture] of Object.entries(protocols)) {
    const config = { provider: 'custom', protocol, mode: 'proxy', model: 'customer-alias',
      baseUrl: `https://example.test/${protocol === 'google_generate_content' ? 'v1beta' : 'v1'}`,
      apiKey: 'synthetic-test-key', supportsVision: true };
    const calls = [];
    let reply = 'ok';
    let status = 200;
    const transport = async (url, init) => {
      calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      const body = status === 200 ? fixture.response(reply) : { error: { message: 'Unsupported request format' } };
      return { ok: status === 200, status, text: async () => JSON.stringify(body), json: async () => body };
    };
    assert.equal(resolveLLMEndpoint(config).protocol, protocol);
    const client = new LLMClient(config, transport);
    assert.equal(configSupportsVision(config), false, 'An untested custom alias must not be enabled for customer photos.');
    assert.equal((await client.testConnection('text')).success, true);
    assert.equal(new URL(calls.at(-1).url).pathname, fixture.path);
    assert(!JSON.stringify(calls.at(-1).body).includes('base64'), 'Text test unexpectedly sent an image.');
    reply = 'red';
    assert.equal((await client.testConnection('vision')).success, true, `${protocol} must test an arbitrary model alias with an image.`);
    const imageBody = JSON.stringify(calls.at(-1).body);
    assert(imageBody.includes('iVBORw0KGgoAAAANSUhEUgAAAEAAAABA'), 'Image test did not send the generated PNG data.');
    if (protocol === 'anthropic_messages') assert.equal(calls.at(-1).headers['x-api-key'], config.apiKey);
    if (protocol === 'google_generate_content') assert.equal(calls.at(-1).headers['x-goog-api-key'], config.apiKey);
    if (protocol === 'responses' || protocol === 'chat_completions') assert.equal(calls.at(-1).headers.Authorization, `Bearer ${config.apiKey}`);
    let verified = withConnectionTestResult(config, 'text', true);
    verified = withConnectionTestResult(verified, 'vision', true);
    assert.equal(configSupportsVision(verified), true);
    useSettingsStore.getState().updateProvider('custom', verified);
    const saved = JSON.parse(storedValues.get('photo-manager-settings')).state.providers.custom;
    assert.equal(saved.protocol, protocol);
    assert.equal(saved.model, 'customer-alias');
    assert.equal(saved.connectionTests.vision, true);
    assert(!Object.hasOwn(saved, 'apiKey'), 'Settings persistence must never store the API key.');
    await useSettingsStore.persist.rehydrate();
    assert.equal(configSupportsVision(useSettingsStore.getState().providers.custom), true);
    reply = 'photo-result';
    assert.equal((await new LLMClient(verified, transport).chatWithImage('Describe this image', 'AA==', 'image/png')).content, reply);
    assert.equal(new URL(calls.at(-1).url).pathname, fixture.path, 'Runtime must use the same explicit protocol as the test.');
    for (const change of [{ model: 'other-alias' }, { baseUrl: 'https://other.test/v1' }, { mode: 'direct' },
      { protocol: protocol === 'responses' ? 'chat_completions' : 'responses' }]) {
      assert.equal(configSupportsVision({ ...verified, ...change }), false, 'Changed configuration reused a stale successful image test.');
    }
    assert.equal(configSupportsVision(withConnectionTestResult(verified, 'vision', false)), false);
    useSettingsStore.getState().updateProvider('custom', { ...verified, model: 'changed-alias' });
    assert.equal(useSettingsStore.getState().providers.custom.supportsVision, false);
    assert.equal(useSettingsStore.getState().providers.custom.connectionTests, undefined);
    assert.equal(useSettingsStore.getState().defaultVisionProvider, null);
    reply = 'ok';
    assert.equal((await client.testConnection('vision')).success, false, 'A generic text response must not pass the image test.');
    status = 404;
    const before = calls.length;
    assert.equal((await client.testConnection('text')).success, false);
    assert.equal(calls.length, before + 1, 'An explicit protocol must not silently switch protocols.');
  }
  console.log('Custom endpoint: four explicit protocols, separate text/image probes, arbitrary aliases, runtime routing and stale result protection passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
