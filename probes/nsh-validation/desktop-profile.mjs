/** Trusted, opt-in storage for synthetic restart verification. Not an importer. */
import { lstat, open, readFile, readdir, realpath, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const format = 'moos-n01-desktop-synthetic-v1\n';
const markerName = '.n01-profile';
const lockName = '.n01-active';
const unsafe = () => new Error('Invalid isolated desktop profile');

export async function verifyProfileEntry(path, directory) {
  const s = await lstat(path);
  if (s.uid !== process.getuid() || (s.mode & 0o7777) !== (directory ? 0o700 : 0o600) ||
      (directory ? !s.isDirectory() : !s.isFile() || s.nlink !== 1)) throw unsafe();
  return s;
}

export async function leaseDesktopProfile(root) {
  if (typeof root !== 'string' || !isAbsolute(root) || root !== await realpath(root)) throw unsafe();
  await verifyProfileEntry(root, true);
  const lockPath = join(root, lockName);
  // A crash leaves this sentinel in place. Do not infer ownership from a reused PID or
  // clear a possibly-live lease. Recovery of stale leases is not implemented here.
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Isolated desktop profile is locked'); throw error; }
  let release;
  const close = () => release ??= (async () => { await lock.close(); await unlink(lockPath); })();
  try {
    const names = await readdir(root);
    const fresh = names.length === 1 && names[0] === lockName;
    const marker = join(root, markerName);
    if (!fresh) {
      const s = await verifyProfileEntry(marker, false);
      if (s.size !== Buffer.byteLength(format) || await readFile(marker, 'utf8') !== format) throw unsafe();
    }
    return {
      fresh, close,
      async ready() {
        if (!fresh) return;
        const f = await open(marker, 'wx', 0o600);
        try { await f.writeFile(format); await f.sync(); }
        finally { await f.close(); }
      },
    };
  } catch (error) { await close(); throw error; }
}
