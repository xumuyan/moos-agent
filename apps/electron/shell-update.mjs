import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const shellUpdateMessage = 'Moos 内置壳升级未完成，已停止启动。请保留原聊天和配置目录，联系维护者检查；不要删除用户数据或用默认配置覆盖。';
const shell = 'moos-electron-shell';
const manifest = 'profiles/web/node_modules/' + shell + '/package.json';
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function invalid(code) {
  return Object.assign(new Error(shellUpdateMessage), { code });
}
async function readVersion(root, code) {
  try {
    const path = join(root, manifest);
    const info = await lstat(path);
    if (!info.isFile() || info.size > 64 * 1024) throw new Error();
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (value.name !== shell || typeof value.version !== 'string' || !versionPattern.test(value.version)
      || !value.version.split('.').every(part => Number.isSafeInteger(Number(part)))) throw new Error();
    return value.version;
  } catch { throw invalid(code); }
}
function compare(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  return 0;
}

// Only the existing plugin installer may update shell dependency metadata.
// Missing installed metadata is recovery, never consent to reinstall defaults.
export async function updateShellPlugin(resources, home, cli) {
  const template = join(resources, 'profile-template');
  const version = await readVersion(template, 'MOOS_SHELL_UPDATE_FAILED');
  const installed = await readVersion(home, 'MOOS_PROFILE_RECOVERY_REQUIRED');
  if (installed === version) return;
  if (compare(installed, version) > 0) throw invalid('MOOS_SHELL_UPDATE_FAILED');
  const archive = join(template, 'profiles/web/local-bundles', `${shell}-${version}.tgz`);
  try {
    const info = await lstat(archive);
    if (!info.isFile() || info.size === 0) throw new Error();
    await promisify(execFile)(cli, ['plugin', '--profile', 'web', 'add', archive, '--offline', '--save-exact'], {
      env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }, timeout: 30000,
    });
    if (await readVersion(home, 'MOOS_SHELL_UPDATE_FAILED') !== version) throw new Error();
  } catch { throw invalid('MOOS_SHELL_UPDATE_FAILED'); }
}
