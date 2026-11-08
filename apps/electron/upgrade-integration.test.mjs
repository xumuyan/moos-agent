import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Store } from '../../services/agent/store.mjs';
import { seedHome } from './profile-home.mjs';
import { updateShellPlugin } from './shell-update.mjs';

const cli = process.env.MOOS_ELECTRON_TEST_DSH_CLI;
const run = promisify(execFile);

test('the real packaged installer upgrades an isolated older shell without resetting chat, models, skins or user plugins', {
  skip: !cli && 'Requires MOOS_ELECTRON_TEST_DSH_CLI from the current isolated build', timeout: 90000,
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'moos-real-upgrade-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const resources = resolve(dirname(cli), '../..');
  const data = join(root, 'data');
  const home = join(data, 'dsh');
  await seedHome(resources, home);
  const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' };
  const stage = join(root, 'older-shell');
  await cp(fileURLToPath(new URL('./plugin/', import.meta.url)), stage, { recursive: true });
  const manifest = JSON.parse(await readFile(join(stage, 'package.json'), 'utf8'));
  manifest.version = '0.1.25';
  await writeFile(join(stage, 'package.json'), JSON.stringify(manifest));
  const packed = await run('npm', ['pack', stage, '--pack-destination', root, '--silent'], { env, timeout: 30000 });
  await run(cli, ['plugin', '--profile', 'web', 'add', join(root, packed.stdout.trim()), '--save-exact'], { env, timeout: 30000 });
  const addon = join(root, 'user-plugin');
  await mkdir(addon);
  await writeFile(join(addon, 'package.json'), JSON.stringify({ name: 'moos-upgrade-user-fixture', version: '1.0.0', main: 'index.js' }));
  await writeFile(join(addon, 'index.js'), 'exports.apply = function () {};');
  const plugin = await run('npm', ['pack', addon, '--pack-destination', root, '--silent'], { env, timeout: 30000 });
  await run(cli, ['plugin', '--profile', 'web', 'add', join(root, plugin.stdout.trim()), '--save-exact'], { env, timeout: 30000 });
  const sentinels = new Map([
    ['dsh/sessions/fixture/history.jsonl', '{"text":"isolated retained chat"}\n'],
    ['dsh/profiles/web/cordis.patch.yml', '[]\n'],
    ['dsh/skin-center-active.json', '{"active":"fixture","initialized":true}'],
    ['dsh/skins/fixture/skin.json', '{"name":"synthetic skin"}'],
    ['providers.json', '[{"id":"retained-model"}]'],
    ['private/credentials.json', '{"retained-model":"synthetic-test-key"}'],
    ['pi/sessions/fixture/session.jsonl', '{"context":"retained"}\n'],
    ['workspace/fixture/source.txt', 'retained source\n'],
  ]);
  for (const [name, bytes] of sentinels) {
    await mkdir(dirname(join(data, name)), { recursive: true });
    await writeFile(join(data, name), bytes, { mode: 0o600 });
  }
  const dbPath = join(data, 'pi/moos.sqlite');
  const store = new Store({ dbPath });
  const project = await store.addProject(join(data, 'workspace/fixture'));
  const conversation = store.createConversation(project.id, 'retained conversation');
  store.addMessage({ conversationId: conversation.id, role: 'user', content: 'retained message' });
  const messages = store.listMessages(conversation.id);
  store.close();
  const dbBytes = await readFile(dbPath);
  const profile = join(home, 'profiles/web/package.json');
  const before = JSON.parse(await readFile(profile, 'utf8'));
  await updateShellPlugin(resources, home, cli);
  const after = JSON.parse(await readFile(profile, 'utf8'));
  for (const [name, value] of Object.entries(before.dependencies)) {
    if (name !== 'moos-electron-shell') assert.equal(after.dependencies[name], value, name);
  }
  for (const [name, bytes] of sentinels) assert.equal(await readFile(join(data, name), 'utf8'), bytes, name);
  assert.deepEqual(await readFile(dbPath), dbBytes);
  const reopened = new Store({ dbPath });
  try { assert.deepEqual(reopened.listMessages(conversation.id), messages); }
  finally { reopened.close(); }
  const metadata = await readFile(profile);
  await seedHome(resources, home);
  await updateShellPlugin(resources, home, '/must-not-run-after-upgrade');
  assert.deepEqual(await readFile(profile), metadata);
});
