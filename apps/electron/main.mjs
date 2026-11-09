import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session } from 'electron';
import { mkdir, readFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startHost } from './host.mjs';
import { piModels } from './pi-models.js';
import { createPiUsageReader } from './pi-usage.mjs';
import { createPiTurnReader } from './pi-turn.mjs';
import { seedHome, profileRecoveryMessage } from './profile-home.mjs';
import { updateShellPlugin, shellUpdateMessage } from './shell-update.mjs';

app.setName('MuMa');
const data = process.env.MOOS_ELECTRON_DATA ?? join(app.getPath('appData'), 'dev.moos.agent.electron');
if (!isAbsolute(data)) throw new Error('MuMa data directory must be absolute');
app.setPath('userData', data);

let host;
let hostStopped = false;

async function launch() {
  const resources = process.resourcesPath;
  const { includesPiFixture } = JSON.parse(await readFile(join(resources, 'moos-runtime.json'), 'utf8'));
  const cli = join(resources, 'host-runtime', 'bin', 'dsh');
  const enableFixture = process.env.MOOS_ELECTRON_PI_FIXTURE === '1';
  if (enableFixture && (!includesPiFixture || !process.env.MOOS_ELECTRON_DATA)) {
    throw new Error('PI fixture requires a fixture build and an explicit data directory');
  }
  const piRuntime = join(resources, 'pi-runtime');
  const piFixture = enableFixture ? piRuntime : undefined;
  const home = join(data, 'dsh');
  const workspace = join(data, 'workspace');
  const tempDir = join(data, 'host-tmp');
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  await mkdir(tempDir, { recursive: true, mode: 0o700 });
  await seedHome(resources, home);
  await updateShellPlugin(resources, home, cli);

  host = startHost({
    cli, home, cwd: workspace, tempDir, piRuntime, piFixture, executionPatch: join(resources, 'execution.patch.yml'),
    onUnexpectedExit() {
      dialog.showErrorBox('MuMa · 沐码', '本机工作台服务已退出，请重启 MuMa（沐码）。');
      app.quit();
    },
  });
  const address = await host.ready;
  const [{ checkedProvider }, { timelinePayload }, { diagnoseProvider }] = await Promise.all([
    import(pathToFileURL(join(piRuntime, 'packages/pi-adapter/index.mjs')).href),
    import(pathToFileURL(join(piRuntime, 'services/agent/timeline-view.mjs')).href),
    import(pathToFileURL(join(piRuntime, 'services/agent/provider-diagnostics.mjs')).href),
  ]);
  const partition = session.fromPartition('persist:moos-workbench');
  partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  partition.setPermissionCheckHandler(() => false);
  const mac = process.platform === 'darwin';
  const win = new BrowserWindow({
    title: 'MuMa · 沐码', width: 1240, height: 820, minWidth: 760, minHeight: 480, show: false,
    ...(mac ? {
      titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 },
      vibrancy: 'sidebar', visualEffectState: 'active', backgroundColor: '#00000000',
    } : {}),
    webPreferences: { session: partition, sandbox: true, contextIsolation: true,
      nodeIntegration: false, webviewTag: false,
      ...(mac ? { preload: join(resources, 'app', 'window-preload.cjs') } : {}),
    },
  });
  const models = piModels(data, checkedProvider);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'MuMa', submenu: [
      { role: 'about' }, { label: '模型服务…', accelerator: 'CmdOrCtrl+Shift+,', click: () => {
        if (!win.isDestroyed()) {
          if (win.isMinimized()) win.restore();
          win.focus();
          win.webContents.send('moos:open-model-settings');
        }
      } },
      { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' }, { role: 'quit' },
    ] },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]));
  const dbPath = join(data, enableFixture ? 'pi-fixture' : 'pi', 'moos.sqlite');
  const usage = createPiUsageReader(dbPath);
  const turns = createPiTurnReader(dbPath, timelinePayload);
  function verifyWorkbench(event) {
    const frame = event.senderFrame;
    if (event.sender !== win.webContents || !frame || frame !== win.webContents.mainFrame
      || new URL(frame.url).origin !== address.origin) throw new Error('Untrusted MuMa workbench request');
  }
  ipcMain.handle('moos:pi-usage', (event, sessionId) => {
    verifyWorkbench(event);
    return usage.read(sessionId);
  });
  ipcMain.handle('moos:pi-turn', (event, sessionId, startSeq) => {
    verifyWorkbench(event);
    return turns.read(sessionId, startSeq);
  });
  ipcMain.handle('moos:pi-active', event => {
    verifyWorkbench(event);
    return turns.active();
  });
  const modelHandlers = {
    'moos:models:list': () => models.groups(),
    'moos:models:save': input => models.saveGroup(input),
    'moos:models:remove': id => models.removeGroup(id),
    'moos:models:discover': input => models.diagnoseGroup('list_models', input, diagnoseProvider),
    'moos:models:test': input => models.diagnoseGroup('test_provider', input, diagnoseProvider),
    'moos:image-gen:status': () => models.imageStatus(),
    'moos:image-gen:save': input => models.saveImageGen(input),
    'moos:image-gen:test': input => models.testImageGen(input),
    'moos:execution-policy:status': () => models.executionPolicy(),
    'moos:execution-policy:save': input => models.saveExecutionPolicy(input),
  };
  for (const [channel, handle] of Object.entries(modelHandlers)) {
    ipcMain.handle(channel, (event, input) => {
      verifyWorkbench(event);
      return handle(input);
    });
  }
  win.once('closed', () => {
    ipcMain.removeHandler('moos:pi-usage');
    ipcMain.removeHandler('moos:pi-turn');
    ipcMain.removeHandler('moos:pi-active');
    for (const channel of Object.keys(modelHandlers)) ipcMain.removeHandler(channel);
    usage.close();
    turns.close();
  });
  if (mac) {
    const syncFullscreen = () => {
      if (!win.isDestroyed()) win.webContents.send('moos:window-fullscreen', win.isFullScreen());
    };
    win.on('enter-full-screen', syncFullscreen);
    win.on('leave-full-screen', syncFullscreen);
    win.webContents.on('did-finish-load', () => {
      syncFullscreen();
      // Moos omits the upstream logo, so show the existing panel control at rest.
      void win.webContents.insertCSS(
        'html[data-platform="darwin"] [data-sidebar-toggle] > svg { display: inline !important; }',
      ).catch(() => {});
    });

    // Keep an opaque backing while macOS reattaches the sidebar material.
    const syncBackdrop = () => {
      const hidden = win.isMinimized() || !win.isVisible();
      win.setVibrancy(hidden ? null : 'sidebar');
      win.setBackgroundColor(hidden
        ? (nativeTheme.shouldUseDarkColors ? '#1b1b1c' : '#f9fafb') : '#00000000');
    };
    for (const event of ['minimize', 'hide', 'restore', 'show']) win.on(event, syncBackdrop);
  }
  win.on('page-title-updated', event => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const preventRemoteNavigation = (event, target) => {
    try {
      if (new URL(target).origin === address.origin) return;
    } catch { /* deny malformed targets */ }
    event.preventDefault();
  };
  win.webContents.on('will-navigate', preventRemoteNavigation);
  win.webContents.on('will-redirect', preventRemoteNavigation);
  win.once('ready-to-show', () => win.show());
  await win.loadURL(address.href);
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (!host || hostStopped) return;
  event.preventDefault();
  void host.stop().finally(() => { hostStopped = true; app.quit(); });
});
if (!app.requestSingleInstanceLock()) app.quit();
else void app.whenReady().then(launch).catch(error => {
  dialog.showErrorBox('MuMa · 沐码', error?.code === 'MOOS_PROFILE_RECOVERY_REQUIRED'
    ? profileRecoveryMessage : error?.code === 'MOOS_SHELL_UPDATE_FAILED'
      ? shellUpdateMessage : '无法打开工作台。请检查本机开发运行时后重试。');
  app.quit();
});
