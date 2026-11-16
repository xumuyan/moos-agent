// Instrument only the copied QA entry. Never emit URLs, tokens or user content.
export function instrumentQaShutdown(source) {
  const marker = "app.setName('沐码');";
  const stop = 'host.stop().finally(';
  if (source.split(marker).length !== 2 || source.split(stop).length !== 2) {
    throw new Error('Unsupported QA shutdown instrumentation entry');
  }
  return source.replace(marker, `
const qaShutdownEvent = event => console.error('MUMA_QA_SHUTDOWN ' + JSON.stringify({ event, at: Date.now() }));
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
