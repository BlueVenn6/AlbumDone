const assert = require('assert');
const {
  RecoverableBatchError,
  runCrashIsolatedBatches,
} = require('../dist/main/resilientBatch');

async function main() {
  const inputs = Array.from({ length: 7564 }, (_, index) => `photo-${index}`);
  const badPhoto = 'photo-611';
  const completed = new Set();
  const isolated = [];
  let largestAttempt = 0;

  await runCrashIsolatedBatches(
    inputs,
    32,
    async (batch) => {
      largestAttempt = Math.max(largestAttempt, batch.length);
      const badIndex = batch.indexOf(badPhoto);
      const completedBeforeCrash = badIndex === -1 ? batch : batch.slice(0, badIndex);
      completedBeforeCrash.forEach((item) => completed.add(item));
      if (badIndex !== -1) {
        throw new RecoverableBatchError('simulated native access violation', batch.slice(badIndex));
      }
    },
    (item) => isolated.push(item),
  );

  assert.strictEqual(largestAttempt, 32, 'native workers must receive bounded batches');
  assert.deepStrictEqual(isolated, [badPhoto], 'only the crashing image should be skipped');
  assert.strictEqual(completed.size, inputs.length - 1, 'all readable images must complete');

  let fatalAttemptCount = 0;
  await assert.rejects(
    runCrashIsolatedBatches(
      ['a', 'b'],
      32,
      async () => {
        fatalAttemptCount += 1;
        throw new Error('worker could not be spawned');
      },
      () => undefined,
    ),
    /worker could not be spawned/,
  );
  assert.strictEqual(fatalAttemptCount, 1, 'non-recoverable worker errors must not retry forever');

  console.log('resilient visual hash batching tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
