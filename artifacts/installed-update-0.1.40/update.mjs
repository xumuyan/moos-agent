// One-time user-authorized installer for shell 0.1.40 (E110 attachment limits + E111 flat icon redesign).
// Never initializes or restores user data. Adapted from the verified 0.1.36 flow; every path,
// version, process name and feature marker re-verified for this round (MuMa bundle, Chinese app name).
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, lstat, readdir, rename, chmod, readlink, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
const update = '/Applications/.moos-update-0.1.40';
const data = '/Users/xuguopeng/Library/Application Support/dev.moos.agent.electron';
const installed = '/Applications/沐码.app';
const staged = join(update, '沐码.app');
const old = join(update, 'previous/沐码.app');
const backup = join(update, 'data-before-install');
const repo = '/Users/xuguopeng/Documents/徐郭鹏项目/徐-moos-agent';
const accepted = join(repo, '.generated/moos-electron/build-JHNLSY/沐码.app/Contents/Resources');
const targetShell = '0.1.40';
const originalShell = '0.1.39';
const executable = '/Applications/沐码.app/Contents/MacOS/MuMa';
const output = new URL('./result.json', import.meta.url);
const record = { state: 'preflight', targetShell, originalShell, userAuthorizedUpdate: true, stoppedActiveTasks: false, productionDataReset: false, automaticDataRestore: false };
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
  return rows.filter(line => line.trim().endsWith(' ' + executable)).map(line => Number(line.trim().split(/\s+/)[0]));
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
    line.trim().endsWith(' ' + installed + '/Contents/Resources/host-runtime/../../MacOS/MuMa'));
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
  if (version !== targetShell || await exists(old) || await exists(backup)) throw new Error('Unexpected update checkpoint; stop for review');
  await prepareMoveDestination(installed, staged, old);
  if (!(await lstat(data)).isDirectory()) throw new Error('Invalid original data path');
  if (JSON.parse(await readFile(join(staged, 'Contents/Resources/moos-runtime.json'), 'utf8')).includesPiFixture !== false) {
    throw new Error('Fixture build cannot be installed');
  }
  // Candidate must be byte-identical to the validated build for every file changed or load-bearing this round.
  for (const relative of ['app/pi-models.js', 'app/main.mjs', 'app/window-preload.cjs',
    'profile-template/profiles/web/node_modules/moos-electron-shell/host.js',
    'profile-template/profiles/web/node_modules/moos-electron-shell/client.js',
    'pi-runtime/packages/pi-runtime/tool-policy.mjs', 'pi-runtime/packages/pi-runtime/image-tool.mjs',
    'pi-runtime/packages/pi-runtime/sdk-runtime.mjs', 'pi-runtime/services/agent/provider-diagnostics.mjs',
    'host-runtime/dsh/moos-pi/pi-route.js',
    'moos.icns']) {
    const candidate = await readFile(join(staged, 'Contents/Resources', relative));
    const validated = await readFile(join(accepted, relative));
    if (!candidate.equals(validated)) throw new Error('Candidate does not match accepted build');
  }
  // E111: bundled icon assets must match the repository brand manifest digests.
  const manifest = JSON.parse(await readFile(join(repo, 'apps/electron/assets/brand-assets.json'), 'utf8'));
  for (const name of ['moos.icns']) {
    const digest = hash(await readFile(join(staged, 'Contents/Resources', name)));
    if (digest !== manifest.sha256[name]) throw new Error('Bundled icon digest mismatch for ' + name);
  }
  record.iconAssetsMatchManifest = true;
  record.sidebarSourceMatchesRepo = (await readFile(join(staged, 'Contents/Resources/profile-template/profiles/web/node_modules/moos-electron-shell/client.js')))
    .equals(await readFile(join(accepted, 'profile-template/profiles/web/node_modules/moos-electron-shell/client.js')));
  if (!record.sidebarSourceMatchesRepo) throw new Error('Staged client.js does not match accepted build');
  // Feature markers: E110 attachment limits, E111 flat icon, plus regressions from earlier rounds.
  const routeSource = (await readFile(join(staged, 'Contents/Resources/host-runtime/dsh/moos-pi/pi-route.js'), 'utf8'));
  if (!routeSource.includes('.moos-uploads') || !routeSource.includes('5 * 1024 * 1024') || !routeSource.includes('128 * 1024')) throw new Error('Candidate lacks the attachment limit raise');
  const shellClientSource = (await readFile(join(staged, 'Contents/Resources/profile-template/profiles/web/node_modules/moos-electron-shell/client.js'), 'utf8'));
  if (shellClientSource.includes('__MOOS_SIDEBAR_ICON__')) throw new Error('Candidate sidebar icon placeholder was not inlined');
  const inlineCount = (shellClientSource.match(/data:image\/png;base64,[A-Za-z0-9+/=]{200,}/g) || []).length;
  if (inlineCount < 1) throw new Error('Candidate lacks the inlined sidebar icon');
  record.sidebarIconInlined = inlineCount;
  if (!shellClientSource.includes('命令执行') || !shellClientSource.includes('moosExecutionPolicy')) throw new Error('Candidate lacks the execution policy card');
  if (!shellClientSource.includes('[class*="md-table-wide"]')) throw new Error('Candidate lacks the chat table overflow fix');
  if (!shellClientSource.includes('Max · 深度思考')) throw new Error('Candidate lacks the GLM official efforts');
  const modelsSource = (await readFile(join(staged, 'Contents/Resources/app/pi-models.js'), 'utf8'));
  if (!modelsSource.includes('saveExecutionPolicy') || !modelsSource.includes('execution-policy.json')) throw new Error('Candidate lacks the execution policy store');
  const mainSource = (await readFile(join(staged, 'Contents/Resources/app/main.mjs'), 'utf8'));
  if (!mainSource.includes('moos:execution-policy:save') || !mainSource.includes('moos:execution-policy:status')) throw new Error('Candidate lacks the execution policy IPC');
  const preloadSource = (await readFile(join(staged, 'Contents/Resources/app/window-preload.cjs'), 'utf8'));
  if (!preloadSource.includes('moosExecutionPolicy')) throw new Error('Candidate lacks the execution policy bridge');
  const toolPolicySource = (await readFile(join(staged, 'Contents/Resources/pi-runtime/packages/pi-runtime/tool-policy.mjs'), 'utf8'));
  if (!toolPolicySource.includes('danger-full-access')) throw new Error('Candidate lacks the danger passthrough');
  const imageToolSource = (await readFile(join(staged, 'Contents/Resources/pi-runtime/packages/pi-runtime/image-tool.mjs'), 'utf8'));
  if (!imageToolSource.includes('createImageTool') || !imageToolSource.includes('/images/generations')) throw new Error('Candidate lacks the chat image tool');
  const sdkSource = (await readFile(join(staged, 'Contents/Resources/pi-runtime/packages/pi-runtime/sdk-runtime.mjs'), 'utf8'));
  if (!sdkSource.includes("thinkingLevelMap: { off: 'none'") || !sdkSource.includes("max: 'max'")) throw new Error('Candidate lacks the GLM thinkingLevelMap');
  if (!routeSource.includes('glmReasoningEfforts')) throw new Error('Candidate lacks the GLM efforts metadata');
  const diagnosticsSource = (await readFile(join(staged, 'Contents/Resources/pi-runtime/services/agent/provider-diagnostics.mjs'), 'utf8'));
  if (!diagnosticsSource.includes("effort: 'minimal'") || !diagnosticsSource.includes('max_output_tokens: glmReasoning ? 256 : 16')) throw new Error('Candidate lacks the bounded GLM Responses probe');
  const bundleName = cli('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleName', join(staged, 'Contents/Info.plist')]).toString().trim();
  if (bundleName !== 'MuMa') throw new Error('Candidate display branding unexpected');
  await verifyReadableProfile(data);
  const current = JSON.parse(await readFile(join(installed, 'Contents/Resources/profile-template/profiles/web/node_modules/moos-electron-shell/package.json'), 'utf8')).version;
  const loaded = JSON.parse(await readFile(join(data, 'dsh/profiles/web/node_modules/moos-electron-shell/package.json'), 'utf8')).version;
  if (current !== originalShell || loaded !== current) throw new Error('Unexpected original shell version');
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
    if (text.includes('/沐码.app/Contents/')) throw new Error('Installer still belongs to Moos; use standalone Terminal');
    pid = Number(text.split(/\s+/)[0]);
  }
  await preflight();
  // Validation gate: this round's recorded exit codes must all be zero.
  for (const name of ['electron', 'core', 'docs', 'gui']) {
    const code = Number((await readFile(join(repo, 'artifacts/muma-icon-v2', name + '.exit'), 'utf8')).trim());
    record['validation_' + name] = code;
    if (code !== 0) throw new Error('Validation gate failed for ' + name);
  }
  await mark('waiting-for-idle');
  const deadline = Date.now() + 60 * 60 * 1000;
  while (activeTasks() && Date.now() < deadline) await sleep(3000);
  if (activeTasks()) throw new Error('Active work did not finish during the idle wait');
  const pids = mainPids();
  if (pids.length > 1) throw new Error('Multiple formal instances; stop for review');
  await mark('normal-quit-requested');
  if (pids.length) {
    if (activeTasks()) throw new Error('A task started before shutdown');
    const result = spawnSync('/usr/bin/osascript', ['-e', 'tell application "/Applications/沐码.app" to quit'], { timeout: 15000, encoding: 'utf8' });
    if (result.status !== 0) throw new Error('Normal quit was not confirmed');
  }
  for (let i = 0; i < 30 && mainPids().length; i++) await sleep(1000);
  if (mainPids().length) throw new Error('Desktop still running; did not replace app');
  // Give the registered Host a bounded period to finish task cancellation.
  for (let i = 0; i < 20; i++) {
    const commands = cli('/bin/ps', ['-axo', 'comm=']).toString();
    if (!commands.includes('/Applications/沐码.app/Contents/Resources/host-runtime/../../MacOS/MuMa')) break;
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
    if (version === targetShell && mainPids().length === 1 && activeHost()) { ready = true; break; }
    await sleep(1000);
  }
  if (!ready) throw new Error('New shell startup not confirmed');
  await sleep(4000);
  const bundledClient = await readFile(join(installed, 'Contents/Resources/profile-template/profiles/web/node_modules/moos-electron-shell/client.js'));
  const liveClient = await readFile(join(data, 'dsh/profiles/web/node_modules/moos-electron-shell/client.js'));
  record.loadedClientMatches = bundledClient.equals(liveClient);
  record.hostRunning = activeHost();
  record.installedIconMatchesManifest = hash(await readFile(join(installed, 'Contents/Resources/moos.icns'))) ===
    JSON.parse(await readFile(join(repo, 'apps/electron/assets/brand-assets.json'), 'utf8')).sha256['moos.icns'];
  record.sidebarIconInLiveClient = (liveClient.toString().match(/data:image\/png;base64,[A-Za-z0-9+/=]{200,}/g) || []).length >= 1;
  record.attachmentLimitsInInstalled = (await readFile(join(installed, 'Contents/Resources/host-runtime/dsh/moos-pi/pi-route.js'), 'utf8')).includes('5 * 1024 * 1024');
  record.imageToolInInstalled = await exists(join(installed, 'Contents/Resources/pi-runtime/packages/pi-runtime/image-tool.mjs'));
  record.executionPolicyInInstalled = (await readFile(join(installed, 'Contents/Resources/app/pi-models.js'), 'utf8')).includes('saveExecutionPolicy');
  record.tableFixInInstalled = (await readFile(join(data, 'dsh/profiles/web/node_modules/moos-electron-shell/client.js'), 'utf8')).includes('[class*="md-table-wide"]');
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
  if (record.installedMainProcesses !== 1 || ![record.loadedClientMatches, record.hostRunning, record.installedIconMatchesManifest, record.sidebarIconInLiveClient, record.attachmentLimitsInInstalled, record.imageToolInInstalled, record.executionPolicyInInstalled, record.tableFixInInstalled, record.apiAndCredentialsIdentical, record.chatFilesRetained, record.piHistoryFilesRetained, record.skinsRetained, record.workspaceRetained, record.originalDatabaseRowsRetained, record.userPluginDependenciesRetained].every(Boolean)) throw new Error('Data preservation verification did not fully pass; preserve backup and request review');
  await mark('success');
  console.log('更新完成：沐码 0.1.40（附件上限 E110 + 纯平图标 E111）。聊天与 API 配置保留校验通过，图标资产与清单一致。旧包和数据备份已保留，确认新版可用后可按规则清理。');
} catch(error) {
  // Child process errors may carry arbitrary command output. Keep the result sanitized.
  record.failure = error instanceof Error ? error.message.split('\n')[0].slice(0, 200) : 'Update failed';
  record.packageWasSwitched = switched;
  await mark('stopped-for-review');
  console.error('更新停止，请保留备份，不要删除或重置数据。错误：' + record.failure);
}
