import { expect, test } from 'vitest';
import { statusLabel } from './types';

test('labels persisted terminal task states in Chinese', () => {
  expect(statusLabel('succeeded')).toBe('已完成');
  expect(statusLabel('interrupted')).toBe('已中断');
});
