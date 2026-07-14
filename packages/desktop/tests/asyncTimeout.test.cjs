const assert = require('assert');

const {
  OperationTimeoutError,
  raceWithTimeout,
} = require('../dist/main/asyncTimeout.js');

async function run() {
  assert.strictEqual(await raceWithTimeout(Promise.resolve('ok'), 100, 'late'), 'ok');

  const startedAt = Date.now();
  await assert.rejects(
    raceWithTimeout(new Promise(() => {}), 25, 'credential timeout'),
    (error) => error instanceof OperationTimeoutError && error.message === 'credential timeout',
  );
  assert(Date.now() - startedAt < 500);

  await assert.rejects(
    raceWithTimeout(Promise.reject(new Error('native failure')), 100, 'late'),
    /native failure/,
  );

  console.log('async timeout tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
