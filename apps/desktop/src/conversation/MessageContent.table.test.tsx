import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import MessageContent from './MessageContent';
test('gives wide markdown tables their own keyboard reachable scroll region', () => {
  render(<MessageContent text={'| 文件 | 修改 |\n| --- | --- |\n| very-long-path.ts | updated |'} />);
  const region = screen.getByRole('region', { name:'表格内容（可横向滚动）' });
  expect(region).toHaveAttribute('tabindex','0');
  expect(region).toContainElement(screen.getByRole('table'));
});
