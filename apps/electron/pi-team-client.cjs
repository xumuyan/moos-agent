// Injected into the pinned Session class, before beginSubmission. The same ID
// is used by admission, local echo, attachment retirement and the Host message.
function moosCanSetMode() { return this.address === undefined; }
function moosMode() { return this.moosSubmissionMode ?? 'ordinary'; }
function moosSetMode(mode) {
  if (!['ordinary', 'team'].includes(mode) || this.address !== undefined) throw new Error('Unsupported task mode');
  if (this.moosMode() === mode) return;
  this.moosSubmissionMode = mode;
  for (const notify of this.moosModeListeners ?? []) notify();
}
function moosSubscribeMode(notify) {
  this.moosModeListeners ??= new Set();
  this.moosModeListeners.add(notify);
  return () => this.moosModeListeners.delete(notify);
}
function moosRequestId() {
  const id = randomUUID();
  return this.address === undefined ? `moos-pi-mode:v1:${this.moosMode()}:${id}` : id;
}
const methods = [moosCanSetMode, moosMode, moosSetMode, moosSubscribeMode, moosRequestId];
module.exports = { sessionModeMethods: methods.map(fn => fn.toString().replace(/^function /, '')).join('\n') };
