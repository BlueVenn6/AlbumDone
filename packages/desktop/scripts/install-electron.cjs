// Electron 44 makes downloading its runtime an explicit installation step.
const { spawnSync } = require('node:child_process');
const result = spawnSync(process.execPath, [require.resolve('electron/install.js')], {
  stdio: 'inherit',
  windowsHide: true,
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
