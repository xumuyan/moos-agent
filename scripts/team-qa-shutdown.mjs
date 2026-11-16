import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Instrument only the copied QA entry. Never emit URLs, tokens or user content.
export function instrumentQaShutdown(source, { blockQuit = false } = {}) {
  const marker = "app.setName('沐码');";
  const stop = 'host.stop().finally(';
  if (source.split(marker).length !== 2 || source.split(stop).length !== 2) {
    throw new Error('Unsupported QA shutdown instrumentation entry');
  }
  return source.replace(marker, `
const qaShutdownEvent = event => console.error('MUMA_QA_SHUTDOWN ' + JSON.stringify({ event, at: Date.now() }));
${blockQuit ? "app.on('before-quit', event => event.preventDefault());" : ''}
for (const event of ['before-quit', 'will-quit', 'quit', 'window-all-closed']) app.on(event, () => qaShutdownEvent(event));
app.on('browser-window-created', (_event, window) => {
  window.on('close', () => qaShutdownEvent('window-close'));
  window.on('closed', () => qaShutdownEvent('window-closed'));
  window.webContents.on('destroyed', () => qaShutdownEvent('webcontents-destroyed'));
});
${marker}`).replace(stop, `(qaShutdownEvent('host-stop-start'), host.stop()).finally(() => qaShutdownEvent('host-stop-settled')).finally(`);
}

export function parseQaShutdown(line) {
  const prefix = 'MUMA_QA_SHUTDOWN ';
  if (!line.startsWith(prefix)) return undefined;
  try {
    const value = JSON.parse(line.slice(prefix.length));
    const allowed = ['before-quit', 'will-quit', 'quit', 'window-all-closed', 'window-close',
      'window-closed', 'webcontents-destroyed', 'host-stop-start', 'host-stop-settled'];
    if (allowed.includes(value.event) && Number.isSafeInteger(value.at) && value.at > 0) {
      return { event: value.event, at: value.at };
    }
  } catch {}
}

// ps output contains only numeric IDs and the kernel state, never command lines.
export function selectQaProcesses(text, rootPid) {
  if (!Number.isSafeInteger(rootPid) || rootPid <= 1) throw new Error('Invalid QA root PID');
  const rows = text.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+([A-Za-z+<>NsXEW-]{1,16})\s*$/.exec(line);
    if (!match) return [];
    const pid = Number(match[1]), ppid = Number(match[2]);
    return Number.isSafeInteger(pid) && Number.isSafeInteger(ppid) && pid > 1 && ppid >= 0
      ? [{ pid, ppid, state: match[3] }] : [];
  });
  const selected = new Set([rootPid]);
  for (let round = 0; round < rows.length; round++) {
    let added = false;
    for (const row of rows) if (selected.has(row.ppid) && !selected.has(row.pid)) { selected.add(row.pid); added = true; }
    if (!added) break;
  }
  return rows.filter(row => selected.has(row.pid)).slice(0, 128);
}

export async function snapshotQaProcesses(rootPid) {
  try {
    const { stdout } = await promisify(execFile)('/bin/ps', ['-axo', 'pid=,ppid=,stat='],
      { timeout: 1500, maxBuffer: 1024 * 1024, encoding: 'utf8' });
    return { status: 'observed', processes: selectQaProcesses(stdout, rootPid) };
  } catch {
    return { status: 'unavailable', processes: [] };
  }
}
