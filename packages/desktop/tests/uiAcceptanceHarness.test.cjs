const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { WebSocketServer } = require('ws');
(async () => {
  for (const closeAt of [1, 2, 0]) {
    const server = http.createServer((_request, response) => response.end(JSON.stringify([
      { type: 'page', title: 'Any translated title', webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}` },
    ])));
    const sockets = new WebSocketServer({ server });
    sockets.on('connection', socket => {
      let count = 0;
      socket.on('message', raw => {
        const message = JSON.parse(String(raw));
        if (++count === closeAt) { socket.close(); return; }
        socket.send(JSON.stringify({ id: message.id, result: message.method === 'Runtime.evaluate'
          ? { result: { type: 'number', value: 1 } } : {} }));
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const modulePath = path.resolve(__dirname, '../scripts/cdp-client.cjs');
    const program = `const { connectToAlbumDone } = require(${JSON.stringify(modulePath)});
      (async () => { const c = await connectToAlbumDone(${server.address().port});
        await c.send('Runtime.enable'); const value = await c.evaluate('1');
        if (value !== 1) throw new Error('Bad runtime result'); c.socket.close(); console.log('passed');
      })().catch(error => { console.error(error.message); process.exitCode = 1; });`;
    const child = spawn(process.execPath, ['-e', program], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    const timeout = setTimeout(() => child.kill(), 20000);
    const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
    clearTimeout(timeout);
    for (const socket of sockets.clients) socket.terminate();
    await new Promise(resolve => sockets.close(resolve)); await new Promise(resolve => server.close(resolve));
    if (closeAt) { assert.equal(code, 1); assert.equal(stdout, ''); assert.match(stderr, /closed before UI acceptance completed/); }
    else { assert.equal(code, 0); assert.equal(stdout.trim(), 'passed'); }
  }
  const payload = String.fromCharCode(39, 34, 92, 10, 0x2028, 0x2029) + '; globalThis.injected = true; //';
  const input = { text: payload, nested: [payload] };
  let released = 0;
  const server = http.createServer((_request, response) => response.end(JSON.stringify([
    { type: 'page', webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}` },
  ])));
  const sockets = new WebSocketServer({ server });
  sockets.on('connection', socket => socket.on('message', raw => {
    const message = JSON.parse(String(raw));
    let result;
    if (message.method === 'Runtime.evaluate') {
      assert.equal(message.params.expression, 'globalThis');
      result = { result: { type: 'object', objectId: 'test-renderer' } };
    } else if (message.method === 'Runtime.callFunctionOn') {
      assert.equal(message.params.objectId, 'test-renderer');
      assert.equal(message.params.functionDeclaration.includes(payload), false, 'Input must not become executable source');
      assert.deepEqual(message.params.arguments, [{ value: input }]);
      result = released === 0
        ? { result: { type: 'object', value: message.params.arguments[0].value } }
        : { exceptionDetails: { exception: { description: 'Expected renderer error' } } };
    } else {
      assert.equal(message.method, 'Runtime.releaseObject');
      assert.equal(message.params.objectId, 'test-renderer');
      released++;
      result = {};
    }
    socket.send(JSON.stringify({ id: message.id, result }));
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { connectToAlbumDone } = require('../scripts/cdp-client.cjs');
  const client = await connectToAlbumDone(server.address().port);
  try {
    assert.deepEqual(await client.callFunction(function (value) { return value; }, input), input);
    assert.equal(released, 1, 'Successful calls must release the renderer handle');
    await assert.rejects(client.callFunction(function (value) { return value; }, input), /Expected renderer error/);
    assert.equal(released, 2, 'Failed calls must also release the renderer handle');
  } finally {
    client.socket.close();
    for (const socket of sockets.clients) socket.terminate();
    await new Promise(resolve => sockets.close(resolve));
    await new Promise(resolve => server.close(resolve));
  }
  console.log('Acceptance transport rejects interruptions and passes arguments as data without source interpolation');
})().catch(error => { console.error(error); process.exitCode = 1; });
