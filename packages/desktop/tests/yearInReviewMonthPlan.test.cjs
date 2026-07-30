const assert = require('assert');
const { buildYearReviewLayoutPlan } = require('../../shared/dist/utils/yearReviewLayout');

const now = new Date(2026, 6, 10);
const photo = (id, month, day = 1) => ({
  id,
  timestamp: new Date(2026, month, day, 12, 0, 0).getTime(),
});

for (const count of [1, 2, 4, 5]) {
  const plan = buildYearReviewLayoutPlan(
    Array.from({ length: count }, (_, index) => photo(`sparse-${count}-${index}`, index % 2, index + 1)),
    'calendar',
    now,
  );
  assert.strictEqual(plan.layout, 'vertical');
  assert.strictEqual(plan.photoIds.length, count);
}

for (const count of [6, 50, 500]) {
  const plan = buildYearReviewLayoutPlan(
    Array.from({ length: count }, (_, index) => photo(`calendar-${count}-${index}`, index % 3, (index % 20) + 1)),
    'calendar',
    now,
  );
  assert.strictEqual(plan.layout, 'calendar');
  assert.deepStrictEqual(
    plan.monthIds,
    Array.from({ length: 7 }, (_, monthIndex) => 2026 * 12 + monthIndex),
  );
}

assert.strictEqual(buildYearReviewLayoutPlan([], 'calendar', now).layout, 'empty');
assert.strictEqual(
  buildYearReviewLayoutPlan([{ id: 'old', timestamp: new Date(2025, 11, 1).getTime() }], 'calendar', now).layout,
  'empty',
);

console.log('desktop year review layout conformance tests passed');
