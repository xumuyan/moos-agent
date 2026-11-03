import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createFixture } from './pi-fixture.mjs';

export async function probePi(options) {
  const fixture = await createFixture(options);
  const { rpc } = fixture;
  const stop = async () => { await fixture.close(); process.exit(143); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  const parent = process.ppid;
  const watchdog = setInterval(() => {
    if (process.ppid !== parent) void stop();
  }, 500);
  watchdog.unref();
  try {
    const state = await rpc.request('get_state');
    assert.equal(state.data.model.id, 'fixture');
    await rpc.request('prompt', { message: 'Read fixture.txt and report the result.' });
    await rpc.waitEvent(record => record.type === 'agent_settled');
    assert(rpc.events.some(record => record.type === 'tool_execution_end' && !record.isError));
    assert(rpc.events.some(record => record.type === 'message_update' &&
      record.assistantMessageEvent?.type === 'text_delta'));
    const messages = await rpc.request('get_messages');
    assert(JSON.stringify(messages.data).includes('M01_READ_OK'));
    assert(JSON.stringify(messages.data).includes('M01_DONE'));
    const before = rpc.events.length;
    await rpc.request('prompt', { message: 'M01_HOLD' });
    await rpc.waitEvent(record => record.type === 'message_update', 15000, before);
    await options?.onHold?.({ pid: rpc.child.pid });
    await rpc.request('abort');
    const stopped = await rpc.request('get_state');
    assert.equal(stopped.data.isStreaming, false);
    return { status: 'passed', mode: 'rpc', provider: 'local-fixture',
      piVersion: '1.5.0', checks: ['state', 'stream', 'read-tool', 'abort', 'process-exit'],
      requests: fixture.requestCount(), realProviderVerified: false };
  } finally {
    clearInterval(watchdog);
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    await fixture.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await probePi({
      node: process.env.MOOS_PROBE_NODE ?? process.execPath,
      cli: process.env.MOOS_PROBE_PI_CLI,
    });
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
