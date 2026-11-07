import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import AppShell from './AppShell';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function motion(reduce = false) {
  Object.defineProperty(window, 'innerWidth', { configurable:true, value:1280 });
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches:reduce, addEventListener:vi.fn(), removeEventListener:vi.fn() })));
}
test('freezes and fades wide content before rail settles and cancels stale collapse on rapid reversal', () => {
  motion(); vi.useFakeTimers();
  const { container } = render(<AppShell sidebar={<aside aria-label="navigation">wide</aside>} conversation={<main>chat</main>} />);
  fireEvent.click(screen.getByRole('button', { name:'收起侧栏' }));
  expect(container.firstChild).toHaveClass('is-sidebar-fading');
  expect(screen.queryByRole('complementary', { name:'navigation' })).toBeNull();
  act(() => vi.advanceTimersByTime(149)); expect(container.firstChild).not.toHaveClass('is-rail-layout');
  fireEvent.click(screen.getByRole('button', { name:'展开侧栏' }));
  act(() => vi.advanceTimersByTime(300)); expect(container.firstChild).not.toHaveClass('is-rail-layout');
  expect(screen.getByRole('complementary', { name:'navigation' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name:'收起侧栏' }));
  act(() => vi.advanceTimersByTime(150)); expect(container.firstChild).toHaveClass('is-rail-layout');
});
test('keeps closing tools painted but inaccessible until exit settles; reduced motion skips waits', () => {
  motion(); vi.useFakeTimers();
  const sidebar = <span>navigation</span>, conversation = <main>chat</main>, rightPanel = <aside aria-label="tools">files</aside>;
  const { container, rerender, unmount } = render(<AppShell {...{sidebar,conversation,rightPanel}} />);
  rerender(<AppShell {...{sidebar,conversation}} />);
  expect(container.querySelector('.dsh-right-column')).not.toBeNull();
  expect(screen.queryByRole('complementary', { name:'tools' })).toBeNull();
  act(() => vi.advanceTimersByTime(300)); expect(container.querySelector('.dsh-right-column')).toBeNull();
  unmount(); motion(true);
  const reduced = render(<AppShell {...{sidebar,conversation,rightPanel}} />);
  fireEvent.click(screen.getByRole('button', { name:'收起侧栏' }));
  expect(reduced.container.firstChild).toHaveClass('is-rail-layout');
  reduced.rerender(<AppShell {...{sidebar,conversation}} />);
  expect(reduced.container.querySelector('.dsh-right-column')).toBeNull();
});
