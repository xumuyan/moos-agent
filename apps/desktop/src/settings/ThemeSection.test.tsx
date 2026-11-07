import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ThemeSection from './ThemeSection';
import type { ThemeDefinition } from '../themes/schema';
const theme = { id: 'fixture', name: '测试皮肤', version: '1.0.0', moosVersion: '^0.1.0', tokens: {}, styles: {}, assets: {} } as ThemeDefinition;
it('marks the default as applied after an active local theme disappears', () => {
  const onApply = vi.fn();
  const { rerender } = render(<ThemeSection themes={[theme]} activeId="fixture" onApply={onApply} />);
  expect(screen.getByRole('button', { name: '测试皮肤 已应用' })).toBeInTheDocument();
  rerender(<ThemeSection themes={[]} activeId="default" onApply={onApply} />);
  expect(screen.getByRole('button', { name: 'Moos 默认 已应用' })).toBeInTheDocument();
  expect(screen.queryByText('测试皮肤')).not.toBeInTheDocument();
  expect(onApply).not.toHaveBeenCalled();
});
