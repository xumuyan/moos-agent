import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import MessageContent from './MessageContent';

it('formats model prose as headings, lists, tables and inline file references', () => {
  render(<MessageContent text={'## 修改内容\n\n- **修复** `src/app.ts`\n- 保留历史\n\n| 文件 | 修改 |\n| --- | --- |\n| app.ts | 更新样式 |'} />);
  expect(screen.getByRole('heading', { name: '修改内容' })).toBeVisible();
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(screen.getByText('修复').tagName).toBe('STRONG');
  expect(screen.getByText('src/app.ts').tagName).toBe('CODE');
  expect(screen.getByRole('table')).toHaveTextContent('更新样式');
});

it('omits fenced and indented code, raw HTML and external image requests', () => {
  const { container } = render(<MessageContent text={'结果\n\n```ts\nsecret-code\n```\n\n    indented-code\n\n<script>bad()</script>\n\n![远程图片](https://example.test/pixel)\n\n[危险链接](javascript:alert(1))'} />);
  expect(screen.getByText('结果')).toBeVisible();
  expect(container.textContent).not.toMatch(/secret-code|indented-code|bad\(\)/);
  expect(container.querySelector('img, script, iframe, a, pre')).toBeNull();
  expect(screen.getByText('危险链接')).toBeVisible();
});
