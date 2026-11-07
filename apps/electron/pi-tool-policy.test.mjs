import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { workspaceTools } from '../../packages/pi-runtime/tool-policy.mjs';

test('confined macOS shells can run npm tests and Git without exposing adjacent files', {
  skip: process.platform !== 'darwin',
}, async t => {
  const data = await realpath(await mkdtemp(join(tmpdir(), 'moos-pi-toolchain-')));
  t.after(() => rm(data, { recursive: true, force: true }));
  const root = join(data, "toolchain ' project");
  await mkdir(root);
  await writeFile(join(data, 'private.txt'), 'outside');
  await writeFile(join(root, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test verify.mjs' } }));
  const fixture = `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
assert.throws(() => readFileSync('../private.txt'), { code: 'EPERM' });
`;
  await writeFile(join(root, 'verify.mjs'), fixture);
  const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  git('add', '.');
  await writeFile(join(root, 'verify.mjs'), fixture + 'assert.equal(2 + 2, 4);\n');
  let mode = 'workspace-write';
  const shell = workspaceTools(root, { getMode: () => mode }).find(tool => tool.name === 'bash');
  const run = command => shell.execute('toolchain-test', { command, timeout: 10 }, new AbortController().signal);
  for (const command of ['npm test', 'git diff --check', 'git status --short']) {
    const result = await run(command);
    assert.equal(result.structuredContent.exit_code, 0, result.content[0].text);
  }
  assert.equal(git('ls-files', '--others', '--exclude-standard'), '');
  mode = 'read-only';
  assert.equal((await run('git diff --check')).structuredContent.exit_code, 0);
  assert.equal((await run('git add verify.mjs')).isError, true);
});

test('PI file tools honor live permission, deny outside links and support project writes', async t => {
  const data = await realpath(await mkdtemp(join(tmpdir(), 'moos-pi-policy-')));
  t.after(() => rm(data, { recursive: true, force: true }));
  const root = join(data, 'project');
  await mkdir(root);
  const outside = join(data, 'outside.txt');
  await writeFile(outside, 'outside');
  await symlink(outside, join(root, 'escape.txt'));
  await symlink(join(data, 'missing.txt'), join(root, 'dangling.txt'));
  let mode = 'workspace-write';
  const tools = new Map(workspaceTools(root, { getMode: () => mode }).map(tool => [tool.name, tool]));
  assert.deepEqual([...tools.keys()], ['read', 'write', 'edit', 'ls', 'bash']);
  const run = (name, input) => tools.get(name).execute('fixture', input, new AbortController().signal);

  await run('write', { path: 'nested/result.txt', content: 'inside' });
  assert.equal(await readFile(join(root, 'nested/result.txt'), 'utf8'), 'inside');
  await assert.rejects(run('read', { path: 'escape.txt' }), /工作区/);
  await assert.rejects(run('write', { path: 'escape.txt', content: 'changed' }), /工作区/);
  await assert.rejects(run('write', { path: 'dangling.txt', content: 'changed' }));
  assert.equal(await readFile(outside, 'utf8'), 'outside');
  await assert.rejects(readFile(join(data, 'missing.txt')), { code: 'ENOENT' });
  mode = 'read-only';
  await assert.rejects(run('write', { path: 'nested/result.txt', content: 'changed' }), /只读/);
  mode = 'danger-full-access';
  await run('write', { path: outside, content: 'allowed' });
  assert.equal(await readFile(outside, 'utf8'), 'allowed');
});

test('macOS confines PI bash and releases only explicitly approved commands', {
  skip: process.platform !== 'darwin',
}, async t => {
  const data = await realpath(await mkdtemp(join(tmpdir(), 'moos-pi-shell-policy-')));
  t.after(() => rm(data, { recursive: true, force: true }));
  const root = join(data, "quoted ' project");
  await mkdir(root);
  const outside = join(data, 'outside.txt');
  await writeFile(outside, 'outside');
  await symlink(outside, join(root, 'escape.txt'));
  let requests = 0;
  const network = createServer((_req, res) => { requests++; res.end('ok'); });
  await new Promise(resolve => network.listen(0, '127.0.0.1', resolve));
  t.after(() => { network.closeAllConnections(); return new Promise(resolve => network.close(resolve)); });
  const url = 'http://127.0.0.1:' + network.address().port;
  let mode = 'workspace-write';
  let answer = 'rejected';
  let count = 0;
  const tools = new Map(workspaceTools(root, {
    getMode: () => mode,
    async approve({ command }) { count++; assert.equal(command, 'printf approved > ../outside.txt'); return answer; },
  }).map(tool => [tool.name, tool]));
  const run = (name, command, signal = new AbortController().signal) =>
    tools.get(name).execute('fixture', { command, timeout: 5 }, signal);

  const denied = async command => assert.equal((await run('bash', command)).isError, true);
  assert.equal((await run('bash', 'printf inside > result.txt; /bin/cat result.txt')).isError, undefined);
  assert.equal(await readFile(join(root, 'result.txt'), 'utf8'), 'inside');
  await denied('printf changed > ../outside.txt');
  await denied('printf changed > escape.txt');
  await denied('/bin/cat ../outside.txt');
  await denied('/usr/bin/curl --fail --silent --max-time 1 ' + url);
  assert.equal(requests, 0);
  mode = 'read-only';
  await denied('printf changed > result.txt');
  assert.equal(await readFile(join(root, 'result.txt'), 'utf8'), 'inside');
  const request = 'printf approved > ../outside.txt';
  await assert.rejects(run('bash_escalated', request), /未获得/);
  assert.equal(await readFile(outside, 'utf8'), 'outside');
  answer = 'allowed-once';
  await assert.rejects(run('bash_escalated', request, AbortSignal.abort()));
  assert.equal(await readFile(outside, 'utf8'), 'outside');
  await run('bash_escalated', request);
  assert.equal(count, 2);
  assert.equal(await readFile(outside, 'utf8'), 'approved');
  await denied('printf changed > ../outside.txt');
  mode = 'danger-full-access';
  await run('bash', '/usr/bin/curl --fail --silent --max-time 1 ' + url);
  assert.equal(requests, 1);
});
