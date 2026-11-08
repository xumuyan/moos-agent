import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedHome } from './profile-home.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'moos-profile-preservation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const resources = join(root, 'resources');
  const data = join(root, 'data');
  const home = join(data, 'dsh');
  const template = join(resources, 'profile-template', 'profiles', 'web');
  await mkdir(template, { recursive: true });
  await writeFile(join(template, 'package.json'), '{"version":"new-template"}');
  return { resources, data, home };
}

test('first launch seeds profiles; updating the package and restarting preserves user files byte for byte', async t => {
  const { resources, data, home } = await fixture(t);
  await seedHome(resources, home);
  const files = new Map([
    ['dsh/profiles/web/package.json', '{"userPlugins":["custom-plugin"]}'],
    ['dsh/profiles/web/cordis.patch.yml', 'user-setting: keep\n'],
    ['dsh/sessions/session/events.jsonl', '{"message":"保留聊天记录"}\n'],
    ['dsh/skins/custom/skin.json', '{"skin":"keep"}'],
    ['providers.json', '{"model":"keep-model"}'],
    ['private/credentials.json', '{"test-only":"synthetic-not-a-real-key"}'],
    ['pi/sessions/conversation/session.jsonl', '{"context":"keep"}\n'],
    ['workspace/project/result.txt', 'user code\n'],
  ]);
  for (const [name, bytes] of files) {
    const path = join(data, name);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, bytes);
  }
  // An installed profile must not depend on the new package's seed template.
  await rm(join(resources, 'profile-template'), { recursive: true });
  for (let restart = 0; restart < 2; restart++) {
    await seedHome(resources, home);
    for (const [name, bytes] of files) assert.equal(await readFile(join(data, name), 'utf8'), bytes, name);
    assert.equal((await readdir(home)).some(name => name.startsWith('.profile-')), false);
  }
});

test('missing profiles with existing chat or settings stops instead of silently reseeding', async t => {
  for (const marker of ['dsh/sessions/history.jsonl', 'providers.json', 'private/credentials.json',
    'pi/moos.sqlite', 'pi-fixture/moos.sqlite', 'workspace/project/source.txt']) {
    await t.test(marker, async t => {
      const { resources, data, home } = await fixture(t);
      const path = join(data, marker);
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, 'existing user data');
      await assert.rejects(seedHome(resources, home), { code: 'MOOS_PROFILE_RECOVERY_REQUIRED' });
      assert.equal(await readFile(path, 'utf8'), 'existing user data');
      await assert.rejects(readFile(join(home, 'profiles', 'web', 'package.json')), { code: 'ENOENT' });
    });
  }
});

test('empty default workspace is compatible with a genuinely new profile', async t => {
  const { resources, data, home } = await fixture(t);
  await mkdir(join(data, 'workspace'), { recursive: true });
  await seedHome(resources, home);
  assert.match(await readFile(join(home, 'profiles/web/package.json'), 'utf8'), /new-template/);
});

test('invalid or linked profile directories are rejected without overwriting their targets', async t => {
  for (const kind of ['file', 'profile-link', 'home-link', 'missing-web', 'web-link']) {
    await t.test(kind, async t => {
      const { resources, data, home } = await fixture(t);
      const outside = join(data, 'outside');
      await mkdir(outside, { recursive: true });
      await writeFile(join(outside, 'keep'), 'unchanged');
      if (kind === 'home-link') await symlink(outside, home);
      else {
        await mkdir(home);
        if (kind === 'file') await writeFile(join(home, 'profiles'), 'unchanged');
        else if (kind === 'profile-link') await symlink(outside, join(home, 'profiles'));
        else {
          await mkdir(join(home, 'profiles'));
          if (kind === 'web-link') await symlink(outside, join(home, 'profiles/web'));
        }
      }
      await assert.rejects(seedHome(resources, home), { code: 'MOOS_PROFILE_RECOVERY_REQUIRED' });
      assert.equal(await readFile(join(outside, 'keep'), 'utf8'), 'unchanged');
    });
  }
});

test('failed initial copy leaves no published profiles or staging directory', async t => {
  const { resources, home } = await fixture(t);
  await rm(join(resources, 'profile-template'), { recursive: true });
  await assert.rejects(seedHome(resources, home), { code: 'ENOENT' });
  assert.deepEqual(await readdir(home), []);
});

test('the startup guard is wired before plugin upgrades and included in the application bundle', async () => {
  const main = await readFile(new URL('./main.mjs', import.meta.url), 'utf8');
  const build = await readFile(new URL('./prepare-local.mjs', import.meta.url), 'utf8');
  assert.match(main, /import \{ seedHome, profileRecoveryMessage \} from '\.\/profile-home\.mjs'/);
  assert.ok(main.indexOf('await seedHome(resources, home)') < main.indexOf('await updateShellPlugin(resources, home, cli)'));
  assert.match(main, /MOOS_PROFILE_RECOVERY_REQUIRED/);
  assert.match(main, /app\.setPath\('userData', data\)/);
  assert.match(main, /'dev\.moos\.agent\.electron'/);
  assert.match(build, /for \(const file of \[[^\]]*'profile-home\.mjs'/);
});
