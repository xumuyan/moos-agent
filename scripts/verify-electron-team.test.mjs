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
    'instrumentQaShutdown(main)', 'parseQaShutdown(line)', 'report.shutdown', 'sleep(10000)',
    'modeClearDoesNotCancel', 'independentReadAndArtifact', 'ordinaryAfterClear',
    'explicitStopCancels', 'heldRequestClosed', 'noFalseDeliveryOrDownstream', 'nodeProjection',
    'retryRetainsModeAndGoal', 'freshParentAndRoleContexts', 'artifactInspectedNotRewritten',
    'structuredMemberDetails', 'downstreamBlockerDetails', 'noInventedStoppedReceipt', 'readableMemberLayout',
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
