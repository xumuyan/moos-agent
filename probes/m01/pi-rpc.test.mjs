import test from 'node:test';
import assert from 'node:assert/strict';
import { probePi } from './pi-probe.mjs';
import { createFixture } from './pi-fixture.mjs';

test('real PI RPC streams, reads a fixture file, aborts and exits against a local model fixture',
  { timeout: 45000 }, async () => {
    const result = await probePi();
    assert.equal(result.status, 'passed');
    assert.equal(result.realProviderVerified, false);
    assert.equal(result.requests, 3);
  });

test('PI RPC rejects unsupported commands and pending requests after child exit',
  { timeout: 20000 }, async () => {
    const fixture = await createFixture();
    try {
      await fixture.rpc.request('get_state');
      await assert.rejects(fixture.rpc.request('m01_not_a_command'));
      await fixture.rpc.close();
      await assert.rejects(fixture.rpc.request('get_state'), /exited/);
      assert.equal(fixture.rpc.pending.size, 0);
    } finally { await fixture.close(); }
  });

for (const signal of ['SIGTERM', 'SIGKILL']) {
  test(`probe host ${signal} does not leave its active PI child running`,
    { timeout: 20000 }, async () => {
      const { spawn } = await import('node:child_process');
      const { once } = await import('node:events');
      const { createInterface } = await import('node:readline');
      const { setTimeout: delay } = await import('node:timers/promises');
      const host = spawn(process.execPath, ['--input-type=module', '-e', `
        import { probePi } from './probes/m01/pi-probe.mjs';
        await probePi({ onHold: async ({ pid }) => {
          console.log(pid);
          await new Promise(() => {});
        } });
      `], { stdio: ['ignore', 'pipe', 'pipe'] });
      const lines = createInterface({ input: host.stdout });
      let piPid;
      const exited = once(host, 'exit');
      try {
        const [line] = await once(lines, 'line');
        piPid = Number(line);
        assert(piPid > 0);
        host.kill(signal);
        const [code, exitSignal] = await exited;
        if (signal === 'SIGTERM') assert.equal(code, 143);
        else assert.equal(exitSignal, 'SIGKILL');
        let alive = true;
        for (let i = 0; i < 100; i++) {
          try { process.kill(piPid, 0); } catch (error) {
            if (error.code !== 'ESRCH') throw error;
            alive = false; break;
          }
          await delay(20);
        }
        assert.equal(alive, false, 'PI child must exit after its host terminates');
      } finally {
        lines.close();
        if (host.exitCode === null && host.signalCode === null) host.kill('SIGKILL');
        if (piPid) { try { process.kill(piPid, 'SIGKILL'); } catch {} }
      }
    });
}
