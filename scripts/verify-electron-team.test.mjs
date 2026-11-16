import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';

test('team renderer acceptance refuses production bundle before creating or launching QA copy', async () => {
  for (const scenario of ['success', 'blocked', 'stop', 'retry', 'attachments', 'stop-retry', 'interrupt-retry', 'shell-stop', 'unsupported']) {
    await assert.rejects(promisify(execFile)(process.execPath, ['scripts/verify-electron-team.mjs', '/Applications/沐码.app', scenario], {
      timeout: 10000, env: { ...process.env, NODE_OPTIONS: '' },
    }), error => error.code === 1 && /AssertionError/.test(error.stderr));
  }
  const source = await readFile(new URL('./verify-electron-team.mjs', import.meta.url), 'utf8');
  assert.ok(source.indexOf('assert.ok(resolve(inputApp)') < source.indexOf('const scratch ='));
  for (const condition of ['realpath(inputApp)', 'normalGUI: false', 'externalModel: false',
    'instrumentQaShutdown(main, { blockQuit })', 'parseQaShutdown(line)', 'report.shutdown', 'snapshotQaProcesses(child.pid)', 'failureProcesses', 'sleep(10000)',
    'modeClearDoesNotCancel', 'independentReadAndArtifact', 'ordinaryAfterClear',
    'explicitStopCancels', 'heldRequestClosed', 'noFalseDeliveryOrDownstream', 'nodeProjection',
    'retryRetainsModeAndGoal', 'freshParentAndRoleContexts', 'artifactInspectedNotRewritten',
    'historyReloadRestoresMemberProjection', 'historyReloadFileNavigation',
    'historyReloadNoModelReplayOrEventMutation', 'historyReloadDoesNotRestoreComposerMode',
    'renderer reload must not replay model requests', 'renderer reload must not append or mutate settled tasks/events',
    'Page.reload', 'memberFileIndexNavigation', 'structuredMemberDetails', 'downstreamBlockerDetails', 'noInventedStoppedReceipt', 'readableMemberLayout',
    'actualUploadsAndQueueAdmission', 'uploadBytesAndCaptainMemberReads', 'queuedModeImmutableAfterFutureSelection',
    'abruptOwnedQAFaultAndColdRunning', 'restartMarksInterruptedWithoutReplay', 'restartPreservesEventPrefixAndArtifact', 'uniquely bind copied QA Host before fault',
    'abrupt fault leaves nonterminal task for startup reconciliation', 'startup preserves prior event prefix',
    'saved team conversation selected', 'actualOwnedShellAndChildRunning', 'shellAndChildExitedAfterStop',
    'noPostStopShellWrite', 'actual sleep belongs to actual running shell',
    'shell must belong to this exact copied QA instance',
    'stoppedPartialArtifactNoAutoReplay', 'stoppedTaskHistoryUnchanged',
    'attachmentAdmissionFailureNoTask', 'invalid attachment submission must not reach model',
    "Promise.race([call('Page.close'), closed])", "assert.equal(child.exitCode, 0"]) assert.ok(source.includes(condition));
});

test('history reload opt-in is bounded to settled success/blocked before QA copy', async () => {
  const source = await readFile(new URL('./verify-electron-team.mjs', import.meta.url), 'utf8');
  const guard = source.match(/assert\.ok\(!historyReload[^\n]+/)[0];
  const { runInNewContext } = await import('node:vm');
  for (const scenario of ['success', 'blocked']) assert.doesNotThrow(() => runInNewContext(guard, { assert, historyReload: true, scenario }));
  for (const scenario of ['stop', 'retry', 'attachments', 'stop-retry', 'interrupt-retry', 'shell-stop']) {
    assert.throws(() => runInNewContext(guard, { assert, historyReload: true, scenario }), /History reload QA/);
    assert.doesNotThrow(() => runInNewContext(guard, { assert, historyReload: false, scenario }));
  }
  assert.ok(source.indexOf(guard) < source.indexOf('const scratch ='));
  assert.ok(source.includes('tasksAndEventsEqual: true, appRelaunched: false'));
});


test('active reload opt-in rejects unsupported scenarios before copying QA', async () => {
  const source = await readFile(new URL('./verify-electron-team.mjs', import.meta.url), 'utf8');
  const guard = source.match(/assert\.ok\(!activeReload[^\n]+/)[0];
  const { runInNewContext } = await import('node:vm');
  for (const scenario of ['stop', 'shell-stop']) assert.doesNotThrow(() => runInNewContext(guard, { assert, activeReload: true, scenario }));
  for (const scenario of ['success', 'blocked', 'retry', 'attachments', 'stop-retry', 'interrupt-retry']) {
    assert.throws(() => runInNewContext(guard, { assert, activeReload: true, scenario }), /Active reload QA/);
    assert.doesNotThrow(() => runInNewContext(guard, { assert, activeReload: false, scenario }));
  }
  assert.ok(source.indexOf(guard) < source.indexOf('const scratch ='));
  for (const check of ['activeReloadProjectionAndControls', 'activeReloadNoReplayOrEventMutation',
    'activeReloadOriginalWorkSurvives', 'original shell and direct child survive reload',
    'reload must not close active model response', 'active reload must not mutate tasks/events',
    'active reload must not duplicate model requests']) assert.ok(source.includes(check));
});

test('reported member usage QA is opt-in before copying and checks explicit unknown data', async () => {
  const source = await readFile(new URL('./verify-electron-team.mjs', import.meta.url), 'utf8');
  assert.ok(source.indexOf('Reported usage QA requires success or blocked') < source.indexOf("execFileSync('/usr/bin/ditto'"));
  const guard = source.match(/assert\.ok\(!reportedUsage[^\n]+/)[0];
  const { runInNewContext } = await import('node:vm');
  for (const scenario of ['success', 'blocked']) assert.doesNotThrow(() => runInNewContext(guard, { assert, reportedUsage: true, scenario }));
  for (const scenario of ['stop', 'retry', 'attachments', 'stop-retry', 'interrupt-retry', 'shell-stop']) {
    assert.throws(() => runInNewContext(guard, { assert, reportedUsage: true, scenario }), /Reported usage QA/);
    assert.doesNotThrow(() => runInNewContext(guard, { assert, reportedUsage: false, scenario }));
  }
  assert.match(source, /MOOS_QA_REPORTED_USAGE/);
  assert.match(source, /prompt_tokens: 10, completion_tokens: 2, total_tokens: 12/);
  assert.match(source, /reportedMemberUsageOrExplicitUnknown/);
  assert.match(source, /成员回复：未报告/);
});
