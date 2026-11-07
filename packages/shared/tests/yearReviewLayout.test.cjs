const assert = require('assert');
const { buildYearReviewLayoutPlan, getYearReviewMonthIds, getYearReviewRows } = require('../dist/utils/yearReviewLayout');

const now = new Date(2026, 9, 26, 12);
const photo = (id, year, month, day = 10) => ({ id, timestamp: new Date(year, month, day, 12).getTime() });
const rolling = getYearReviewMonthIds('rolling', now);
assert.strictEqual(rolling.length, 12);
assert.strictEqual(rolling[0], 2025 * 12 + 10);
assert.strictEqual(rolling[11], 2026 * 12 + 9);
assert.deepStrictEqual(getYearReviewMonthIds('previousYear', now), Array.from({ length: 12 }, (_, i) => 2025 * 12 + i));
assert.deepStrictEqual(getYearReviewMonthIds('rolling', new Date(2026, 0, 1)), Array.from({ length: 12 }, (_, i) => 2025 * 12 + 1 + i));
assert.deepStrictEqual(getYearReviewMonthIds('previousYear', new Date(2025, 0, 1)), Array.from({ length: 12 }, (_, i) => 2024 * 12 + i));
assert.strictEqual(buildYearReviewLayoutPlan([], 'rolling', now).layout, 'empty');
assert.strictEqual(buildYearReviewLayoutPlan([photo('old', 2024, 2)], 'rolling', now).layout, 'empty', 'Old albums must not move the requested date range');
assert.strictEqual(buildYearReviewLayoutPlan([photo('future', 2026, 11)], 'rolling', now).layout, 'empty');
assert.strictEqual(buildYearReviewLayoutPlan([photo('later-today', 2026, 9, 27)], 'rolling', now).layout, 'empty');
for (const count of [1, 2, 4, 5, 6, 20]) {
  const input = Array.from({ length: count }, (_, i) => photo(`photo-${i}`, 2026, 0));
  const plan = buildYearReviewLayoutPlan(input, 'rolling', now);
  assert.strictEqual(plan.layout, 'calendar');
  assert.strictEqual(plan.photoIds.length, count);
  assert.deepStrictEqual(plan.monthIds, rolling, 'Even one photo keeps real empty-month cards');
}
const previous = buildYearReviewLayoutPlan([photo('last', 2025, 11), photo('this', 2026, 0)], 'previousYear', now);
assert.deepStrictEqual(previous.photoIds, ['last']);
for (let count = 1; count <= 12; count += 1) {
  const rows = getYearReviewRows(count);
  assert.strictEqual(rows.reduce((sum, n) => sum + n, 0), count);
  assert(rows.every((n) => n >= 1 && n <= 4));
  assert(Math.max(...rows) - Math.min(...rows) <= 1);
}
assert.deepStrictEqual(getYearReviewRows(1), [1]);
assert.deepStrictEqual(getYearReviewRows(2), [2]);
assert.deepStrictEqual(getYearReviewRows(4), [2, 2]);
assert.deepStrictEqual(getYearReviewRows(10), [4, 3, 3]);
assert.deepStrictEqual(getYearReviewRows(12), [4, 4, 4]);
assert.deepStrictEqual(getYearReviewRows(0), []);
console.log('Year review current/previous-year boundaries, sparse albums and balanced 1–12 cell rows passed');
