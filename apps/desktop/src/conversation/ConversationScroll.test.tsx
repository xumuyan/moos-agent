import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ConversationScroll from './ConversationScroll';
import { DisclosureRow } from '../vendor/dsh/primitives/DisclosureRow';
import TurnProcessToggle from '../vendor/dsh/conversation/TurnProcessToggle';

let resize: () => void;
let frame: FrameRequestCallback;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());
function geometry(node: HTMLElement) {
  const state = { height: 1400, top: 0 };
  Object.defineProperties(node, {
    scrollHeight: { configurable: true, get: () => state.height },
    clientHeight: { configurable: true, get: () => 400 },
    scrollTop: { configurable: true, get: () => state.top, set: (value: number) => { state.top = Math.max(0, Math.min(value, state.height - 400)); } },
  });
  vi.spyOn(node, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 500, 400));
  return state;
}
it('follows growth only at the tail, stops for history reading and returns on explicit request', () => {
  render(<ConversationScroll viewKey="c:latest" isOlder={false}><div>内容</div></ConversationScroll>);
  const node = screen.getByLabelText('对话内容');
  const state = geometry(node);
  act(() => resize());
  expect(node.scrollTop).toBe(1000);
  state.height = 1600; act(() => resize());
  expect(node.scrollTop).toBe(1200);
  node.scrollTop = 300; fireEvent.scroll(node);
  state.height = 1800; act(() => resize());
  expect(node.scrollTop).toBe(300);
  fireEvent.click(screen.getByRole('button', { name: /返回最新消息/ }));
  expect(node.scrollTop).toBe(1400);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('does not force an older page to the tail and resets when changing conversations', () => {
  const { rerender } = render(<ConversationScroll viewKey="c:older" isOlder><div>历史</div></ConversationScroll>);
  const node = screen.getByLabelText('对话内容');
  const state = geometry(node);
  act(() => resize());
  expect(node.scrollTop).toBe(0);
  state.height = 1800; act(() => resize());
  expect(node.scrollTop).toBe(0);
  rerender(<ConversationScroll viewKey="other:latest" isOlder={false}><div>新会话</div></ConversationScroll>);
  expect(node.scrollTop).toBe(1400);
});
it.each(['summary','process','dsh'])('restores a surviving visible anchor after %s disclosure changes the layout', kind => {
  const control = kind === 'summary' ? <details><summary>展开过程</summary><p>过程</p></details>
    : kind === 'process' ? <TurnProcessToggle label="展开过程" open={false} hasContent onToggle={vi.fn()}/>
    : <DisclosureRow icon={null} title="展开过程" open={false} expandable expandOnRowClick onToggle={vi.fn()}/>;
  render(<ConversationScroll viewKey="c:latest" isOlder={false}>{control}<div data-scroll-anchor>阅读位置</div></ConversationScroll>);
  const node = screen.getByLabelText('对话内容');
  const state = geometry(node);
  node.scrollTop = 500;
  let documentY = 600;
  const anchor = screen.getByText('阅读位置');
  vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, documentY - node.scrollTop, 500, 40));
  vi.spyOn(anchor, 'getClientRects').mockReturnValue([new DOMRect(0, 100, 500, 40)] as unknown as DOMRectList);
  fireEvent.scroll(node);
  fireEvent.click(screen.getByText('展开过程'));
  documentY = 400;
  fireEvent.scroll(node);
  act(() => frame(0));
  expect(node.scrollTop).toBe(300);
  expect(anchor.getBoundingClientRect().top).toBe(100);
  // A later automatic shrink uses the saved surviving anchor as well.
  state.height = 1200; documentY = 200;
  act(() => resize());
  expect(node.scrollTop).toBe(100);
  expect(anchor.getBoundingClientRect().top).toBe(100);
});
it('keeps return control above the measured native composer as terminal height changes', () => {
  render(<ConversationScroll viewKey="native:latest" isOlder={false} composer={<div>输入与终端</div>}><div>内容</div></ConversationScroll>);
  const viewport = screen.getByLabelText('对话内容');
  geometry(viewport);
  const seat=screen.getByText('输入与终端').parentElement!;
  let height=160;
  vi.spyOn(seat,'getBoundingClientRect').mockImplementation(()=>new DOMRect(0,0,500,height));
  act(()=>resize());
  viewport.scrollTop=100; fireEvent.scroll(viewport);
  const button=screen.getByRole('button',{name:/返回最新消息/});
  expect(button.style.bottom).toContain('--moos-composer-height');
  expect(viewport.parentElement!.style.getPropertyValue('--moos-composer-height')).toBe('160px');
  height=380; act(()=>resize());
  expect(viewport.parentElement!.style.getPropertyValue('--moos-composer-height')).toBe('380px');
  fireEvent.click(button);
  expect(viewport.scrollTop).toBe(1000);
});
