const path = require('path');
const { app } = require('electron');

async function main() {
  const imagePath = process.argv[2];
  if (!imagePath) {
    throw new Error('Usage: electron benchmark-vision-preview.cjs <image>');
  }
  const userData = process.env.ALBUMDONE_BENCH_USER_DATA;
  if (userData) {
    app.setPath('userData', path.resolve(userData));
  }
  await app.whenReady();
  const { runVisionPreviewBenchmark } = require('../dist/main/ipc.js');
  const result = await runVisionPreviewBenchmark(path.resolve(imagePath));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  app.quit();
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  app.exit(1);
});
