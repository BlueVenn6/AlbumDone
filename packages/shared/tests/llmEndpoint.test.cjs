const assert = require('assert');
const {
  buildAnthropicMessagesUrl,
  buildGoogleGenerateContentUrl,
  buildOpenAIChatCompletionsUrl,
  buildOpenAIResponsesUrl,
  classifyLLMError,
  normalizeProviderBaseUrl,
} = require('../dist/api/llmEndpoint');

assert.strictEqual(
  buildOpenAIChatCompletionsUrl('https://api.example.com'),
  'https://api.example.com/v1/chat/completions',
);
assert.strictEqual(
  buildOpenAIChatCompletionsUrl('https://api.example.com/v1/'),
  'https://api.example.com/v1/chat/completions',
);
assert.strictEqual(
  buildOpenAIChatCompletionsUrl('https://api.example.com/v1/chat/completions/'),
  'https://api.example.com/v1/chat/completions',
);
assert.strictEqual(
  buildOpenAIChatCompletionsUrl('https://dashscope.aliyuncs.com/compatible-mode/v1'),
  'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
);
assert.strictEqual(
  buildOpenAIChatCompletionsUrl(undefined, 'https://api.moonshot.cn/v1'),
  'https://api.moonshot.cn/v1/chat/completions',
);
assert.strictEqual(
  buildOpenAIChatCompletionsUrl('https://api.example.com/v1?trace=1'),
  'https://api.example.com/v1/chat/completions?trace=1',
);
assert.strictEqual(
  buildOpenAIChatCompletionsUrl('https://api.example.com/v1/chat/completions?trace=1'),
  'https://api.example.com/v1/chat/completions?trace=1',
);
assert.strictEqual(
  buildOpenAIResponsesUrl('https://api.example.com'),
  'https://api.example.com/v1/responses',
);
assert.strictEqual(
  buildOpenAIResponsesUrl('https://api.example.com/v1/'),
  'https://api.example.com/v1/responses',
);
assert.strictEqual(
  buildOpenAIResponsesUrl('https://api.example.com/v1/responses/'),
  'https://api.example.com/v1/responses',
);
assert.strictEqual(
  buildOpenAIResponsesUrl('https://api.example.com/v1/chat/completions?trace=1'),
  'https://api.example.com/v1/responses?trace=1',
);
assert.strictEqual(
  normalizeProviderBaseUrl('https://api.example.com/v1///', 'https://fallback.example.com/v1'),
  'https://api.example.com/v1',
);
assert.strictEqual(
  buildAnthropicMessagesUrl('https://api.anthropic.com'),
  'https://api.anthropic.com/v1/messages',
);
assert.strictEqual(
  buildAnthropicMessagesUrl('https://api.anthropic.com/v1/messages'),
  'https://api.anthropic.com/v1/messages',
);
assert.strictEqual(
  buildAnthropicMessagesUrl('https://api.anthropic.com/v1?beta=1'),
  'https://api.anthropic.com/v1/messages?beta=1',
);
assert.strictEqual(
  buildGoogleGenerateContentUrl(
    'https://generativelanguage.googleapis.com/v1beta',
    'gemini-2.5-flash',
    'secret-key',
  ),
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
);
assert.strictEqual(
  buildGoogleGenerateContentUrl(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?alt=sse',
    'gemini-1.5-flash',
    'secret-key',
  ),
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?alt=sse',
);

assert.deepStrictEqual(
  classifyLLMError({ status: 401, body: 'invalid_api_key', apiKey: 'secret-key' }).category,
  'api_key',
);
assert.deepStrictEqual(
  classifyLLMError({ status: 403, body: 'permission denied' }).category,
  'permission',
);
assert.deepStrictEqual(
  classifyLLMError({ status: 404, body: 'model does not exist' }).category,
  'model_not_found',
);
assert.deepStrictEqual(
  classifyLLMError({
    status: 400,
    body: 'The image length and width do not meet the model restrictions.',
  }).category,
  'request_format',
);
assert.match(
  classifyLLMError({
    status: 400,
    body: JSON.stringify({ error: { message: 'Unsupported image option: detail' } }),
  }).message,
  /Unsupported image option: detail/,
);
assert.deepStrictEqual(
  classifyLLMError({ status: 429, body: 'rate limit' }).category,
  'rate_limited',
);
assert.deepStrictEqual(
  classifyLLMError({ status: 500, body: 'internal server error' }).category,
  'server',
);
assert.deepStrictEqual(
  classifyLLMError({ status: 503, body: 'bad gateway', mode: 'proxy' }).category,
  'proxy',
);
assert.deepStrictEqual(
  classifyLLMError({ error: new Error('Request Timeout') }).category,
  'timeout',
);
assert.deepStrictEqual(
  classifyLLMError({ error: new Error('Request was cancelled by user.') }).category,
  'cancelled',
);
assert.deepStrictEqual(
  classifyLLMError({ error: new Error('fetch failed') }).category,
  'base_url',
);
assert.deepStrictEqual(
  classifyLLMError({
    error: new Error('OpenAI-compatible response has no choices'),
    mode: 'proxy',
  }).category,
  'empty_response',
);
assert.throws(
  () => buildOpenAIChatCompletionsUrl('not a url'),
  /Base URL is invalid/,
);
assert.ok(!classifyLLMError({
  status: 401,
  body: 'Bearer secret-key',
  apiKey: 'secret-key',
}).message.includes('secret-key'));

console.log('llmEndpoint tests passed');
