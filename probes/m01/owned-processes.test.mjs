import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cleanupOwnedProcesses, processExists, waitForChildExit } from '../../scripts/owned-processes.mjs';

test('cleanup waits for every owned process to exit', { timeout: 5000 }, async () => {
  const app = spawn('/bin/sleep', ['20'], { stdio: 'ignore' });
  const host = spawn('/bin/sleep', ['20'], { stdio: 'ignore' });
  const appExited = once(app, 'exit');
  const hostExited = once(host, 'exit');
  try {
    const errors = await cleanupOwnedProcesses(app, appExited, [host.pid], 1000);
    assert.deepEqual(errors, []);
    assert.equal((await appExited)[1], 'SIGKILL');
    assert.equal((await hostExited)[1], 'SIGKILL');
    assert.equal(processExists(app.pid), false);
    assert.equal(processExists(host.pid), false);
  } finally {
    if (app.exitCode === null && app.signalCode === null) app.kill('SIGKILL');
    if (host.exitCode === null && host.signalCode === null) host.kill('SIGKILL');
  }
});

test('cleanup reports owned processes that do not exit', { timeout: 1000 }, async (context) => {
  const child = { pid: 424242, exitCode: null, signalCode: null, kill: () => true };
  const exited = new Promise(() => {});
  const kill = context.mock.method(process, 'kill', () => true);
  try {
    const errors = await cleanupOwnedProcesses(child, exited, [], 20);
    assert.equal(errors.length, 2);
    assert(errors.some(error => error.message.includes('packaged app')));
    assert(errors.some(error => error.message.includes('424242')));
  } finally {
    kill.mock.restore();
  }
});

test('child exit wait returns false at its deadline', async () => {
  assert.equal(await waitForChildExit(new Promise(() => {}), 20), false);
});

test('cleanup returns a rejected child exit as an error', async (context) => {
  const failure = new Error('child exit failed');
  const child = { pid: 424243, exitCode: null, signalCode: 'SIGKILL', kill: () => true };
  context.mock.method(process, 'kill', () => { const error = new Error('gone'); error.code = 'ESRCH'; throw error; });
  const errors = await cleanupOwnedProcesses(child, Promise.reject(failure), [], 20);
  assert.deepEqual(errors, [failure]);
});
