// One-time user-authorized installer. Never initializes or restores user data.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, lstat, readdir, rename, chmod, readlink, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
const update = '/Applications/.moos-update-0.1.33';
const data = '/Users/xuguopeng/Library/Application Support/dev.moos.agent.electron';
const installed = '/Applications/Moos.app';
const staged = join(update, 'Moos.app');
const old = join(update, 'previous/Moos.app');
const backup = join(update, 'data-before-install');
const output = new URL('./result.json', import.meta.url);
const record = { state: 'preflight', targetShell: '0.1.33', userAuthorizedUpdate: true, stoppedActiveTasks: false, productionDataReset: false, automaticDataRestore: false };
const cli = (cmd, args, timeout = 30000) => execFileSync(cmd, args, { stdio: 'pipe', timeout });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function exists(path) { try { await lstat(path); return true; } catch(e) { if(e.code !== 'ENOENT') throw e; return false; } }
async function mark(state) { record.state = state; record.time = new Date().toISOString(); await writeFile(output, JSON.stringify(record, null, 2), { mode: 0o600 }); console.log(state); }
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
    if (Object.hasOwn(info, 'link')) {
      if (!status.isSymbolicLink() || await readlink(file) !== info.link) return false;
      continue;
    }
    if (!status.isFile()) return false;
    const bytes = await readFile(file);
    if (allowAppend ? bytes.length < info.size || hash(bytes.subarray(0, info.size)) !== info.hash : hash(bytes) !== info.hash) return false;
  }
  return true;
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
async function exactFiles(root) {
  const names = ['providers.json', 'private/credentials.json', 'dsh/skin-center-active.json', 'dsh/profiles/web/cordis.patch.yml', 'dsh/profiles/web/cordis.yml', 'dsh/profiles/web/pnpm-workspace.yaml'];
  const result = {};
  for (const name of names) if (await exists(join(root, name))) result[name] = { hash: hash(await readFile(join(root, name))) };
  return result;
}
function mainPids() {
  const rows = cli('/bin/ps', ['-axo', 'pid=,comm=']).toString().split('\n');
  return rows.filter(line => line.trim().endsWith(' ' + installed + '/Contents/MacOS/Moos')).map(line => Number(line.trim().split(/\s+/)[0]));
}
function activeTasks() {
  const db = new DatabaseSync(join(data, 'pi/moos.sqlite'), { readOnly: true });
  try { return db.prepare("SELECT count(*) AS count FROM tasks WHERE status IN ('queued', 'running')").get().count; }
  finally { db.close(); }
}
function activeHost() {
  const [main] = mainPids();
  if (!main) return false;
  const rows = cli('/bin/ps', ['-axo', 'ppid=,comm=']).toString().split('\n');
  return rows.some(line => line.trim().startsWith(main + ' ') &&
    line.trim().endsWith(' ' + installed + '/Contents/Resources/host-runtime/../../MacOS/Moos'));
}
async function prepareMoveDestination(installed, staged, old) {
  const parent = join(old, '..');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const directory = await lstat(parent);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Unsafe rollback directory');
  const [source, candidate] = await Promise.all([lstat(installed), lstat(staged)]);
  if (source.dev !== directory.dev || candidate.dev !== directory.dev) throw new Error('Cross-volume replacement is not allowed');
  if (await exists(old)) throw new Error('Previous application already exists; review checkpoint');
}
async function verifyReadableProfile(root) {
  const providers = JSON.parse(await readFile(join(root, 'providers.json'), 'utf8'));
  const credentials = JSON.parse(await readFile(join(root, 'private/credentials.json'), 'utf8'));
  if (!Array.isArray(providers) || !providers.length || !providers.every(p =>
    typeof p.model === 'string' && typeof p.baseUrl === 'string' &&
    typeof credentials[p.credentialId ?? p.id]?.apiKey === 'string' && credentials[p.credentialId ?? p.id].apiKey.length > 0)) {
    throw new Error('Existing models or credentials unreadable; stop without initializing');
  }
  if (((await lstat(join(root, 'private'))).mode & 0o777) !== 0o700 ||
      ((await lstat(join(root, 'private/credentials.json'))).mode & 0o777) !== 0o600) throw new Error('Existing credential permissions unexpected');
  return providers.length;
}
async function preflight() {
  const capacity = await statfs(update);
  if (capacity.bavail * capacity.bsize < 4 * 1024 ** 3) throw new Error('Insufficient space for stopped backup and safe replacement');
  for (const path of [staged, installed]) {
    cli('/usr/bin/codesign', ['--verify', '--deep', '--strict', path]);
    const identity = cli('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleIdentifier', join(path, 'Contents/Info.plist')]).toString().trim();
    if (identity !== 'dev.moos.agent.electron') throw new Error('Bundle identity mismatch');
  }
  const version = JSON.parse(await readFile(join(staged, 'Contents/Resources/profile-template/profiles/web/node_modules/moos-electron-shell/package.json'), 'utf8')).version;
  if (version !== '0.1.33' || await exists(old) || await exists(backup)) throw new Error('Unexpected update checkpoint; stop for review');
  await prepareMoveDestination(installed, staged, old);
  if (!(await lstat(data)).isDirectory()) throw new Error('Invalid original data path');
  if (JSON.parse(await readFile(join(staged, 'Contents/Resources/moos-runtime.json'), 'utf8')).includesPiFixture !== false) {
    throw new Error('Fixture build cannot be installed');
  }
  for (const relative of ['app/pi-models.js', 'profile-template/profiles/web/node_modules/moos-electron-shell/client.js', 'host-runtime/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js',
    'pi-runtime/services/agent/provider-diagnostics.mjs']) {
    const candidate = await readFile(join(staged, 'Contents/Resources', relative));
    const validated = await readFile(join('/Users/xuguopeng/Documents/徐郭鹏项目/徐-moos-agent/.generated/moos-electron/build-uy2KoB/Moos.app/Contents/Resources', relative));
    if (!candidate.equals(validated)) throw new Error('Candidate does not match accepted build');
  }
  const shellClientSource = (await readFile(join(staged, 'Contents/Resources/profile-template/profiles/web/node_modules/moos-electron-shell/client.js'), 'utf8'));
  if ((shellClientSource.match(/noteStyle/g) || []).length < 3) throw new Error('Candidate lacks the smaller hint styles');
  const diagnosticsSource = (await readFile(join(staged, 'Contents/Resources/pi-runtime/services/agent/provider-diagnostics.mjs'), 'utf8'));
  if (!diagnosticsSource.includes("effort: 'minimal'") || !diagnosticsSource.includes('max_output_tokens: glmReasoning ? 256 : 16')) throw new Error('Candidate lacks the bounded GLM Responses probe');
  await verifyReadableProfile(data);
  const current = JSON.parse(await readFile(join(installed, 'Contents/Resources/profile-template/profiles/web/node_modules/moos-electron-shell/package.json'), 'utf8')).version;
  const loaded = JSON.parse(await readFile(join(data, 'dsh/profiles/web/node_modules/moos-electron-shell/package.json'), 'utf8')).version;
  if (current !== '0.1.32' || loaded !== current) throw new Error('Unexpected original shell version');
  for (const dir of ['dsh/sessions', 'pi/sessions', 'dsh/skins', 'workspace']) {
    if (!(await lstat(join(data, dir))).isDirectory()) throw new Error('Required original directory missing');
  }
  for (const name of ['providers.json', 'private/credentials.json', 'pi/moos.sqlite', 'dsh/profiles/web/package.json']) if (!await exists(join(data, name))) throw new Error('Required existing data missing');
}
if (process.argv.includes('--preflight')) { await preflight(); console.log('PREFLIGHT_OK'); process.exit(0); }
let switched = false;
try {
  // Refuse to stop the application from one of its own descendant processes.
  let pid = process.ppid;
  for (let i = 0; i < 16 && pid > 1; i++) {
    const text = cli('/bin/ps', ['-p', String(pid), '-o', 'ppid=,comm=']).toString().trim();
    if (text.includes('/Moos.app/Contents/')) throw new Error('Installer still belongs to Moos; use standalone Terminal');
    pid = Number(text.split(/\s+/)[0]);
  }
  await preflight();
  const validated = JSON.parse(await readFile('/Users/xuguopeng/Documents/徐郭鹏项目/徐-moos-agent/artifacts/installed-update-0.1.33/validation-final/validation.json', 'utf8'));
  if (!['core', 'electron', 'native', 'bridge', 'skin', 'docs'].every(name => validated[name] === 0)) throw new Error('Validation gate failed');
  await mark('waiting-for-idle');
  const deadline = Date.now() + 30 * 60 * 1000;
  while (activeTasks() && Date.now() < deadline) await sleep(3000);
  if (activeTasks()) throw new Error('Active work did not finish during the idle wait');
  const pids = mainPids();
  if (pids.length > 1) throw new Error('Multiple formal instances; stop for review');
  await mark('normal-quit-requested');
  if (pids.length) {
    if (activeTasks()) throw new Error('A task started before shutdown');
    const result = spawnSync('/usr/bin/osascript', ['-e', 'tell application "/Applications/Moos.app" to quit'], { timeout: 15000, encoding: 'utf8' });
    if (result.status !== 0) throw new Error('Normal quit was not confirmed');
  }
  for (let i = 0; i < 30 && mainPids().length; i++) await sleep(1000);
  if (mainPids().length) throw new Error('Desktop still running; did not replace app');
  // Give the registered Host a bounded period to finish task cancellation.
  for (let i = 0; i < 20; i++) {
    const commands = cli('/bin/ps', ['-axo', 'comm=']).toString();
    if (!commands.includes(installed + '/Contents/Resources/host-runtime/../../MacOS/Moos')) break;
    if (i === 19) throw new Error('Host still running; did not replace app');
    await sleep(1000);
  }
  await mark('backing-up-stopped-data');
  const entireData = await tree(data);
  cli('/usr/bin/ditto', [data, backup], 300000);
  async function protectBackup(path) {
    const info = await lstat(path);
    if (info.isSymbolicLink()) return;
    await chmod(path, info.isDirectory() ? 0o700 : 0o600);
    if (info.isDirectory()) for (const name of await readdir(path)) await protectBackup(join(path, name));
  }
  await protectBackup(backup);
  await chmod(backup, 0o700);
  await chmod(join(backup, 'private'), 0o700);
  await chmod(join(backup, 'private/credentials.json'), 0o600);
  if (!await filesEqual(entireData, backup)) throw new Error('Full stopped backup does not match the source files');
  record.fullBackupFilesVerified = Object.keys(entireData).length;
  record.backupPermissionsVerified = ((await lstat(backup)).mode & 0o777) === 0o700 &&
    ((await lstat(join(backup, 'private/credentials.json'))).mode & 0o777) === 0o600;
  if (!record.backupPermissionsVerified) throw new Error('Backup permissions did not pass');
  const protectedBefore = await exactFiles(data);
  const sessionsBefore = await tree(join(data, 'dsh/sessions'));
  const piBefore = await tree(join(data, 'pi/sessions'));
  const skinsBefore = await tree(join(data, 'dsh/skins'));
  const workspaceBefore = await tree(join(data, 'workspace'));
  const rowsBefore = dbRows(data);
  const depsBefore = JSON.parse(await readFile(join(data, 'dsh/profiles/web/package.json'), 'utf8')).dependencies;
  if (!await filesEqual(protectedBefore, backup) || !preservesRows(rowsBefore, dbRows(backup))) throw new Error('Backup verification failed');
  record.backupVerified = true;
  record.beforeCounts = Object.fromEntries(Object.entries(rowsBefore).map(([name, rows]) => [name, rows.length]));
  await mark('backup-verified');
  await prepareMoveDestination(installed, staged, old);
  await rename(installed, old);
  try { await rename(staged, installed); switched = true; }
  catch(e) { await rename(old, installed); throw e; }
  cli('/usr/bin/codesign', ['--verify', '--deep', '--strict', installed]);
  await mark('new-package-installed');
  const env = { ...process.env, HOME: '/Users/xuguopeng', TMPDIR: '/private/tmp/' };
  for (const name of ['MOOS_ELECTRON_DATA', 'MOOS_ELECTRON_PI_FIXTURE', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH']) delete env[name];
  execFileSync('/usr/bin/open', ['-a', installed], { env, stdio: 'pipe', timeout: 15000 });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    const version = JSON.parse(await readFile(join(data, 'dsh/profiles/web/node_modules/moos-electron-shell/package.json'), 'utf8')).version;
    if (version === '0.1.33' && mainPids().length === 1 && activeHost()) { ready = true; break; }
    await sleep(1000);
  }
  if (!ready) throw new Error('New shell startup not confirmed');
  await sleep(4000);
  const bundledClient = await readFile(join(installed, 'Contents/Resources/profile-template/profiles/web/node_modules/moos-electron-shell/client.js'));
  const liveClient = await readFile(join(data, 'dsh/profiles/web/node_modules/moos-electron-shell/client.js'));
  record.loadedClientMatches = bundledClient.equals(liveClient);
  record.hostRunning = activeHost();
  record.probeFixInInstalled = (await readFile(join(installed, 'Contents/Resources/pi-runtime/services/agent/provider-diagnostics.mjs'), 'utf8')).includes("effort: 'minimal'");
  record.hintStyleInInstalled = (await readFile(join(installed, 'Contents/Resources/profile-template/profiles/web/node_modules/moos-electron-shell/client.js'), 'utf8')).includes('noteStyle');
  record.readableSavedModels = await verifyReadableProfile(data);
  record.apiAndCredentialsIdentical = await filesEqual(protectedBefore, data);
  record.chatFilesRetained = await filesEqual(sessionsBefore, join(data, 'dsh/sessions'), true);
  record.piHistoryFilesRetained = await filesEqual(piBefore, join(data, 'pi/sessions'), true);
  record.skinsRetained = await filesEqual(skinsBefore, join(data, 'dsh/skins'));
  record.workspaceRetained = await filesEqual(workspaceBefore, join(data, 'workspace'));
  const afterRows = dbRows(data);
  record.originalDatabaseRowsRetained = preservesRows(rowsBefore, afterRows);
  record.afterCounts = Object.fromEntries(Object.entries(afterRows).map(([name, rows]) => [name, rows.length]));
  const depsAfter = JSON.parse(await readFile(join(data, 'dsh/profiles/web/package.json'), 'utf8')).dependencies;
  record.userPluginDependenciesRetained = Object.entries(depsBefore).every(([name, spec]) => name === 'moos-electron-shell' || depsAfter[name] === spec);
  record.installedMainProcesses = mainPids().length;
  if (record.installedMainProcesses !== 1 || ![record.loadedClientMatches, record.hostRunning, record.probeFixInInstalled, record.hintStyleInInstalled, record.apiAndCredentialsIdentical, record.chatFilesRetained, record.piHistoryFilesRetained, record.skinsRetained, record.workspaceRetained, record.originalDatabaseRowsRetained, record.userPluginDependenciesRetained].every(Boolean)) throw new Error('Data preservation verification did not fully pass; preserve backup and request review');
  await mark('success');
  console.log('更新完成：内置壳 0.1.33。聊天与 API 配置保留校验通过。旧包和数据备份已保留。');
} catch(error) {
  // Child process errors may carry arbitrary command output. Keep the result sanitized.
  record.failure = error instanceof Error ? error.message.split('\n')[0].slice(0, 200) : 'Update failed';
  record.packageWasSwitched = switched;
  await mark('stopped-for-review');
  console.error('更新停止，请保留备份，不要删除或重置数据。错误：' + record.failure);
  process.exitCode = 1;
}
