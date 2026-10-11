const waitOn = require('wait-on');
waitOn({ resources: ['dist/main/index.js', 'dist/main/ports.js'], timeout: 120000 })
  .then(() => {
    const { DESKTOP_PORTS } = require('../dist/main/ports');
    return waitOn({ resources: [`http://localhost:${DESKTOP_PORTS.renderer}`], timeout: 120000 });
  })
  .then(() => require('./start-electron.cjs'))
  .catch((error) => { console.error(error); process.exitCode = 1; });
