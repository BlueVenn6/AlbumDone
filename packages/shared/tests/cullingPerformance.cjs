// Host JavaScript benchmark; this is not a phone frame-rate measurement.
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { useCullingStore: store } = require('../dist/store/cullingStore');

for (const count of [100, 2000]) {
  store.getState().reset();
  const items = Array.from({ length: count }, (_, i) => ({
    photo: { id: String(i), uri: `ph://${i}`, filename: `${i}.jpg`, width: 4000,
      height: 3000, fileSize: 3000000, timestamp: i, tags: [], isScreenshot: false },
    decision: 'pending', aiDecision: 'pending',
  }));
  store.setState({ items, allItems: items });
  const samples = [];
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    store.getState().decide(String(i), i % 2 ? 'delete' : 'keep');
    samples.push(performance.now() - start);
  }
  assert.equal(store.getState().isComplete, true);
  assert.equal(store.getState().getKeptPhotos().length, count / 2);
  assert.equal(store.getState().getDeletedPhotos().length, count / 2);
  assert.equal(items[0].decision, 'pending');
  for (let i = 0; i < count; i++) store.getState().undoLast();
  assert.equal(store.getState().getPendingPhotos().length, count);
  assert.equal(store.getState().history.length, 0);
  samples.sort((a, b) => a - b);
  console.log(JSON.stringify({ count, totalMs: samples.reduce((a, b) => a + b, 0),
    p95Ms: samples[Math.floor(count * 0.95)], maxMs: samples[count - 1] }));
}
