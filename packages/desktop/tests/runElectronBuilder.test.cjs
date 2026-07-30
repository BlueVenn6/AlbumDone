const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  resolveElectronBuilderCli,
  withWorkspaceNodeModules,
} = require('../scripts/run-electron-builder.cjs');

const builderCli = resolveElectronBuilderCli();
assert.strictEqual(fs.existsSync(builderCli), true, 'electron-builder CLI must resolve from the workspace');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'albumdone-builder-test-'));
const rootNodeModules = path.join(tempRoot, 'workspace-node-modules');
const desktopRoot = path.join(tempRoot, 'desktop');
const desktopNodeModules = path.join(desktopRoot, 'node_modules');

fs.mkdirSync(rootNodeModules, { recursive: true });
fs.mkdirSync(desktopRoot, { recursive: true });
fs.writeFileSync(path.join(rootNodeModules, 'marker.txt'), 'workspace dependencies', 'utf8');

try {
  withWorkspaceNodeModules(() => {
    assert.strictEqual(
      fs.readFileSync(path.join(desktopNodeModules, 'marker.txt'), 'utf8'),
      'workspace dependencies',
    );
  }, { rootNodeModules, desktopNodeModules });
  assert.strictEqual(fs.existsSync(desktopNodeModules), false, 'temporary link must be removed');

  assert.throws(
    () => withWorkspaceNodeModules(() => {
      throw new Error('expected callback failure');
    }, { rootNodeModules, desktopNodeModules }),
    /expected callback failure/,
  );
  assert.strictEqual(fs.existsSync(desktopNodeModules), false, 'failed builds must remove the link');

  fs.mkdirSync(desktopNodeModules);
  withWorkspaceNodeModules(() => {
    assert.strictEqual(fs.lstatSync(desktopNodeModules).isDirectory(), true);
  }, { rootNodeModules, desktopNodeModules });
  assert.strictEqual(fs.existsSync(desktopNodeModules), true, 'pre-existing directories must remain');
  fs.rmdirSync(desktopNodeModules);

  fs.symlinkSync(
    rootNodeModules,
    desktopNodeModules,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  withWorkspaceNodeModules(() => {
    assert.strictEqual(
      fs.readFileSync(path.join(desktopNodeModules, 'marker.txt'), 'utf8'),
      'workspace dependencies',
    );
  }, { rootNodeModules, desktopNodeModules });
  assert.strictEqual(
    fs.existsSync(desktopNodeModules),
    false,
    'stale managed links from interrupted builds must be removed',
  );

  const unexpectedNodeModules = path.join(tempRoot, 'unexpected-node-modules');
  fs.mkdirSync(unexpectedNodeModules);
  fs.symlinkSync(
    unexpectedNodeModules,
    desktopNodeModules,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  assert.throws(
    () => withWorkspaceNodeModules(() => {}, { rootNodeModules, desktopNodeModules }),
    /unexpected location/,
  );
  assert.strictEqual(fs.existsSync(desktopNodeModules), true, 'unexpected links must not be removed');
  fs.unlinkSync(desktopNodeModules);

  console.log('electron-builder workspace dependency link tests passed');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
