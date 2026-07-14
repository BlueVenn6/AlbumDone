const assert = require('assert');
const { getMobileEndpointRisk } = require('../dist/mobile/src/utils/mobileEndpointPolicy');

for (const url of [
  'http://localhost:3000/v1',
  'https://127.0.0.1/v1',
  'https://[::1]/v1',
  'https://192.168.1.5/v1',
  'https://10.0.0.8/v1',
  'https://172.16.0.8/v1',
  'https://model-server.local/v1',
  'https://host.docker.internal/v1',
  'https://nas/v1',
  'https://169.254.1.2/v1',
  'https://100.64.0.2/v1',
]) {
  assert.strictEqual(getMobileEndpointRisk(url)?.level, 'blocked', `${url} must be blocked`);
}

assert.strictEqual(getMobileEndpointRisk('http://cloud.example.com/v1')?.level, 'blocked');
assert.strictEqual(getMobileEndpointRisk('https://cloud.example.com/v1'), null);
assert.strictEqual(getMobileEndpointRisk('https://api.openai.com/v1'), null);
assert.strictEqual(getMobileEndpointRisk('', 'openai'), null);
assert.strictEqual(getMobileEndpointRisk('', 'custom')?.level, 'blocked');
assert.strictEqual(getMobileEndpointRisk('', 'qwen')?.level, 'blocked');
assert.strictEqual(
  getMobileEndpointRisk('https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'),
  null,
);
assert.strictEqual(
  getMobileEndpointRisk('https://cloud.example.com/v1?api_key=secret')?.level,
  'blocked',
);
assert.strictEqual(getMobileEndpointRisk('https://secret@cloud.example.com/v1')?.level, 'blocked');

console.log('mobile cloud-only endpoint policy tests passed');
