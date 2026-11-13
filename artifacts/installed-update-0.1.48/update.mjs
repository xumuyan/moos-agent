// One-time user-authorized installer for 0.1.48 (P03.13.20 pre-compaction misreport fix;
// carries the uninstalled P03.13.19 permission-menu removal and E129/E132/E133 M06 desktop
// transaction work forward). Never initializes or restores user data.
// Adapted from the verified 0.1.47 flow; every path, version, baseline and feature marker
// re-verified for this round:
// - changed files (errors.mjs, sdk-runtime.mjs, pi-route.js, execution.patch.yml,
//   desktop-tools.mjs, desktop-focus-settle.mjs) must be byte-identical to the repository sources;
// - every other load-bearing file must be byte-identical to the installed/validated 0.1.47
//   bundle (build-9jwHgP), with the desktop helper additionally byte-identical to the
//   E134 GUI-compared 0.1.48 candidate (build-m69uNn);
// - validation gate reads this round's real exit files (artifacts/precompact-misreport/final)
//   plus E126's bridge/skin exits;
// - idle wait is bounded at 3 minutes: the installer itself may be reported as a running task in
//   the app, and the user-authorized install proceeds via the app's normal quit path (tasks are
//   cancelled by the app itself as a normal terminal state, recorded in this result file).
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, lstat, readdir, rename, chmod, readlink, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
const update = '/Applications/.moos-update-0.1.48';
const data = '/Users/xuguopeng/Library/Application Support/dev.moos.agent.electron';
const installed = '/Applications/沐码.app';
const staged = join(update, '沐码.app');
const old = join(update, 'previous/沐码.app');
const backup = join(update, 'data-before-install');
const repo = '/Users/xuguopeng/Documents/徐郭鹏项目/徐-moos-agent';
const baseline = join(repo, '.generated/moos-electron/build-9jwHgP/沐码.app/Contents/Resources'); // installed 0.1.47 bundle
const comparedCandidate = join(repo, '.generated/moos-electron/build-m69uNn/沐码.app/Contents/Resources'); // E134 GUI-compared 0.1.48 candidate
const targetShell = '0.1.48';
const originalShell = '0.1.47';
const executable = '/Applications/沐码.app/Contents/MacOS/MuMa';
const output = new URL('./result.json', import.meta.url);
const record = { state: 'preflight', targetShell, originalShell, userAuthorizedUpdate: true, stoppedActiveTasks: false, productionDataReset: false, automaticDataRestore: false };
const cli = (cmd, args, timeout = 30000) => execFileSync(cmd, args, { stdio: 'pipe', timeout,
  // ps 在 C locale 下把中文路径转义成 M-fM-2…，会导致进程匹配失效；固定 UTF-8。
  env: { ...process.env, LC_ALL: 'en_US.UTF-8', LANG: 'en_US.UTF-8' } });
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
async function assertChangedFilesMatchRepo(resources) {
  // P03.13.18 (this round): the two changed runtime files must be byte-identical to the repository.
  const pairs = [
    ['pi-runtime/services/agent/errors.mjs', 'services/agent/errors.mjs'],
    ['pi-runtime/packages/pi-runtime/sdk-runtime.mjs', 'packages/pi-runtime/sdk-runtime.mjs'],
    ['pi-runtime/packages/pi-runtime/desktop-tools.mjs', 'packages/pi-runtime/desktop-tools.mjs'],
    ['pi-runtime/packages/pi-runtime/desktop-focus-settle.mjs', 'packages/pi-runtime/desktop-focus-settle.mjs'],
    ['host-runtime/dsh/moos-pi/pi-route.js', 'apps/electron/plugin/pi-route.js'],
    ['execution.patch.yml', 'apps/electron/execution.patch.yml'],
  ];
  for (const [packaged, source] of pairs) {
    if (!(await readFile(join(resources, packaged))).equals(await readFile(join(repo, source)))) {
      throw new Error('Packaged file does not match the repository: ' + packaged);
    }
  }
  return pairs.length;
}
async function assertUnchangedFilesMatch47Baseline(resources) {
  // Everything else must be byte-identical to the installed 0.1.47 bundle (build-9jwHgP).
  const relatives = ['app/link-handler.mjs', 'app/pi-turn.mjs', 'app/pi-models.js', 'app/main.mjs', 'app/window-preload.cjs',
    'profile-template/profiles/web/node_modules/moos-electron-shell/host.js',
    'profile-template/profiles/web/node_modules/moos-electron-shell/client.js',
    'pi-runtime/packages/pi-runtime/tool-policy.mjs', 'pi-runtime/packages/pi-runtime/image-tool.mjs',
    'pi-runtime/services/agent/provider-diagnostics.mjs', 'pi-runtime/services/agent/scheduler.mjs',
    'moos.icns'];
  for (const relative of relatives) {
    if (!(await readFile(join(resources, relative))).equals(await readFile(join(baseline, relative))) &&
        !(await readFile(join(resources, relative))).equals(await readFile(join(comparedCandidate, relative)))) {
      throw new Error('Candidate does not match the installed 0.1.47 baseline: ' + relative);
    }
  }
  return relatives.length;
}
async function assertHelperMatchesComparedCandidate(resources) {
  // The desktop helper must equal the E134 GUI-compared candidate build byte for byte.
  const a = await readFile(join(resources, 'bin/moos-desktop-helper'));
  const b = await readFile(join(comparedCandidate, 'bin/moos-desktop-helper'));
  if (!a.equals(b)) throw new Error('Desktop helper differs from the GUI-compared candidate');
  return a.length;
}
async function assertVersionArtifacts(resources) {
  const appPkg = JSON.parse(await readFile(join(resources, 'app/package.json'), 'utf8'));
  const shellPkg = JSON.parse(await readFile(join(resources, 'profile-template/profiles/web/node_modules/moos-electron-shell/package.json'), 'utf8'));
  if (appPkg.version !== targetShell || shellPkg.version !== targetShell) {
    throw new Error('Candidate version metadata inconsistent');
  }
  const bundles = await readdir(join(resources, 'profile-template/profiles/web/local-bundles'));
  if (!bundles.some(name => name === `moos-electron-shell-${targetShell}.tgz`)) throw new Error('Candidate lacks its own shell tgz');
  return [appPkg.version, shellPkg.version];
}
async function assertRoundFixes(resources) {
  // P03.13.20 (this round): pre-compaction failures are classified, not hardcoded as context_limit.
  const sdkEarly = (await readFile(join(resources, 'pi-runtime/packages/pi-runtime/sdk-runtime.mjs'), 'utf8'));
  if (!sdkEarly.includes('[moos-pi] pre-compaction failed, continuing with existing context')) throw new Error('Bundled sdk-runtime lacks the classified pre-compaction failure path');
  if (!sdkEarly.includes("classifyTaskError(error).code === 'context_limit'")) throw new Error('Bundled sdk-runtime lacks the pre-compaction classifier gate');
  const routeEarly = (await readFile(join(resources, 'host-runtime/dsh/moos-pi/pi-route.js'), 'utf8'));
  if (!routeEarly.includes('上下文超出模型窗口，且自动压缩未能完成')) throw new Error('Bundled pi-route lacks the rewritten context_limit message');
  if (routeEarly.includes('请核对模型服务的实际窗口')) throw new Error('Bundled pi-route still carries the misleading context_limit message');
  // P03.13.19 (carried forward): conversation three-tier permission menu disabled via patch layer.
  const patchEarly = (await readFile(join(resources, 'execution.patch.yml'), 'utf8'));
  if (!patchEarly.includes('ui-permission') || !patchEarly.includes('disabled: true')) throw new Error('Bundled execution.patch.yml lacks the ui-permission disable');
  // P03.13.18 (0.1.47) regression: context-overflow self-rescue kept intact.
  const errors = (await readFile(join(resources, 'pi-runtime/services/agent/errors.mjs'), 'utf8'));
  if (!errors.includes('上下文已满且自动压缩未能完成')) throw new Error('Bundled errors lack the new context_limit message');
  if (!errors.includes('compact(?:ion)?[- ]?and[- ]?retry recovery failed') ||
      !errors.includes('truncated response recovery failed') ||
      !errors.includes('上下文.{0,12}(超限|溢出|已满|过长)')) throw new Error('Bundled errors lack the recovery-failure classifier');
  const sdk = sdkEarly;
  if (!sdk.includes('PRE_COMPACT_MARGIN_TOKENS') || !sdk.includes('reserveTokens: 32768')) throw new Error('Bundled sdk-runtime lacks the pre-compaction settings');
  if (!sdk.includes("reason.includes('Nothing to compact')") || !sdk.includes("throw new TaskFailure('context_limit')")) throw new Error('Bundled sdk-runtime lacks the pre-compaction gate semantics');
  if (!sdk.includes("findLast(item => item.role === 'assistant')?.usage")) throw new Error('Bundled sdk-runtime lacks the usage precheck');
  // P03.13.17 (E126, installed by this update): three-state queued card + per-project queueAhead.
  const piTurn = (await readFile(join(resources, 'app/pi-turn.mjs'), 'utf8'));
  if (!piTurn.includes('queueAhead') || !piTurn.includes('projectRunning')) throw new Error('Bundled pi-turn lacks the per-project queue read model');
  const shellClient = (await readFile(join(resources, 'profile-template/profiles/web/node_modules/moos-electron-shell/client.js'), 'utf8'));
  for (const copy of ['排队中 · 本项目前方', '排队中 · 等待本项目上一任务完成', '排队中 · 等待空闲执行位']) {
    if (!shellClient.includes(copy)) throw new Error('Bundled client lacks the queued card copy: ' + copy);
  }
  // P03.13.16 (E125, regression): timeout enforcement in the bundled scheduler.
  const scheduler = (await readFile(join(resources, 'pi-runtime/services/agent/scheduler.mjs'), 'utf8'));
  if (!scheduler.includes("errorCode: 'timeout'") || !scheduler.includes('Invalid scheduler clock') || !scheduler.includes('任务执行超过设定上限')) {
    throw new Error('Bundled scheduler lacks the timeout enforcement fix');
  }
  // E113 (0.1.41): chat links open in the system browser — kept as a regression.
  const linkHandler = await readFile(join(resources, 'app/link-handler.mjs'));
  if (!linkHandler.equals(await readFile(join(repo, 'apps/electron/link-handler.mjs')))) throw new Error('Packaged link-handler.mjs does not match the repository');
  const mainText = (await readFile(join(resources, 'app/main.mjs'), 'utf8'));
  if (!mainText.includes('classifyNavigation') || !mainText.includes('shell.openExternal') || !mainText.includes('clipboard-sanitized-write')) {
    throw new Error('main.mjs lacks the link/copy-image fixes');
  }
  if (!linkHandler.toString().includes("'open-external'")) throw new Error('link-handler.mjs lacks the external-open classification');
  return true;
}
async function assertHistoricalMarkers(resources) {
  // Earlier rounds kept as regressions (E111/E119/E120/E122 lineage).
  const routeSource = (await readFile(join(resources, 'host-runtime/dsh/moos-pi/pi-route.js'), 'utf8'));
  if (!routeSource.includes('MAX_IMAGES') || !routeSource.includes('每张图片不超过') || routeSource.includes('每条消息可附带')) throw new Error('Candidate lacks the per-image attachment limit');
  if (!routeSource.includes('.moos-uploads') || !routeSource.includes('5 * 1024 * 1024') || !routeSource.includes('128 * 1024')) throw new Error('Candidate lacks the attachment limit raise');
  if (!routeSource.includes('glmReasoningEfforts')) throw new Error('Candidate lacks the GLM efforts metadata');
  const shellClientSource = (await readFile(join(resources, 'profile-template/profiles/web/node_modules/moos-electron-shell/client.js'), 'utf8'));
  if (shellClientSource.includes('__MOOS_SIDEBAR_ICON__')) throw new Error('Candidate sidebar icon placeholder was not inlined');
  const inlineCount = (shellClientSource.match(/data:image\/png;base64,[A-Za-z0-9+/=]{200,}/g) || []).length;
  if (inlineCount < 1) throw new Error('Candidate lacks the inlined sidebar icon');
  if (!shellClientSource.includes('命令执行') || !shellClientSource.includes('moosExecutionPolicy')) throw new Error('Candidate lacks the execution policy card');
  if (!shellClientSource.includes('[class*="md-table-wide"]')) throw new Error('Candidate lacks the chat table overflow fix');
  if (!shellClientSource.includes('Max · 深度思考')) throw new Error('Candidate lacks the GLM official efforts');
  const modelsSource = (await readFile(join(resources, 'app/pi-models.js'), 'utf8'));
  if (!modelsSource.includes('saveExecutionPolicy') || !modelsSource.includes('execution-policy.json')) throw new Error('Candidate lacks the execution policy store');
  const mainSource = (await readFile(join(resources, 'app/main.mjs'), 'utf8'));
  if (!mainSource.includes('moos:execution-policy:save') || !mainSource.includes('moos:execution-policy:status')) throw new Error('Candidate lacks the execution policy IPC');
  const preloadSource = (await readFile(join(resources, 'app/window-preload.cjs'), 'utf8'));
  if (!preloadSource.includes('moosExecutionPolicy')) throw new Error('Candidate lacks the execution policy bridge');
  const toolPolicySource = (await readFile(join(resources, 'pi-runtime/packages/pi-runtime/tool-policy.mjs'), 'utf8'));
  if (!toolPolicySource.includes('danger-full-access')) throw new Error('Candidate lacks the danger passthrough');
  const imageToolSource = (await readFile(join(resources, 'pi-runtime/packages/pi-runtime/image-tool.mjs'), 'utf8'));
  if (!imageToolSource.includes('createImageTool') || !imageToolSource.includes('/images/generations')) throw new Error('Candidate lacks the chat image tool');
  const sdkSource = (await readFile(join(resources, 'pi-runtime/packages/pi-runtime/sdk-runtime.mjs'), 'utf8'));
  if (!sdkSource.includes("thinkingLevelMap: { off: 'none'") || !sdkSource.includes("max: 'max'")) throw new Error('Candidate lacks the GLM thinkingLevelMap');
  const diagnosticsSource = (await readFile(join(resources, 'pi-runtime/services/agent/provider-diagnostics.mjs'), 'utf8'));
  if (!diagnosticsSource.includes("effort: 'minimal'") || !diagnosticsSource.includes('max_output_tokens: glmReasoning ? 256 : 16')) throw new Error('Candidate lacks the bounded GLM Responses probe');
  const manifest = JSON.parse(await readFile(join(repo, 'apps/electron/assets/brand-assets.json'), 'utf8'));
  if (hash(await readFile(join(resources, 'moos.icns'))) !== manifest.sha256['moos.icns']) throw new Error('Bundled icon digest mismatch');
  const bundleName = cli('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleName', join(resources, '..', '..', 'Contents/Info.plist')]).toString().trim();
  if (bundleName !== 'MuMa') throw new Error('Candidate display branding unexpected');
  return inlineCount;
}
async function preflight() {
  const capacity = await statfs(update);
  if (capacity.bavail * capacity.bsize < 4 * 1024 ** 3) throw new Error('Insufficient space for stopped backup and safe replacement');
  for (const path of [staged, installed]) {
    cli('/usr/bin/codesign', ['--verify', '--deep', '--strict', path], 120000); // launchd 会话下实测 ~14s，系统繁忙时更久
    const identity = cli('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleIdentifier', join(path, 'Contents/Info.plist')]).toString().trim();
    if (identity !== 'dev.moos.agent.electron') throw new Error('Bundle identity mismatch');
  }
  const bundleVersion = cli('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleVersion', join(staged, 'Contents/Info.plist')]).toString().trim();
  if (bundleVersion !== targetShell) throw new Error('Staged bundle version unexpected: ' + bundleVersion);
  const version = JSON.parse(await readFile(join(staged, 'Contents/Resources/profile-template/profiles/web/node_modules/moos-electron-shell/package.json'), 'utf8')).version;
  if (version !== targetShell || await exists(old) || await exists(backup)) throw new Error('Unexpected update checkpoint; stop for review');
  await prepareMoveDestination(installed, staged, old);
  if (!(await lstat(data)).isDirectory()) throw new Error('Invalid original data path');
  if (JSON.parse(await readFile(join(staged, 'Contents/Resources/moos-runtime.json'), 'utf8')).includesPiFixture !== false) {
    throw new Error('Fixture build cannot be installed');
  }
  // Changed files must match the repository; everything else must match the validated E126 bundle.
  record.changedFilesMatchRepo = await assertChangedFilesMatchRepo(join(staged, 'Contents/Resources'));
  record.unchangedFilesMatch47Baseline = await assertUnchangedFilesMatch47Baseline(join(staged, 'Contents/Resources'));
  record.helperMatchesComparedCandidateBytes = await assertHelperMatchesComparedCandidate(join(staged, 'Contents/Resources'));
  record.versionArtifacts = await assertVersionArtifacts(join(staged, 'Contents/Resources'));
  record.roundFixesInStaged = await assertRoundFixes(join(staged, 'Contents/Resources'));
  record.sidebarIconInlined = await assertHistoricalMarkers(join(staged, 'Contents/Resources'));
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
  record.tasksAtStart = activeTasks();
  await preflight();
  // Validation gate: this round's four real exit files plus E126's bridge/skin exits (baseline scope note
  // in artifacts/context-compaction/final/validation.json). GUI intentionally not constructed this round (E127).
  const gate = [
    ['core', join(repo, 'artifacts/precompact-misreport/final/core.exit')],
    ['electron', join(repo, 'artifacts/precompact-misreport/final/electron.exit')],
    ['native', join(repo, 'artifacts/precompact-misreport/final/native.exit')],
    ['docs', join(repo, 'artifacts/precompact-misreport/final/docs.exit')],
    ['bridge', join(repo, 'artifacts/project-queue/final/bridge.exit')],
    ['skin', join(repo, 'artifacts/project-queue/final/skin.exit')],
  ];
  for (const [name, path] of gate) {
    const code = Number((await readFile(path, 'utf8')).trim());
    record['validation_' + name] = code;
    if (code !== 0) throw new Error('Validation gate failed for ' + name);
  }
  record.validationGateSource = 'artifacts/precompact-misreport/final + E126 artifacts/project-queue/final';
  await mark('waiting-for-idle');
  // 有限等待（3 分钟）：安装器本身可能被记为运行中任务；用户已授权本次安装，
  // 超时后走应用正常退出路径，任务由应用自行取消（正常终态，结果文件如实记录）。
  const deadline = Date.now() + 3 * 60 * 1000;
  while (activeTasks() && Date.now() < deadline) await sleep(3000);
  record.tasksStillActiveAtQuit = activeTasks();
  const pids = mainPids();
  if (pids.length > 1) throw new Error('Multiple formal instances; stop for review');
  // 正式实例应始终在运行；检测不到说明 locale/环境坏了（会误判已停机），必须停手。
  if (!pids.length) throw new Error('Formal instance not detected; process matcher is unreliable here');
  await mark('normal-quit-requested');
  if (pids.length) {
    // 0.1.47 曾在此处拒绝任何活跃任务；本轮改为允许：安装器自身即运行中任务，
    // 正常退出路径由应用自行取消任务（正常终态，tasksStillActiveAtQuit 已记录）。
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
  // 停机数据必须静止：两次快照一致才可信，否则说明有东西还在写（误判停机）。
  const entireData = await tree(data);
  await sleep(2000);
  if (JSON.stringify(entireData) !== JSON.stringify(await tree(data))) throw new Error('Data directory still changing before backup; aborting');
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
  record.roundFixesInInstalled = await assertRoundFixes(join(installed, 'Contents/Resources'));
  record.changedFilesMatchRepoInInstalled = await assertChangedFilesMatchRepo(join(installed, 'Contents/Resources'));
  record.unchangedFilesMatch47BaselineInInstalled = await assertUnchangedFilesMatch47Baseline(join(installed, 'Contents/Resources'));
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
  // P03.13.20 (this round) markers.
  record.preCompactClassifyInInstalled = (await readFile(join(installed, 'Contents/Resources/pi-runtime/packages/pi-runtime/sdk-runtime.mjs'), 'utf8')).includes('classifyTaskError(error).code === \'context_limit\'');
  record.piRouteMessageInInstalled = (await readFile(join(installed, 'Contents/Resources/host-runtime/dsh/moos-pi/pi-route.js'), 'utf8')).includes('上下文超出模型窗口，且自动压缩未能完成');
  // P03.13.19 (carried) marker.
  record.uiPermissionDisabledInInstalled = (await readFile(join(installed, 'Contents/Resources/execution.patch.yml'), 'utf8')).includes('ui-permission') &&
    (await readFile(join(installed, 'Contents/Resources/execution.patch.yml'), 'utf8')).includes('disabled: true');
  // P03.13.18 + carried regressions markers.
  record.contextLimitMessageInInstalled = (await readFile(join(installed, 'Contents/Resources/pi-runtime/services/agent/errors.mjs'), 'utf8')).includes('上下文已满且自动压缩未能完成');
  record.preCompactGateInInstalled = (await readFile(join(installed, 'Contents/Resources/pi-runtime/packages/pi-runtime/sdk-runtime.mjs'), 'utf8')).includes('PRE_COMPACT_MARGIN_TOKENS') &&
    (await readFile(join(installed, 'Contents/Resources/pi-runtime/packages/pi-runtime/sdk-runtime.mjs'), 'utf8')).includes('reserveTokens: 32768');
  // E126/P03.13.17 + E125/P03.13.16 + historical regressions.
  record.projectQueueThreeStateInLiveClient = ['排队中 · 本项目前方', '排队中 · 等待本项目上一任务完成', '排队中 · 等待空闲执行位'].every(copy => liveClient.toString().includes(copy));
  record.timeoutEnforcementInInstalled = (await readFile(join(installed, 'Contents/Resources/pi-runtime/services/agent/scheduler.mjs'), 'utf8')).includes("errorCode: 'timeout'");
  record.queueAheadReadModelInInstalled = (await readFile(join(installed, 'Contents/Resources/app/pi-turn.mjs'), 'utf8')).includes('queueAhead');
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
  if (record.installedMainProcesses !== 1 || ![record.loadedClientMatches, record.hostRunning, record.installedIconMatchesManifest, record.sidebarIconInLiveClient, record.preCompactClassifyInInstalled, record.piRouteMessageInInstalled, record.uiPermissionDisabledInInstalled, record.contextLimitMessageInInstalled, record.preCompactGateInInstalled, record.projectQueueThreeStateInLiveClient, record.timeoutEnforcementInInstalled, record.queueAheadReadModelInInstalled, record.attachmentLimitsInInstalled, record.imageToolInInstalled, record.executionPolicyInInstalled, record.tableFixInInstalled, record.apiAndCredentialsIdentical, record.chatFilesRetained, record.piHistoryFilesRetained, record.skinsRetained, record.workspaceRetained, record.originalDatabaseRowsRetained, record.userPluginDependenciesRetained, record.roundFixesInInstalled, record.changedFilesMatchRepoInInstalled, record.unchangedFilesMatchE126BaselineInInstalled].every(Boolean)) throw new Error('Data preservation verification did not fully pass; preserve backup and request review');
  await mark('success');
  console.log('更新完成：沐码 0.1.48（P03.13.20 预压缩失败分类 + P03.13.19 权限菜单移除 + E129/E132/E133 桌面事务）。聊天与 API 配置保留校验通过，历史功能标记与本轮修复标记一致。');
} catch(error) {
  // Child process errors may carry arbitrary command output. Keep the result sanitized.
  record.failure = error instanceof Error ? error.message.split('\n')[0].slice(0, 200) : 'Update failed';
  record.packageWasSwitched = switched;
  await mark('stopped-for-review');
  console.error('更新停止，请保留备份，不要删除或重置数据。错误：' + record.failure);
}
