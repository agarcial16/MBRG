import { expect, test } from 'vitest';

// DEMO ONLY: intentionally failing test to show CI turns red. Never merge.
test('demo: CI must fail on this test', () => {
  expect(1).toBe(2);
});
