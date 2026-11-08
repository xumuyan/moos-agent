import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { startHost, parseBootstrap } from './host.mjs';
import { apply as applyShell } from './plugin/host.js';

const token = 'fake-local-bootstrap-token-only';
const line = `dsh web: http://127.0.0.1:43123/?token=${token}`;

test('accepts only the local authenticated workbench bootstrap', () => {
  assert.equal(parseBootstrap(line)?.origin, 'http://127.0.0.1:43123');
  for (const invalid of [
    line.replace('127.0.0.1', '127.0.0.1.example.test'),
    line.replace('127.0.0.1:43123', '127.0.0.1'),
    line.replace(':43123', ':0'),
    line.replace('token=', 'other='),
    line + '&token=duplicate',
    line + '#fragment',
    'ordinary stdout',
  ]) assert.equal(parseBootstrap(invalid), null);
});

async function hostFixture(t, source) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'moos-electron-host-test-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cli = join(dir, 'fixture');
  await writeFile(cli, `#!/usr/bin/env node\n${source}\n`, { mode: 0o700 });
  return { cli, home: dir, cwd: dir, executionPatch: join(dir, 'execution.patch.yml') };
}

test('runs the host on loopback and waits for its actual shutdown', async t => {
  const config = await hostFixture(t, `
    if (process.argv.slice(2).join(' ') !==
        'web --patch ' + process.cwd() + '/execution.patch.yml --host 127.0.0.1 --port 0 --no-open'
        || process.env.DSH_HOME !== process.cwd() || process.env.MOOS_ELECTRON_WORKSPACE_ROOT !== process.cwd()
        || process.env.DSH_TELEMETRY_DISABLED !== '1' || process.env.PI_OFFLINE !== '1'
        || process.env.MOOS_ELECTRON_PARENT_PIPE !== '1'
        || process.env.TMPDIR !== process.cwd() + '/host-tmp'
        || process.env.MOOS_ELECTRON_PI_RUNTIME) process.exit(8);
    console.log('dsh web: http://example.test:43123/?token=${token}');
    console.log(${JSON.stringify(line)});
    setInterval(() => {}, 1000);
  `);
  const host = startHost({ ...config, tempDir: join(config.cwd, 'host-tmp'), timeoutMs: 2000,
    onUnexpectedExit: () => assert.fail('intentional stop must not be reported as a crash') });
  t.after(() => host.stop());
  assert.equal((await host.ready).searchParams.get('token'), token);
  const stopping = host.stop();
  assert.equal(host.stop(), stopping);
  await stopping;
});

test('the opt-in fixture runs inside the existing host with its own model overlay', async t => {
  const config = await hostFixture(t, `
    const fixture = process.cwd() + '/fixture';
    if (process.env.MOOS_ELECTRON_PI_RUNTIME !== fixture ||
        process.argv.slice(5, 7).join(' ') !== '--patch ' + fixture + '/profile.patch.yml') process.exit(8);
    console.log(${JSON.stringify(line)});
    setInterval(() => {}, 1000);
  `);
  const host = startHost({ ...config, piFixture: join(config.home, 'fixture'), timeoutMs: 2000 });
  t.after(() => host.stop());
  assert.equal((await host.ready).origin, 'http://127.0.0.1:43123');
});

test('the shell never exposes or dispatches upstream model tool calls', async () => {
  let executor;
  const unregister = () => {};
  await applyShell({
    effect: setup => assert.equal(setup(), unregister),
    tools: { setExecutor(value) { executor = value; return unregister; } },
  });
  assert.deepEqual(executor.describe([{ name: 'bash' }]), { schemas: [], knownNames: [] });
  await assert.rejects(executor.execute({ calls: [{ name: 'bash' }] }), /由 PI 执行/);
});

const dshCli = process.env.MOOS_ELECTRON_TEST_DSH_CLI;
test('the packaged Host starts and restarts with only loopback sockets and no account or model configured', {
  skip: (!dshCli || process.platform !== 'darwin') && 'Requires the pinned macOS Moos package',
}, async t => {
  const { home } = await hostFixture(t, '');
  const resources = join(dirname(dshCli), '..', '..');
  const workspace = join(home, 'workspace');
  const profile = join(home, 'loopback.sb');
  await mkdir(workspace);
  await cp(join(resources, 'profile-template', 'profiles'), join(home, 'profiles'), {
    recursive: true, verbatimSymlinks: true,
  });
  await writeFile(profile, [
    '(version 1)', '(allow default)', '(deny network*)',
    '(allow network-inbound (local ip "localhost:*"))',
    '(allow network-bind (local ip "localhost:*"))',
    '(allow network-outbound (remote ip "localhost:*"))',
  ].join('\n'));
  await promisify(execFile)('/usr/bin/sandbox-exec', ['-f', profile, process.execPath, '-e', `
    const socket = require('node:net').connect(443, '203.0.113.1');
    socket.once('error', error => { process.exitCode = error.code === 'EPERM' ? 0 : 1; });
    socket.once('connect', () => { socket.destroy(); process.exitCode = 1; });
    socket.setTimeout(1000, () => { socket.destroy(); process.exitCode = 1; });
  `]);

  for (let pass = 0; pass < 2; pass++) {
    const child = spawn('/usr/bin/sandbox-exec', ['-f', profile, dshCli,
      'web', '--patch', join(resources, 'execution.patch.yml'), '--host', '127.0.0.1', '--port', '0', '--no-open'], {
      cwd: workspace, stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', PI_OFFLINE: '1',
        MOOS_ELECTRON_PARENT_PIPE: '1', MOOS_ELECTRON_WORKSPACE_ROOT: workspace,
        MOOS_ELECTRON_PI_RUNTIME: join(resources, 'pi-runtime') },
    });
    const exited = once(child, 'exit');
    const lines = createInterface({ input: child.stdout });
    const signal = AbortSignal.timeout(12000);
    const timeout = once(signal, 'abort').then(() => { throw signal.reason; });
    const ready = (async () => {
      for await (const line of lines) {
        const address = parseBootstrap(line);
        if (address) return address;
      }
      throw new Error('Restricted Moos Host exited before publishing its address');
    })();
    try {
      const address = await Promise.race([ready, timeout]);
      const bootstrap = await fetch(address, { redirect: 'manual', signal });
      assert.ok([302, 303].includes(bootstrap.status));
      const destination = new URL(bootstrap.headers.get('location'), address);
      assert.equal(destination.origin, address.origin);
      const cookies = bootstrap.headers.getSetCookie().map(value => value.split(';', 1)[0]);
      assert.ok(cookies.length > 0);
      await bootstrap.body?.cancel();
      const response = await fetch(destination, { headers: { cookie: cookies.join('; ') }, redirect: 'manual', signal });
      assert.equal(response.status, 200);
      assert.match(await response.text(), /<html\b/i);
      child.stdin.end();
      assert.deepEqual(await Promise.race([exited, timeout]), [0, null]);
    } finally {
      lines.close();
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
    }
  }
});

