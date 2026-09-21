const assert = require('node:assert/strict');
const { useCullingStore: store } = require('../dist/store/cullingStore');
const item = (id, decision = 'pending') => ({
  photo: { id, uri: `ph://${id}`, filename: `${id}.jpg`, width: 4000, height: 3000,
    fileSize: 3000000, timestamp: 1, tags: [], isScreenshot: false },
  decision, aiDecision: decision,
});

store.getState().reset();
const items = [item('a'), item('b'), item('c')];
store.setState({ items, allItems: items });
store.getState().decide('b', 'delete');
assert.equal(items[1].decision, 'pending', 'previous state is immutable');
assert.equal(store.getState().currentIndex, 2);
store.getState().decide('c', 'keep');
assert.equal(store.getState().currentIndex, 0, 'wrap to the remaining pending photo');
store.getState().decide('a', 'keep');
assert.equal(store.getState().isComplete, true);
assert.deepEqual(store.getState().getDeletedPhotos().map((p) => p.id), ['b']);
store.getState().undoLast();
assert.equal(store.getState().isComplete, false);
assert.equal(store.getState().currentIndex, 0);
assert.equal(store.getState().allItems[0].decision, 'pending');
store.getState().decide('a', 'delete');
store.getState().decide('a', 'keep');
store.getState().undoLast();
assert.equal(store.getState().items[0].decision, 'delete', 'undo restores a revised decision');
const before = store.getState();
store.getState().decide('absent', 'delete');
assert.strictEqual(store.getState(), before);

// AI-decided items and review items may be different arrays and different objects.
store.getState().reset();
store.setState({ items: [item('b')], allItems: [item('a', 'keep'), item('b')] });
store.getState().decide('b', 'delete');
assert.deepEqual(store.getState().allItems.map((i) => i.decision), ['keep', 'delete']);
store.getState().undoLast();
assert.deepEqual(store.getState().allItems.map((i) => i.decision), ['keep', 'pending']);
store.getState().undoLast();
assert.equal(store.getState().history.length, 0);
store.getState().reset();
console.log('Culling decisions, wraparound, undo, immutable state and AI items passed');
