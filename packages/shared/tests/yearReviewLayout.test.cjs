const assert = require('assert');
const { buildYearReviewLayoutPlan } = require('../dist/utils/yearReviewLayout');

const now = new Date(2026, 6, 10, 12, 0, 0);
const photos = (count, year = 2026) => Array.from({ length: count }, (_, index) => ({
  id: `photo-${count}-${index}`,
  timestamp: new Date(year, index % 3, index + 1, 12, 0, 0).getTime(),
}));

assert.strictEqual(buildYearReviewLayoutPlan([], 'calendar', now).layout, 'empty');
for (const count of [1, 2, 4, 5]) {
  const plan = buildYearReviewLayoutPlan(photos(count), 'calendar', now);
  assert.strictEqual(plan.layout, 'vertical');
  assert.strictEqual(plan.photoIds.length, count);
  assert.strictEqual(plan.monthIds.length, count);
}
for (const count of [6, 20, 500]) {
  const plan = buildYearReviewLayoutPlan(photos(count), 'calendar', now);
  assert.strictEqual(plan.layout, 'calendar');
  assert.strictEqual(plan.monthIds.length, 7);
  assert.deepStrictEqual(plan.monthIds, Array.from({ length: 7 }, (_, month) => 2026 * 12 + month));
}

const rolling = buildYearReviewLayoutPlan([
  ...photos(3, 2025),
  ...photos(3, 2026),
], 'rolling', now);
assert.strictEqual(rolling.layout, 'calendar');
assert.strictEqual(rolling.monthIds.length, 12);
for (let index = 1; index < rolling.monthIds.length; index += 1) {
  assert.strictEqual(rolling.monthIds[index] - rolling.monthIds[index - 1], 1);
}

assert.strictEqual(
  buildYearReviewLayoutPlan(photos(20, 2025), 'calendar', now).layout,
  'empty',
  'This Year must not pull photos from another year',
);

console.log('year review layout tests passed');
