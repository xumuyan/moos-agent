import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

type Anchor = { node: HTMLElement; top: number };
function anchors(viewport: HTMLElement): Anchor[] {
  const bounds = viewport.getBoundingClientRect();
  return Array.from(viewport.querySelectorAll<HTMLElement>('[data-scroll-anchor]'))
    .filter(node => { const rect = node.getBoundingClientRect(); return rect.bottom > bounds.top && rect.top < bounds.bottom; })
    .map(node => ({ node, top: node.getBoundingClientRect().top - bounds.top }));
}
function restore(viewport: HTMLElement, saved: Anchor[]) {
  const anchor = saved.find(item => item.node.isConnected && item.node.getClientRects().length > 0);
  if (anchor) viewport.scrollTop += anchor.node.getBoundingClientRect().top - viewport.getBoundingClientRect().top - anchor.top;
}

export default function ConversationScroll({ children, viewKey, isOlder }: { children: ReactNode; viewKey: string; isOlder: boolean }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const following = useRef(!isOlder);
  const saved = useRef<Anchor[]>([]);
  const lastHeight = useRef(0);
  const frame = useRef<number | undefined>(undefined);
  const folding = useRef(false);
  const [showReturn, setShowReturn] = useState(false);

  const remember = () => {
    const node = viewport.current;
    // A collapse can dispatch scroll before ResizeObserver or the disclosure frame.
    // Keep the pre-layout anchor until that restoration has run.
    if (!node || folding.current || node.scrollHeight < lastHeight.current) return;
    following.current = !isOlder && node.scrollHeight - node.clientHeight - node.scrollTop <= 32;
    saved.current = anchors(node);
    setShowReturn(!isOlder && !following.current);
  };
  useLayoutEffect(() => {
    const node = viewport.current!;
    following.current = !isOlder;
    node.scrollTop = isOlder ? 0 : node.scrollHeight;
    lastHeight.current = node.scrollHeight;
    saved.current = anchors(node);
    setShowReturn(false);
    const observer = new ResizeObserver(() => {
      if (folding.current) return;
      const height = node.scrollHeight;
      if (height < lastHeight.current || !following.current) restore(node, saved.current);
      else if (!isOlder) node.scrollTop = height;
      lastHeight.current = height;
      remember();
    });
    observer.observe(content.current!);
    observer.observe(node);
    return () => { observer.disconnect(); if (frame.current !== undefined) cancelAnimationFrame(frame.current); folding.current = false; };
  }, [viewKey, isOlder]);

  const beforeDisclosure = (target: EventTarget) => {
    if (!(target instanceof Element) || !target.closest('summary')) return;
    const node = viewport.current!;
    saved.current = anchors(node);
    folding.current = true;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      restore(node, saved.current);
      folding.current = false;
      lastHeight.current = node.scrollHeight;
      remember();
    });
  };
  return <div className="conversation-scroll-seat">
    <div ref={viewport} className="conversation-area" aria-label="对话内容" aria-live={isOlder ? 'off' : 'polite'} onScroll={remember}
      onClickCapture={event => beforeDisclosure(event.target)} onKeyDownCapture={event => { if (event.key === 'Enter' || event.key === ' ') beforeDisclosure(event.target); }}>
      <div ref={content} className="conversation-flow">{children}</div>
    </div>
    {showReturn && <button className="return-to-latest" onClick={() => { const node = viewport.current!; node.scrollTop = node.scrollHeight; remember(); }}>↓ 返回最新消息</button>}
  </div>;
}
