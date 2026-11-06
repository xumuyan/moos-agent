import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { terminalRequest, type TerminalPage, type TerminalSession } from './api';
import '@xterm/xterm/css/xterm.css';

export default function TerminalScreen({ session }: { session: TerminalSession }) {
  const element = useRef<HTMLDivElement>(null), [status, setStatus] = useState('');
  useEffect(() => {
    if (!element.current) return;
    let disposed = false, after = 0, pending = '', writing = false, inputFailed = false;
    let timer: ReturnType<typeof setTimeout>;
    const params = { projectId: session.projectId, sessionId: session.id };
    const term = new Terminal({ fontSize: 12, fontFamily: 'Menlo, monospace', scrollback: 2000, cursorBlink: true, allowProposedApi: false, linkHandler: { activate() {} }, theme: { background: '#222321', foreground: '#e7e4dc', cursor: '#d7b58a', selectionBackground: '#66645d' } });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(element.current);
    const error = (message: string) => { if (!disposed) setStatus(message); };
    const resize = () => {
      if (disposed || !element.current?.clientWidth) return;
      fit.fit();
      if (term.rows < 2 || term.cols < 2) return;
      void terminalRequest('resize', { ...params, rows: term.rows, cols: term.cols }).catch(() => error('终端尺寸同步失败，可收起后重新展开。'));
    };
    const observer = new ResizeObserver(resize); observer.observe(element.current); resize(); term.focus();
    const flush = async () => {
      if (writing || inputFailed) return;
      writing = true;
      try {
        while (pending && !disposed) {
          const chars = Array.from(pending), data = chars.slice(0, 1000).join(''); pending = chars.slice(1000).join('');
          await terminalRequest('write', { ...params, data });
        }
      } catch { inputFailed = true; pending = ''; error('输入未完整发送，请关闭此标签后重开，不要重复提交命令。'); }
      finally { writing = false; }
    };
    const input = term.onData(data => {
      if (disposed || inputFailed) return;
      if (new TextEncoder().encode(pending + data).length > 65536) { inputFailed = true; pending = ''; error('粘贴内容过大，输入已暂停，请关闭此标签后重开。'); return; }
      pending += data; void flush();
    });
    const poll = async () => {
      try {
        const page = await terminalRequest<TerminalPage>('read', { ...params, after });
        if (disposed) return;
        if (!Number.isSafeInteger(page.nextAfter) || page.nextAfter < after || !Array.isArray(page.data) || page.data.length > 16384 || page.data.some(n => !Number.isInteger(n) || n < 0 || n > 255)) throw new Error('Invalid terminal page');
        if (page.truncated) { term.reset(); error('较早输出已超出缓存，仅显示最近 1 MiB。'); }
        after = page.nextAfter;
        if (page.data.length) await new Promise<void>(resolve => term.write(new Uint8Array(page.data), resolve));
        if (disposed) return;
        if (page.ended && !page.hasMore) { error(`进程已退出${page.exitCode === null ? '' : `，退出码 ${page.exitCode}`}。新建标签可重新开始。`); return; }
        timer = setTimeout(poll, page.hasMore ? 0 : 100);
      } catch { error('终端输出连接中断，请关闭此标签后重开。'); }
    };
    setStatus(''); void poll();
    return () => { disposed = true; clearTimeout(timer); observer.disconnect(); input.dispose(); term.dispose(); };
  }, [session.id, session.projectId]);
  return <><div className="terminal-screen" ref={element} role="region" aria-label="交互终端" />{status && <p className="terminal-status" role="status">{status}</p>}</>;
}
