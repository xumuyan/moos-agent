import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sampleQaProcess } from './team-qa-shutdown.mjs';

const supported = process.platform === 'darwin';
test('actual macOS sample recognizes known fixture function frames without exporting raw sample',
  { skip: !supported && 'macOS /usr/bin/sample calibration only', timeout: 30000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'muma-native-calibration-'));
    let child, closed, samplePath;
    try {
      assert.equal((await stat(directory)).mode & 0o777, 0o700);
      const executable = join(directory, 'calibration');
      const source = fileURLToPath(new URL('./fixtures/qa-native-boundary.cc', import.meta.url));
      await promisify(execFile)('/usr/bin/clang++', ['-O0', '-g', '-fno-omit-frame-pointer',
        '-fno-optimize-sibling-calls', source, '-o', executable], { timeout: 10000, maxBuffer: 1024 * 1024 });
      for (const positive of [true, false]) {
        child = spawn(executable, positive ? [] : ['plain'], { stdio: ['pipe', 'pipe', 'ignore'] });
        closed = once(child, 'exit');
        const ready = await Promise.race([
          once(child.stdout, 'data').then(([bytes]) => bytes.toString()),
          closed.then(() => { throw new Error('Calibration exited before readiness'); }),
        ]);
        assert.match(ready, /^ready\n/);
        const result = await sampleQaProcess(child, async (command, args, options) => {
          assert.equal(command, '/usr/bin/sample');
          assert.deepEqual(args.slice(0, 4), [String(child.pid), '1', '10', '-file']);
          assert.equal(options.timeout, 3000); assert.equal(options.maxBuffer, 2097152);
          samplePath = args[4];
          assert.equal((await stat(samplePath)).mode & 0o777, 0o600);
          assert.equal((await stat(join(samplePath, '..'))).mode & 0o777, 0o700);
          return promisify(execFile)(command, args, options);
        });
        assert.equal(result.status, 'observed');
        assert.deepEqual(result.boundary, {
          idleLoop: positive, singletonCleanup: positive, nodeTeardown: positive,
          browserContextTeardown: positive, chromiumShutdown: positive,
          launchServicesCheckOut: false, synchronousXpc: false, processExit: false,
        });
        assert.doesNotMatch(JSON.stringify(result), /0x|private|Process:|Path:|Thread_|node::|ElectronBrowser/);
        await assert.rejects(stat(samplePath), { code: 'ENOENT' });
        // Positive classification must not itself terminate or advance the process.
        assert.equal(child.exitCode, null); assert.equal(child.signalCode, null);
        child.stdin.end('release');
        const [exitCode, signal] = await closed;
        assert.equal(exitCode, 0); assert.equal(signal, null);
      }
    } finally {
      // Only our exact fixture child; teardown cannot be reported as normal exit.
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL'); await closed;
      }
      await rm(directory, { recursive: true, force: true });
    }
    await assert.rejects(stat(directory), { code: 'ENOENT' });
  });
