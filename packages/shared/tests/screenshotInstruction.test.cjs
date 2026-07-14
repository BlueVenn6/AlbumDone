const assert = require('assert');
const { executeInstruction } = require('../dist/api/vision');

(async () => {
  const calls = [];
  const fakeClient = {
    async chatWithImage(prompt, imageBase64, mimeType, options) {
      calls.push({ prompt, imageBase64, mimeType, options });
      return { content: 'extracted screenshot text' };
    },
  };

  const result = await executeInstruction(
    'ZmFrZS1pbWFnZQ==',
    'image/png',
    'extract all visible text',
    fakeClient,
    'en',
  );

  assert.strictEqual(result, 'extracted screenshot text');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].imageBase64, 'ZmFrZS1pbWFnZQ==');
  assert.strictEqual(calls[0].mimeType, 'image/png');
  assert.match(calls[0].prompt, /extract all visible text/i);
  assert.match(calls[0].prompt, /respond in English/i);
  assert.strictEqual(calls[0].options.temperature, 0.3);
  assert.strictEqual(calls[0].options.maxTokens, 1024);

  console.log('screenshot instruction tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
