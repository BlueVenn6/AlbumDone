const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { connectToAlbumDone } = require('./cdp-client.cjs');

let completed = false;
process.on('beforeExit', code => { if (!code && !completed) process.exitCode = 1; });

(async () => {
  const client = await connectToAlbumDone(Number(process.argv[2]));
  const { socket, send, evaluate, waitFor, click } = client;
  let saved;
  try {
    const userData = await evaluate(`window.electronAPI.app.getPath('userData')`);
    const relative = path.relative(os.tmpdir(), userData);
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative)
      && path.basename(path.dirname(userData)).startsWith('albumdone-ui-'), 'Use an isolated test profile.');
    saved = await evaluate(`localStorage.getItem('photo-manager-settings')`);
    for (const [model, expected] of [
      ['claude-3-5-sonnet-20241022', 'claude-sonnet-5-5'],
      ['claude-sonnet-5', 'claude-sonnet-5'],
    ]) {
      await evaluate(`(() => {
        localStorage.setItem('photo-manager-settings', JSON.stringify({ version: 1, state: {
          providers: { anthropic: { provider: 'anthropic', model: ${JSON.stringify(model)}, hasApiKey: true, supportsVision: true, mode: 'direct' } },
          defaultVisionProvider: 'anthropic', defaultTextProvider: 'anthropic',
          trashRetentionDays: 14, customInstructions: [], ocrLanguage: 'eng',
        }}));
        history.replaceState(null, '', '#/settings');
      })()`);
      await send('Page.reload', { ignoreCache: true });
      await waitFor(`document.body.textContent.includes('Anthropic')`);
      assert(await click(['Anthropic']));
      await waitFor(`document.querySelector('select')?.value === ${JSON.stringify(expected)}`);
      assert.equal(await evaluate(`document.querySelector('select').value`), expected);
    }
    completed = true;
    console.log(JSON.stringify({ sameVersionRetiredModelMigratedInVisibleSettings: true, savedActiveModelPreservedInVisibleSettings: true }));
  } finally {
    if (saved !== undefined) {
      await evaluate(saved === null
        ? `localStorage.removeItem('photo-manager-settings')`
        : `localStorage.setItem('photo-manager-settings', ${JSON.stringify(saved)})`);
      await send('Page.reload', { ignoreCache: true });
      await waitFor(`document.body.textContent.includes('Anthropic')`);
    }
    socket.terminate();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