test('the packaged Host stops when its desktop lifetime pipe closes', {
  skip: !dshCli && 'Set MOOS_ELECTRON_TEST_DSH_CLI to the pinned Moos DSH CLI',
}, async t => {
  const { home } = await hostFixture(t, '');
  const overlay = fileURLToPath(new URL('./execution.patch.yml', import.meta.url));
  const child = spawn(dshCli, ['web', '--patch', overlay, '--host', '127.0.0.1', '--port', '0', '--no-open'], {
    cwd: home, env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', MOOS_ELECTRON_PARENT_PIPE: '1' },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const exited = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
  });
  const lines = createInterface({ input: child.stdout });
  t.after(() => lines.close());
  const wait = AbortSignal.timeout(10000);
  let line;
  do { [line] = await once(lines, 'line', { signal: wait }); } while (!parseBootstrap(line));
  child.stdin.end();
  assert.deepEqual(await once(child, 'exit', { signal: wait }), [0, null]);
});

test('the shipped DSH overlay disables optional built-ins and keeps the package installer', {
  skip: !dshCli && 'Set MOOS_ELECTRON_TEST_DSH_CLI to the pinned DSH CLI',
}, async t => {
  const { home } = await hostFixture(t, '');
  const overlay = fileURLToPath(new URL('./execution.patch.yml', import.meta.url));
  await writeFile(join(home, 'cordis.patch.yml'), `
- id: llm-deepseek
  disabled: false
- id: tool-executor-native
  disabled: false
- id: schedule
  disabled: false
- id: job-controller
  disabled: false
- id: terminal-controller
  disabled: false
- id: ui-settings-plugin-inventory
  disabled: false
- id: cordis-host-runner
  disabled: false
- id: ptc-runtime
  disabled: false
`);
  const { stdout } = await promisify(execFile)(dshCli, ['web', '--patch', overlay, '--dump-config'], {
    env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
  });
  const rows = new Map(stdout.split(/^- id: /m).slice(1).map(row => {
    const end = row.indexOf('\n');
    return [row.slice(0, end), row.slice(end + 1)];
  }));
  for (const id of ['llm-deepseek', 'llm-deepseek-account', 'llm-pi-ai',
    'tool-executor-native', 'tool-executor-ptc', 'schedule', 'ui-schedule', 'job-controller', 'ui-jobs',
    'cordis-host-runner', 'cordis-client-runner', 'cordis-inspect-providers', 'ui-cordis', 'ptc-runtime',
    'harness-dev-context',
    'terminal-controller', 'ui-sidebar-terminal', 'ui-sidebar-browser', 'office-to-pdf',
    'web-search-deepseek', 'mcp-resources', 'ui-settings-plugin-inventory', 'ui-settings-plugins', 'directory-picker']) {
    assert.match(rows.get(id) ?? '', /^  disabled: true$/m, id);
  }
  for (const id of ['plugin-manager', 'ui-plugin-manager', 'ui-sidebar', 'ui-sidebar-files', 'ui-conversation',
    'moos-directory-picker-browse', 'moos-directory-picker-browser-ui']) {
    assert.ok(rows.has(id), id);
    assert.doesNotMatch(rows.get(id), /^  disabled: true$/m, id);
  }
  for (const id of ['standard', 'ptc', 'minimal', 'cordis']) {
    const preset = rows.get('preset-' + id) ?? '';
    assert.ok(preset.includes('    id: ' + id + '\n'));
    assert.match(preset, /^    plugins: \[\]$/m);
  }
});

test('rejects a host that exits before announcing a usable URL', async t => {
  const config = await hostFixture(t, 'process.exit(1)');
  const host = startHost({ ...config, timeoutMs: 2000 });
  t.after(() => host.stop());
  await assert.rejects(host.ready, /启动失败/);
});
