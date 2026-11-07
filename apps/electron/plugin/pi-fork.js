const messageKey = /^[a-zA-Z0-9_-]{1,160}$/;

export function forkPrefix(session) {
  const end = session?.inheritedEventCount;
  if (!session?.header?.isSeeded || !Number.isSafeInteger(end) || end <= 0) return;
  const events = session.snapshotEvents(Math.max(0, end - 1600), end);
  const history = [];
  let userId;
  let checkpoint;
  for (const event of events) {
    if (event.type === 'turn/start') {
      userId = undefined;
      checkpoint = undefined;
    } else if (event.type === 'turn/end' && event.data.reason?.kind === 'completed') {
      checkpoint = userId;
    }
    const message = event.type === 'user/message' && event.data.source?.kind === 'user' ? event.data
      : event.type === 'assistant/message' ? event.data.message : undefined;
    if (!message) continue;
    const role = event.type === 'user/message' ? 'user' : 'assistant';
    if (role === 'user' && typeof message.id === 'string' && messageKey.test(message.id)) userId = message.id;
    const text = message.content?.filter(block => block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text.slice(0, 12000)).join('\n').trim();
    if (text) history.push({ role, text: text.slice(0, 12000), timestamp: event.time });
  }
  const recent = [];
  let bytes = 0;
  for (const message of history.slice(-48).reverse()) {
    bytes += Buffer.byteLength(message.text);
    if (bytes > 64000) break;
    recent.unshift(message);
  }
  return { checkpoint, history: recent };
}
