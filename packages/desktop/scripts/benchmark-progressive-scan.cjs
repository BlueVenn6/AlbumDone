const path = require('path');
const { app } = require('electron');

async function main() {
  const folderPath = process.argv[2];
  if (!folderPath) {
    throw new Error('Usage: electron benchmark-progressive-scan.cjs <folder>');
  }
  const userData = process.env.ALBUMDONE_BENCH_USER_DATA;
  if (userData) {
    app.setPath('userData', path.resolve(userData));
  }
  await app.whenReady();
  const { runPhotoFolderProgressBenchmark } = require('../dist/main/ipc.js');
  const result = await runPhotoFolderProgressBenchmark(path.resolve(folderPath));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  app.quit();
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  app.exit(1);
});
