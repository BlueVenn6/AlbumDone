const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');

const listen = (server, port) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '0.0.0.0', resolve);
});
const close = (server) => new Promise((resolve) => server.close(resolve));

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'albumdone-lan-test-'));
  const blockers = [];
  let lan;
  const originalLoad = Module._load;
  try {
    // Find two available adjacent ports, then exercise the actual HTTP listeners.
    let port;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const first = http.createServer();
      await listen(first, 0);
      const candidate = first.address().port;
      const second = http.createServer();
      try {
        if (candidate === 65535) throw new Error('No adjacent port');
        await listen(second, candidate + 1);
        port = candidate;
        blockers.push(first, second);
        break;
      } catch {
        await close(first);
        await close(second);
      }
    }
    assert(port, 'Could not reserve adjacent test ports');
    process.env.ALBUMDONE_LAN_SERVER_PORT = String(port);
    Module._load = function (request, parent, isMain) {
      if (request === 'electron') return { app: { getPath: () => root } };
      return originalLoad.call(this, request, parent, isMain);
    };
    lan = require('../dist/main/lanServer');
    Module._load = originalLoad;
    const startedAt = Date.now();
    await assert.rejects(lan.startLanServer(), { code: 'EADDRINUSE' });
    assert(Date.now() - startedAt < 3000, 'Both occupied ports must fail promptly');
    assert.equal(lan.getLanServerUrl(), null);

    await close(blockers.pop());
    const [fallback, concurrent] = await Promise.all([lan.startLanServer(), lan.startLanServer()]);
    assert.deepEqual(fallback, concurrent);
    assert.equal(fallback.port, port + 1);
    assert.equal(new URL(fallback.url).port, String(port + 1));
    lan.setPhotoDataSource({
      getPhotos: async () => [{ id: 'synthetic', filename: 'test.jpg', uri: 'test', albumId: 'test', timestamp: 1 }],
      getThumbnail: async () => Buffer.from('thumbnail'),
      getFullImage: async () => Buffer.from('full'),
    });
    const origin = `http://127.0.0.1:${fallback.port}`;
    assert.equal((await fetch(`${origin}/health`)).status, 200);
    assert.equal((await fetch(`${origin}/photos`)).status, 401);
    assert.equal((await fetch(`${origin}/photos?token=wrong`)).status, 401);
    const photos = await fetch(`${origin}/photos`, { headers: { authorization: `Bearer ${fallback.token}` } });
    assert.equal(photos.status, 200);
    assert.equal((await photos.json()).total, 1);
    const thumbnail = await fetch(`${origin}/photo/synthetic/thumbnail?token=${fallback.token}`);
    assert.equal(await thumbnail.text(), 'thumbnail');
    await lan.stopLanServer();
    await close(blockers.pop());
    const normal = await lan.startLanServer();
    assert.equal(normal.port, port);
    assert.notEqual(normal.token, fallback.token);
    await lan.stopLanServer();
    const logs = fs.readFileSync(path.join(root, 'logs', `photo-manager-${new Date().toISOString().slice(0, 10)}.log`), 'utf8');
    assert(!logs.includes(fallback.token) && !logs.includes(normal.token), 'Logs must redact session tokens');

    for (const invalid of ['1.5', '65536', '-1', 'NaN']) {
      const value = execFileSync(process.execPath, ['-e', 'process.stdout.write(String(require("./dist/main/ports").DESKTOP_PORTS.renderer))'], {
        cwd: path.resolve(__dirname, '..'), env: { ...process.env, ALBUMDONE_DESKTOP_RENDERER_PORT: invalid }, encoding: 'utf8',
      });
      assert.equal(value, '5173');
    }
    console.log('LAN occupied-port, concurrent-start, authentication and port validation tests passed');
  } finally {
    Module._load = originalLoad;
    if (lan) await lan.stopLanServer();
    for (const server of blockers) await close(server);
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
