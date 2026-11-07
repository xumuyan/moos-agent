import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import AppShell from './AppShell';
import { useContext } from 'react';
import { RightPanelFrame } from '../vendor/dsh/rightpanel/RightPanelFrame';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); delete document.documentElement.dataset.platform; });
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
  expect(container.querySelector('[data-rightbar-col] > *')).not.toBeNull();
  expect(screen.queryByRole('complementary', { name:'tools' })).toBeNull();
  act(() => vi.advanceTimersByTime(300)); expect(container.querySelector('[data-rightbar-col] > *')).toBeNull();
  unmount(); motion(true);
  const reduced = render(<AppShell {...{sidebar,conversation,rightPanel}} />);
  fireEvent.click(screen.getByRole('button', { name:'收起侧栏' }));
  expect(reduced.container.firstChild).toHaveClass('is-rail-layout');
  reduced.rerender(<AppShell {...{sidebar,conversation}} />);
  expect(reduced.container.querySelector('[data-rightbar-col] > *')).toBeNull();
});


test('keeps the resolved right panel width during the shared 300ms track exit', () => {
  motion();
  vi.useFakeTimers();
  function Panel() {
    const panel = useContext(RightPanelFrame);
    return <aside>{panel?.open ? 'open' : 'closing'} {panel?.width}</aside>;
  }
  const props = { sidebar: null, conversation: <main>chat</main>, preferredRightWidth: 1000 };
  const { container, rerender } = render(<AppShell {...props} />);
  rerender(<AppShell {...props} rightPanel={<Panel />} />);
  expect(screen.getByText('open 600')).toBeInTheDocument();
  expect(container.firstChild).toHaveAttribute('data-animating');
  rerender(<AppShell {...props} />);
  expect(screen.getByText('closing 600')).toBeInTheDocument();
  expect(container.querySelector('[data-rightbar-col]')).toHaveAttribute('inert');
  act(() => vi.advanceTimersByTime(300));
  expect(screen.queryByText('closing 600')).toBeNull();
  expect(container.firstChild).not.toHaveAttribute('data-animating');
});

test('seats the Mac opener outside the zero-width sidebar and supplies center width', () => {
  motion();
  document.documentElement.dataset.platform = 'darwin';
  const { container } = render(<AppShell sidebar={<aside aria-label="navigation">wide</aside>} conversation={<main>chat</main>} />);
  fireEvent.click(screen.getByRole('button', { name:'收起侧栏' }));
  const opener = screen.getByRole('button', { name:'展开侧栏' });
  expect(opener.closest('[data-shell-leading]')).toBeInTheDocument();
  expect(screen.queryByRole('complementary', { name:'navigation' })).toBeNull();
  expect((container.firstChild as HTMLElement).style.getPropertyValue('--dsh-conversation-column-width')).toBe('1280px');
});
