import { cp, lstat, mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const profileRecoveryMessage = '检测到已有 沐码数据，但工作台配置目录缺失或异常。为保护聊天记录和配置，已停止初始化；请恢复原配置或联系维护者，不要删除应用数据目录。';

function recoveryRequired() {
  return Object.assign(new Error(profileRecoveryMessage), { code: 'MOOS_PROFILE_RECOVERY_REQUIRED' });
}
async function inspect(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

// Package updates must never reseed an existing home. An incomplete home is a
// recovery case, not permission to replace it with the shipped defaults.
export async function seedHome(resources, home) {
  const previous = await inspect(home);
  if (previous && (!previous.isDirectory() || previous.isSymbolicLink())) throw recoveryRequired();
  const profiles = join(home, 'profiles');
  const existing = await inspect(profiles);
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink()) throw recoveryRequired();
    const web = await inspect(join(profiles, 'web'));
    if (!web?.isDirectory() || web.isSymbolicLink()) throw recoveryRequired();
    return;
  }
  if (previous && (await readdir(home)).length) throw recoveryRequired();
  const data = dirname(home);
  for (const name of ['providers.json', 'private', 'pi', 'pi-fixture']) {
    if (await inspect(join(data, name))) throw recoveryRequired();
  }
  const workspace = join(data, 'workspace');
  const workspaceInfo = await inspect(workspace);
  if (workspaceInfo && (!workspaceInfo.isDirectory() || workspaceInfo.isSymbolicLink()
    || (await readdir(workspace)).length)) throw recoveryRequired();

  await mkdir(home, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(home, '.profile-'));
  try {
    await cp(join(resources, 'profile-template', 'profiles'), join(staging, 'profiles'), {
      recursive: true, verbatimSymlinks: true,
    });
    await rename(join(staging, 'profiles'), profiles);
  } finally { await rm(staging, { recursive: true, force: true }); }
}
