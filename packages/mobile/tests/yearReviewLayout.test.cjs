const assert = require('assert');
const { buildYearReviewLayoutPlan } = require('../../shared/dist/utils/yearReviewLayout');

const now = new Date(2026, 6, 10);
const input = (count) => Array.from({ length: count }, (_, index) => ({
  id: `android-${index}`,
  timestamp: new Date(2026, index % 4, index + 1).getTime(),
}));

assert.strictEqual(buildYearReviewLayoutPlan(input(1), 'calendar', now).layout, 'vertical');
assert.strictEqual(buildYearReviewLayoutPlan(input(2), 'calendar', now).photoIds.length, 2);
assert.strictEqual(buildYearReviewLayoutPlan(input(4), 'calendar', now).photoIds.length, 4);
const calendar = buildYearReviewLayoutPlan(input(6), 'calendar', now);
assert.strictEqual(calendar.layout, 'calendar');
assert.strictEqual(calendar.monthIds.length, 7);
assert.deepStrictEqual(calendar.monthIds, Array.from({ length: 7 }, (_, month) => 2026 * 12 + month));
assert.strictEqual(buildYearReviewLayoutPlan([], 'calendar', now).layout, 'empty');

console.log('mobile year review layout conformance tests passed');
