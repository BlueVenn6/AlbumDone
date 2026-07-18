const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const {
  RecoverableBatchError,
  runCrashIsolatedBatches,
} = require('../dist/main/resilientBatch');

const SUPPORTED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif',
  '.tiff', '.tif', '.avif', '.heic', '.heif',
]);

function findImages(root) {
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const directory = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) stack.push(filePath);
      else if (
        entry.isFile()
        && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ) {
        files.push(filePath);
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right, 'en'));
}

async function main() {
  const root = path.resolve(process.argv[2] ?? '');
  if (!fs.statSync(root).isDirectory()) {
    throw new Error(`Not a directory: ${root}`);
  }

  const files = findImages(root);
  const workerPath = path.resolve(__dirname, '../dist/main/visualHashWorker.js');
  let processed = 0;
  let decodeErrors = 0;
  const isolated = [];

  const attempt = (batch) => new Promise((resolve, reject) => {
    const child = fork(workerPath, [], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const completed = new Set();
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    child.on('message', (message) => {
      if (message.type === 'done') {
        finish();
        return;
      }
      if (message.filePath !== '__worker') completed.add(message.filePath);
      processed += 1;
      if (message.error) decodeErrors += 1;
      if (processed % 250 === 0 || processed === files.length) {
        console.log(
          `PROGRESS=${processed}/${files.length};DECODE_ERRORS=${decodeErrors};ISOLATED=${isolated.length}`,
        );
      }
    });
    child.once('error', finish);
    child.once('exit', (code) => {
      if (settled) return;
      const remaining = batch.filter((filePath) => !completed.has(filePath));
      reject(new RecoverableBatchError(
        `worker exit ${code === null ? 'unknown' : code}`,
        remaining,
      ));
    });
    child.send({ filePaths: batch });
  });

  console.log(`START_TOTAL=${files.length}`);
  await runCrashIsolatedBatches(files, 32, attempt, (filePath, error) => {
    isolated.push({ filePath, error: error.message });
    processed += 1;
    console.log(`ISOLATED_FILE=${path.basename(filePath)};ERROR=${error.message}`);
  });
  console.log(
    `DONE_TOTAL=${files.length};PROCESSED=${processed};DECODE_ERRORS=${decodeErrors};ISOLATED=${isolated.length}`,
  );
  for (const item of isolated) {
    console.log(`ISOLATED_RESULT=${item.filePath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
