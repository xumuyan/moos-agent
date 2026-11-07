import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session } from 'electron';
import { cp, mkdir, readFile, lstat, rename, mkdtemp, rm } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { startHost } from './host.mjs';
import { piModels } from './pi-models.js';

app.setName('Moos');
const data = process.env.MOOS_ELECTRON_DATA ?? join(app.getPath('appData'), 'dev.moos.agent.electron');
if (!isAbsolute(data)) throw new Error('Moos data directory must be absolute');
app.setPath('userData', data);

let host;
let hostStopped = false;
let modelWindow;

function installModelSettings(resources, models) {
  const assets = join(resources, 'app');
  function senderAllowed(event) {
    if (!modelWindow || event.sender !== modelWindow.webContents || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('Untrusted Moos settings request');
    }
  }
  ipcMain.handle('moos:models:list', event => {
    senderAllowed(event);
    return models.list();
  });
  ipcMain.handle('moos:models:save', (event, profile) => {
    senderAllowed(event);
    return models.save(profile);
  });
  return () => {
    if (modelWindow) { modelWindow.focus(); return; }
    modelWindow = new BrowserWindow({
      title: 'Moos 模型服务', width: 580, height: 640, minWidth: 450, minHeight: 600,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
        preload: join(assets, 'model-settings-preload.cjs') },
    });
    modelWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    modelWindow.webContents.on('will-navigate', event => event.preventDefault());
    modelWindow.webContents.on('will-redirect', event => event.preventDefault());
    modelWindow.once('closed', () => { modelWindow = undefined; });
    void modelWindow.loadFile(join(assets, 'model-settings.html')).catch(() => {
      modelWindow?.close();
    });
  };
}

async function seedHome(resources, home) {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const profiles = join(home, 'profiles');
  const existing = await lstat(profiles).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (existing) {
    if (!existing.isDirectory()) throw new Error('Invalid Moos profile directory');
    return;
  }
  const staging = await mkdtemp(join(home, '.profile-'));
  try {
    await cp(join(resources, 'profile-template', 'profiles'), join(staging, 'profiles'), {
      recursive: true, verbatimSymlinks: true,
    });
    try { await rename(join(staging, 'profiles'), profiles); }
    catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error; }
  } finally { await rm(staging, { recursive: true, force: true }); }
}

async function updateShellPlugin(resources, home, cli) {
  const manifest = 'profiles/web/node_modules/moos-electron-shell/package.json';
  const readVersion = async root => JSON.parse(await readFile(join(root, manifest), 'utf8')).version;
  const version = await readVersion(join(resources, 'profile-template'));
  const installed = await readVersion(home).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (installed === version) return;
  const archive = join(resources, 'profile-template', 'profiles', 'web', 'local-bundles',
    `moos-electron-shell-${version}.tgz`);
  await promisify(execFile)(cli, ['plugin', '--profile', 'web', 'add', archive, '--offline', '--save-exact'], {
    env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }, timeout: 30000,
  });
}

async function launch() {
  const resources = process.resourcesPath;
  const { cli, includesPiFixture } = JSON.parse(await readFile(join(resources, 'moos-runtime.json'), 'utf8'));
  const enableFixture = process.env.MOOS_ELECTRON_PI_FIXTURE === '1';
  if (enableFixture && (!includesPiFixture || !process.env.MOOS_ELECTRON_DATA)) {
    throw new Error('PI fixture requires a fixture build and an explicit data directory');
  }
  const piRuntime = join(resources, 'pi-runtime');
  const piFixture = enableFixture ? piRuntime : undefined;
  const home = join(data, 'dsh');
  const workspace = join(data, 'workspace');
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  await seedHome(resources, home);
  await updateShellPlugin(resources, home, cli);

  host = startHost({
    cli, home, cwd: workspace, piRuntime, piFixture, executionPatch: join(resources, 'execution.patch.yml'),
    onUnexpectedExit() {
      dialog.showErrorBox('Moos', '本机工作台服务已退出，请重启 Moos。');
      app.quit();
    },
  });
  const address = await host.ready;
  const { checkedProvider } = await import(pathToFileURL(join(piRuntime, 'packages/pi-adapter/index.mjs')).href);
  const openModelSettings = installModelSettings(resources, piModels(data, checkedProvider));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Moos', submenu: [
      { role: 'about' }, { label: '模型服务…', accelerator: 'CmdOrCtrl+Shift+,', click: openModelSettings },
      { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' }, { role: 'quit' },
    ] },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]));

  const partition = session.fromPartition('persist:moos-workbench');
  partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  partition.setPermissionCheckHandler(() => false);
  const mac = process.platform === 'darwin';
  const win = new BrowserWindow({
    title: 'Moos', width: 1240, height: 820, minWidth: 760, minHeight: 480, show: false,
    ...(mac ? {
      titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 },
      vibrancy: 'sidebar', visualEffectState: 'active', backgroundColor: '#00000000',
    } : {}),
    webPreferences: { session: partition, sandbox: true, contextIsolation: true,
      nodeIntegration: false, webviewTag: false,
      ...(mac ? { preload: join(resources, 'app', 'window-preload.cjs') } : {}),
    },
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
else void app.whenReady().then(launch).catch(() => {
  dialog.showErrorBox('Moos', '无法打开工作台。请检查本机开发运行时后重试。');
  app.quit();
});
