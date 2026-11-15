import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { configurePiSubmission } from './stage-dsh-runtime.cjs';
import { sessionModeMethods } from './pi-team-client.cjs';
import { submissionMode } from './plugin/pi-submission.js';

function modeSession() {
  const Session = runInNewContext(`(class { ${sessionModeMethods} })`, { randomUUID });
  return new Session();
}

test('client mode is per-session, snapshots at minting, and listeners do not execute or stop work', () => {
  const first = modeSession(), second = modeSession();
  let notified = 0;
  const unsubscribe = first.moosSubscribeMode(() => notified++);
  assert.equal(submissionMode(first.moosRequestId()), 'ordinary');
  first.moosSetMode('team');
  const queued = first.moosRequestId();
  first.moosSetMode('ordinary');
  assert.equal(submissionMode(queued), 'team');
  assert.equal(submissionMode(first.moosRequestId()), 'ordinary');
  assert.equal(second.moosMode(), 'ordinary');
  assert.equal(notified, 2);
  first.moosSetMode('ordinary'); assert.equal(notified, 2);
  unsubscribe(); first.moosSetMode('team'); assert.equal(notified, 2);
  assert.throws(() => first.moosSetMode('future'), /Unsupported/);
  second.address = { parentSessionId: 'parent' };
  assert.equal(second.moosCanSetMode(), false);
  assert.throws(() => second.moosSetMode('team'), /Unsupported/);
  assert.match(second.moosRequestId(), /^[a-f0-9-]{36}$/);
});

const cli = process.env.MOOS_ELECTRON_TEST_DSH_CLI;
test('pinned client beginSubmission preserves echo/admission/upload identity across mode changes', {
  skip: !cli && 'Requires isolated packaged DSH client',
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'muma-mode-client-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const relative = 'node_modules/@deepseek-ai/dsh-api-session-controller/lib/client.js';
  const source = await readFile(resolve(dirname(cli), '../dsh', relative), 'utf8');
  const target = join(root, relative);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, source);
  // New packages are already patched; old pinned packages exercise staging too.
  if (!source.includes('moosRequestId()')) configurePiSubmission(root);
  const patched = await readFile(target, 'utf8');
  const begin = patched.slice(patched.indexOf('beginSubmission(input) {'), patched.indexOf('\n\t\t\t/**\n\t\t\t* Send (queue/steer'));
  const prompt = patched.slice(patched.indexOf('async prompt(content, mode, signal, requestId) {'),
    patched.indexOf('\n\t\t\t/**\n\t\t\t* Apply the Host\'s acceptance'));
  assert.ok(begin.length > 500 && prompt.length > 1000, 'pinned method boundaries must exist');
  const Session = runInNewContext(`(class { ${sessionModeMethods}\n${begin}\n${prompt} })`, {
    randomUUID, resolvedClientTimeZone: () => 'Asia/Shanghai',
  });
  const session = new Session();
  const admitted = [], accepted = [], retired = [];
  session.sessionId = 'client-team'; session.running = true; session.blankBit = false;
  session.pendingSubmissions = []; session.submissionSettlements = new Map();
  session.remote = { session: { prompt: async request => { admitted.push(request); return { ok: true }; } } };
  session.acceptPrompt = requestId => accepted.push(requestId);
  session.retireFailedSubmission = requestId => retired.push(requestId);
  session.moosSetMode('team');
  const attachment = { id: 'upload-one', filename: 'sample.txt' };
  const echo = session.beginSubmission({ mode: 'queue', text: 'goal', attachments: [attachment] });
  const settlement = session.submissionSettlements.get(echo.requestId);
  assert.equal(settlement.placement, 'queued');
  session.moosSetMode('ordinary');
  const content = [{ type: 'text', text: 'goal' }, { type: 'file', ...attachment }];
  await session.prompt(content, 'queue', undefined, echo.requestId);
  assert.equal(submissionMode(admitted[0].requestId), 'team');
  assert.equal(admitted[0].requestId, session.pendingSubmissions[0].requestId);
  assert.equal(admitted[0].content[1].id, attachment.id);
  assert.equal(accepted[0], echo.requestId);
  echo.abandon(); assert.equal(retired[0], echo.requestId);
  await session.prompt(content, 'queue');
  assert.equal(submissionMode(admitted[1].requestId), 'ordinary');
  const retry = 'moos-pi-retry:original-task:' + randomUUID();
  session.moosSetMode('team');
  await session.prompt(content, 'queue', undefined, retry);
  assert.equal(admitted[2].requestId, retry, 'explicit retry is never reminted');
  await session.prompt(content, 'queue', undefined, 'historical-id');
  assert.equal(admitted[3].requestId, 'historical-id');
});
