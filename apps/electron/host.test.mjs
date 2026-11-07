import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
        || process.env.DSH_TELEMETRY_DISABLED !== '1') process.exit(8);
    console.log('dsh web: http://example.test:43123/?token=${token}');
    console.log(${JSON.stringify(line)});
    setInterval(() => {}, 1000);
  `);
  const host = startHost({ ...config, timeoutMs: 2000,
    onUnexpectedExit: () => assert.fail('intentional stop must not be reported as a crash') });
  t.after(() => host.stop());
  assert.equal((await host.ready).searchParams.get('token'), token);
  const stopping = host.stop();
  assert.equal(host.stop(), stopping);
  await stopping;
});

test('the shell never exposes or dispatches upstream model tool calls', async () => {
  let executor;
  const unregister = () => {};
  applyShell({
    effect: setup => assert.equal(setup(), unregister),
    tools: { setExecutor(value) { executor = value; return unregister; } },
  });
  assert.deepEqual(executor.describe([{ name: 'bash' }]), { schemas: [], knownNames: [] });
  await assert.rejects(executor.execute({ calls: [{ name: 'bash' }] }), /由 PI 执行/);
});

const dshCli = process.env.MOOS_ELECTRON_TEST_DSH_CLI;
test('the shipped DSH overlay wins over saved settings and keeps historical preset IDs', {
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
`);
  const { stdout } = await promisify(execFile)(dshCli, ['web', '--patch', overlay, '--dump-config'], {
    env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
  });
  const rows = new Map(stdout.split(/^- id: /m).slice(1).map(row => {
    const end = row.indexOf('\n');
    return [row.slice(0, end), row.slice(end + 1)];
  }));
  for (const id of ['llm-deepseek', 'llm-deepseek-account', 'llm-pi-ai',
    'tool-executor-native', 'tool-executor-ptc', 'schedule', 'ui-schedule']) {
    assert.match(rows.get(id) ?? '', /^  disabled: true$/m, id);
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
