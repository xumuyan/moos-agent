import { expect, test } from 'vitest';
import { computeColumns, clampWidth } from './dsh-columns';
test('preserves center width before shrinking/removing the reference right track', () => {
  expect(computeColumns(1280, 280, 576)).toEqual({ sidebar: 280, center: 424, rightbar: 576 });
  expect(computeColumns(1000, 280, 576)).toEqual({ sidebar: 280, center: 400, rightbar: 320 });
  expect(computeColumns(900, 280, 576)).toEqual({ sidebar: 280, center: 620, rightbar: 0 });
  expect(computeColumns(600, 0, 576)).toEqual({ sidebar: 56, center: 544, rightbar: 0 });
  expect(clampWidth(900, 264, 420)).toBe(420);
});
