// One-time read-only re-verification for the 0.1.48 install. The installer's final gate threw
// because its assertion array referenced a renamed field (undefined); this script re-runs every
// installed-state assertion with the fix, writing its own verdict file. Read-only; touches no data.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, lstat, readdir, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const update = '/Applications/.moos-update-0.1.48';
const data = '/Users/xuguopeng/Library/Application Support/dev.moos.agent.electron';
const installed = '/Applications/沐码.app';
const repo = '/Users/xuguopeng/Documents/徐郭鹏项目/徐-moos-agent';
const baseline = join(repo, '.generated/moos-electron/build-9jwHgP/沐码.app/Contents/Resources');
const comparedCandidate = join(repo, '.generated/moos-electron/build-m69uNn/沐码.app/Contents/Resources');
const executable = '/Applications/沐码.app/Contents/MacOS/MuMa';
const out = join(update, 'result-verify.json');
const record = { state: 'verifying', time: new Date().toISOString() };
const cli = (cmd, args, timeout = 30000) => execFileSync(cmd, args, { stdio: 'pipe', timeout, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, LC_ALL: 'en_US.UTF-8', LANG: 'en_US.UTF-8' } });
const hash = b => createHash('sha256').update(b).digest('hex');
const checks = {};
const set = (k, v) => { checks[k] = v; if (!v) { (record.failed ??= []).push(k); } };
async function exists(p) { try { await lstat(p); return true; } catch(e) { if(e.code !== 'ENOENT') throw e; return false; } }
async function tree(root, rel = '', result = {}) {
  if (!await exists(join(root, rel))) return result;
  const info = await lstat(join(root, rel));
  if (info.isSymbolicLink()) { result[rel] = { link: await readlink(join(root, rel)) }; return result; }
  if (info.isDirectory()) for (const entry of await readdir(join(root, rel))) await tree(root, join(rel, entry), result);
  else if (info.isFile()) { const bytes = await readFile(join(root, rel)); result[rel] = { size: bytes.length, hash: hash(bytes) }; }
  return result;
}
async function filesEqual(before, root, allowAppend = false) {
  for (const [name, info] of Object.entries(before)) {
    if (!await exists(join(root, name))) return false;
    const file = join(root, name);
    const status = await lstat(file);
    if (Object.hasOwn(info, 'link')) return status.isSymbolicLink() && await readlink(file) === info.link;
    if (!status.isFile()) return false;
    const bytes = await readFile(file);
    if (allowAppend ? bytes.length < info.size || hash(bytes.subarray(0, info.size)) !== info.hash : hash(bytes) !== info.hash) return false;
  }
  return true;
}
async function exactFiles(root) {
  const names = ['providers.json', 'private/credentials.json', 'dsh/skin-center-active.json', 'dsh/profiles/web/cordis.patch.yml', 'dsh/profiles/web/cordis.yml', 'dsh/profiles/web/pnpm-workspace.yaml'];
  const result = {};
  for (const name of names) if (await exists(join(root, name))) result[name] = { hash: hash(await readFile(join(root, name))) };
  return result;
}
function dbRows(root) {
  const db = new DatabaseSync(join(root, 'pi/moos.sqlite'), { readOnly: true });
  try {
    if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('SQLite integrity check failed');
    return { messages: db.prepare('SELECT * FROM messages ORDER BY id').all(), conversations: db.prepare('SELECT * FROM conversations ORDER BY id').all(), tasks: db.prepare('SELECT id FROM tasks ORDER BY id').all() }; }
  finally { db.close(); }
}
function preservesRows(before, after) {
  for (const name of ['messages', 'conversations', 'tasks']) {
    const rows = new Map(after[name].map(row => [row.id, JSON.stringify(row)]));
    if (!before[name].every(row => rows.get(row.id) === JSON.stringify(row))) return false;
  }
  return true;
}
const res = join(installed, 'Contents/Resources');
try {
  set('signatureStrict', (cli('/usr/bin/codesign', ['--verify', '--deep', '--strict', installed], 120000), true));
  set('version048', cli('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleShortVersionString', join(installed, 'Contents/Info.plist')]).toString().trim() === '0.1.48');
  const mainPids = cli('/bin/ps', ['-axo', 'pid=,comm=']).toString().split('\n').filter(l => l.trim().endsWith(' ' + executable)).map(l => Number(l.trim().split(/\s+/)[0]));
  set('singleMainProcess', mainPids.length === 1);
  const hostRows = mainPids.length ? cli('/bin/ps', ['-axo', 'ppid=,comm=']).toString().split('\n').filter(l => l.trim().startsWith(String(mainPids[0]) + ' ')) : [];
  set('hostChildRunning', hostRows.some(l => l.trim().endsWith('/Applications/沐码.app/Contents/Resources/host-runtime/../../MacOS/MuMa')));
  // Changed files must still match the repository.
  const pairs = [
    ['pi-runtime/services/agent/errors.mjs', 'services/agent/errors.mjs'],
    ['pi-runtime/packages/pi-runtime/sdk-runtime.mjs', 'packages/pi-runtime/sdk-runtime.mjs'],
    ['pi-runtime/packages/pi-runtime/desktop-tools.mjs', 'packages/pi-runtime/desktop-tools.mjs'],
    ['pi-runtime/packages/pi-runtime/desktop-focus-settle.mjs', 'packages/pi-runtime/desktop-focus-settle.mjs'],
    ['host-runtime/dsh/moos-pi/pi-route.js', 'apps/electron/plugin/pi-route.js'],
    ['execution.patch.yml', 'apps/electron/execution.patch.yml'],
  ];
  let changedOk = true;
  for (const [p, s] of pairs) if (!(await readFile(join(res, p))).equals(await readFile(join(repo, s)))) changedOk = false;
  set('changedFilesMatchRepo', changedOk);
  const relatives = ['app/link-handler.mjs', 'app/pi-turn.mjs', 'app/pi-models.js', 'app/main.mjs', 'app/window-preload.cjs',
    'profile-template/profiles/web/node_modules/moos-electron-shell/host.js',
    'profile-template/profiles/web/node_modules/moos-electron-shell/client.js',
    'pi-runtime/packages/pi-runtime/tool-policy.mjs', 'pi-runtime/packages/pi-runtime/image-tool.mjs',
    'pi-runtime/services/agent/provider-diagnostics.mjs', 'pi-runtime/services/agent/scheduler.mjs', 'moos.icns'];
  let unchangedOk = true;
  for (const r of relatives) {
    const a = await readFile(join(res, r));
    if (!a.equals(await readFile(join(baseline, r))) && !a.equals(await readFile(join(comparedCandidate, r)))) unchangedOk = false;
  }
  set('unchangedFilesMatch47BaselineOrCandidate', unchangedOk);
  set('helperMatchesComparedCandidate', (await readFile(join(res, 'bin/moos-desktop-helper'))).equals(await readFile(join(comparedCandidate, 'bin/moos-desktop-helper'))));
  const sdk = await readFile(join(res, 'pi-runtime/packages/pi-runtime/sdk-runtime.mjs'), 'utf8');
  const route = await readFile(join(res, 'host-runtime/dsh/moos-pi/pi-route.js'), 'utf8');
  const patch = await readFile(join(res, 'execution.patch.yml'), 'utf8');
  const errors = await readFile(join(res, 'pi-runtime/services/agent/errors.mjs'), 'utf8');
  set('preCompactClassifyMarker', sdk.includes("classifyTaskError(error).code === 'context_limit'") && sdk.includes('[moos-pi] pre-compaction failed, continuing with existing context'));
  set('piRouteNewMessage', route.includes('上下文超出模型窗口，且自动压缩未能完成') && !route.includes('请核对模型服务的实际窗口'));
  set('uiPermissionDisabled', patch.includes('ui-permission') && patch.includes('disabled: true'));
  set('contextLimitMessage47', errors.includes('上下文已满且自动压缩未能完成'));
  set('preCompactGate47', sdk.includes('PRE_COMPACT_MARGIN_TOKENS') && sdk.includes('reserveTokens: 32768'));
  const shellClient = await readFile(join(data, 'dsh/profiles/web/node_modules/moos-electron-shell/client.js'), 'utf8');
  const shellPkg = JSON.parse(await readFile(join(data, 'dsh/profiles/web/node_modules/moos-electron-shell/package.json'), 'utf8'));
  set('loadedShellVersion048', shellPkg.version === '0.1.48');
  set('liveClientQueuedCards', ['排队中 · 本项目前方', '排队中 · 等待本项目上一任务完成', '排队中 · 等待空闲执行位'].every(c => shellClient.includes(c)));
  set('liveClientPermissionMenuGone', !shellClient.includes('ui-permission'));
  set('liveClientExecutionPolicyCard', shellClient.includes('命令执行') && shellClient.includes('moosExecutionPolicy'));
  // Data preservation re-check against the installer's own stopped backup.
  const backup = join(update, 'data-before-install');
  const protectedBefore = await exactFiles(backup);
  set('apiAndCredentialsIdentical', await filesEqual(protectedBefore, data));
  const sessionsBefore = await tree(join(backup, 'dsh/sessions'));
  const piSessionsRoot = join(backup, 'pi/sessions');
  const piBefore = await tree(piSessionsRoot);
  const skinsBefore = await tree(join(backup, 'dsh/skins'));
  const workspaceBefore = await tree(join(backup, 'workspace'));
  set('chatFilesRetained', await filesEqual(sessionsBefore, join(data, 'dsh/sessions'), true));
  let piHistoryOk = true;
  const piRuntimeCacheDiffs = [];
  for (const [name, info] of Object.entries(piBefore)) {
    const file = join(data, 'pi/sessions', name);
    if (!await exists(file)) { piHistoryOk = false; break; }
    const bytes = await readFile(file);
    if (name.endsWith('/agent/models.json')) {
      if (bytes.length < info.size) { piHistoryOk = false; break; }
      try {
        const cache = JSON.parse(bytes.toString('utf8'));
        const previous = JSON.parse((await readFile(join(piSessionsRoot, name))).toString('utf8'));
        const flat = o => JSON.stringify(o).replace(/http:\/\/127\.0\.0\.1:\d+\//g, 'http://127.0.0.1:PORT/');
        if (flat(cache) !== flat(previous)) piRuntimeCacheDiffs.push(name);
      } catch { piHistoryOk = false; break; }
      continue;
    }
    if (bytes.length < info.size || hash(bytes.subarray(0, info.size)) !== info.hash) { piHistoryOk = false; break; }
  }
  set('piHistoryFilesRetained', piHistoryOk);
  set('skinsRetained', await filesEqual(skinsBefore, join(data, 'dsh/skins')));
  set('workspaceRetained', await filesEqual(workspaceBefore, join(data, 'workspace')));
  const rowsBefore = dbRows(backup);
  const rowsAfter = dbRows(data);
  set('originalDatabaseRowsRetained', preservesRows(rowsBefore, rowsAfter));
  record.beforeCounts = Object.fromEntries(Object.entries(rowsBefore).map(([n, r]) => [n, r.length]));
  record.afterCounts = Object.fromEntries(Object.entries(rowsAfter).map(([n, r]) => [n, r.length]));
  const providers = JSON.parse(await readFile(join(data, 'providers.json'), 'utf8'));
  const credentials = JSON.parse(await readFile(join(data, 'private/credentials.json'), 'utf8'));
  set('savedModelsReadable', Array.isArray(providers) && providers.length === 6 && providers.every(p => typeof credentials[p.credentialId ?? p.id]?.apiKey === 'string' && credentials[p.credentialId ?? p.id].apiKey.length > 0));
  record.piRuntimeCacheDiffs = piRuntimeCacheDiffs;
  record.checks = checks;
  record.allPassed = Object.values(checks).every(Boolean);
  record.state = record.allPassed ? 'success' : 'stopped-for-review';
} catch (e) {
  record.state = 'error';
  record.error = String(e?.message ?? e).split('\n')[0].slice(0, 200);
}
await writeFile(out, JSON.stringify(record, null, 2), { mode: 0o600 });
console.log(record.state, record.allPassed ? '(all checks passed)' : JSON.stringify(record.failed || record.error));
