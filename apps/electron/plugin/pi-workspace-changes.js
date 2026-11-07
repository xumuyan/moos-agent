import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readlink, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const git = promisify(execFile);
const maxFiles = 2500;
const maxFileBytes = 4 * 1024 * 1024;
const maxScanBytes = 64 * 1024 * 1024;

function within(cwd, path) {
  const name = relative(cwd, path);
  return name !== '..' && !name.startsWith('..' + sep) && !isAbsolute(name);
}

async function fingerprint(path, limit, signal) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const status = await handle.stat();
    if (!status.isFile() || status.nlink > 1 || status.size > limit) return null;
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false, end: limit, signal })) {
      bytes += chunk.length;
      if (bytes > limit) return null;
      hash.update(chunk);
    }
    return { bytes, value: 'file:' + (status.mode & 0o111) + ':' + hash.digest('hex') };
  } finally {
    await handle.close();
  }
}

async function snapshot(cwd, signal, previous = []) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG };
  const { stdout } = await git('git', ['-c', 'core.fsmonitor=false', 'ls-files', '-z',
    '--cached', '--others', '--exclude-standard', '--', '.'], {
    cwd, env: { ...env, GIT_OPTIONAL_LOCKS: '0' }, signal, timeout: 5000, maxBuffer: 1024 * 1024,
  });
  const names = new Set([...stdout.split('\0').filter(Boolean), ...previous]);
  if (names.size > maxFiles) return null;
  let remaining = maxScanBytes;
  const files = new Map();
  for (const name of names) {
    signal.throwIfAborted();
    const path = resolve(cwd, name);
    if (!within(cwd, path) || /[\x00-\x1f\x7f\ufffd]/.test(name)) continue;
    try {
      const status = await lstat(path);
      if (status.isSymbolicLink()) {
        // Record the link itself without reading the destination.
        if (within(cwd, await realpath(resolve(path, '..')))) files.set(name, 'link:' + await readlink(path));
        else files.set(name, null);
        continue;
      }
      const canonical = await realpath(path);
      if (!status.isFile() || status.nlink > 1 || !within(cwd, canonical) || status.size > maxFileBytes || status.size > remaining) {
        files.set(name, null);
        continue;
      }
      const hashed = await fingerprint(canonical, Math.min(remaining, maxFileBytes), signal);
      remaining -= hashed?.bytes ?? 0;
      files.set(name, hashed?.value ?? null);
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') files.set(name, null);
    }
  }
  return files;
}

/** Compare the Git-visible workspace within one scheduler-owned run. */
export async function withWorkspaceChanges(cwd, signal, run, report) {
  const before = await (async () => {
    // Avoid starting the macOS Git installation prompt on an unconfigured Mac.
    if (process.platform === 'darwin') await git('/usr/bin/xcode-select', ['-p'], { cwd, signal, timeout: 2000 });
    return snapshot(cwd, signal);
  })().catch(() => null);
  try {
    signal.throwIfAborted();
    return await run();
  } finally {
    if (before && !signal.aborted) {
      const after = await snapshot(cwd, signal, before.keys()).catch(() => null);
      if (after) {
        const files = [];
        for (const path of new Set([...before.keys(), ...after.keys()])) {
          const old = before.get(path);
          const current = after.get(path);
          if (old === current || old === null || current === null) continue;
          files.push({ path, summary: old === undefined ? '新增' : current === undefined ? '删除' : '修改' });
        }
        const limited = [...before.values(), ...after.values()].includes(null) || files.length > 200;
        report({ files: files.slice(0, 200), limited });
      }
    }
  }
}
