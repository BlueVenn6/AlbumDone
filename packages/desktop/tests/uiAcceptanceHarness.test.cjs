const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { WebSocketServer } = require('ws');

(async () => {
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify([{
      type: 'page', title: 'AlbumDone',
      webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}/devtools/page/test`,
    }]));
  });
  const sockets = new WebSocketServer({ server });
  sockets.on('connection', (socket) => {
    socket.once('message', () => socket.close());
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const script of ['cdp-pre-release-smoke.cjs', 'cdp-culling-performance.cjs', 'cdp-dedup-progress-smoke.cjs',
      'cdp-ai-workflow.cjs', 'cdp-settings-migration.cjs', 'cdp-custom-endpoint.cjs']) {
      const child = spawn(process.execPath, [
        path.join(__dirname, '../scripts', script),
        String(server.address().port), os.tmpdir(), os.tmpdir(),
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      const timeout = setTimeout(() => child.kill(), 120000);
      const code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      }).finally(() => clearTimeout(timeout));
      assert.equal(code, 1, `An interrupted UI check must fail, received ${code}: ${stderr}`);
      assert.match(stderr, /closed before UI acceptance completed/);
      assert.equal(stdout.trim(), '', 'An interrupted check must not emit a success result.');
      console.log(`${script}: interrupted UI acceptance correctly exits with failure and no success result`);
    }
  } finally {
    for (const socket of sockets.clients) socket.terminate();
    await new Promise((resolve) => sockets.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
