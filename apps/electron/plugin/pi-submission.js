// Versioned mode snapshot carried by DSH's persisted per-message request ID.
// Queue delivery never consults mutable conversation/UI state. This is routing
// metadata, not an authorization token: normal Host permissions still apply.
const requestPattern = /^moos-pi-mode:v1:(ordinary|team):[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function submissionMode(requestId) {
  if (typeof requestId !== 'string' || !requestId.startsWith('moos-pi-mode:')) return 'ordinary';
  const match = requestPattern.exec(requestId);
  const mode = match?.[1];
  if (!mode || match[0] !== requestId) throw new Error('Unsupported PI submission mode');
  return mode;
}

export function checkedTaskMode(mode = 'ordinary') {
  if (mode !== 'ordinary' && mode !== 'team') throw new Error('Unsupported PI task mode');
  return mode;
}

export function previousTaskMode(store, taskId) {
  const snapshot = store.lastTaskEvent(taskId, 'task_submission');
  // Historical tasks predate this protocol and remain ordinary.
  if (snapshot === undefined) return 'ordinary';
  if (!snapshot || typeof snapshot !== 'object' || snapshot.version !== 1 ||
      !['ordinary', 'team'].includes(snapshot.mode)) throw new Error('Unsupported PI submission snapshot');
  return checkedTaskMode(snapshot.mode);
}
