import { app, BrowserWindow, dialog, Menu, session } from 'electron';
import { cp, mkdir, readFile, lstat, rename, mkdtemp, rm } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { startHost } from './host.mjs';

app.setName('Moos');
const data = process.env.MOOS_ELECTRON_DATA ?? join(app.getPath('appData'), 'dev.moos.agent.electron');
if (!isAbsolute(data)) throw new Error('Moos data directory must be absolute');
app.setPath('userData', data);

let host;
let hostStopped = false;

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

async function launch() {
  const resources = process.resourcesPath;
  const { cli } = JSON.parse(await readFile(join(resources, 'moos-runtime.json'), 'utf8'));
  const home = join(data, 'dsh');
  const workspace = join(data, 'workspace');
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  await seedHome(resources, home);

  host = startHost({ cli, home, cwd: workspace, onUnexpectedExit() {
    dialog.showErrorBox('Moos', '本机工作台服务已退出，请重启 Moos。');
    app.quit();
  } });
  const address = await host.ready;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu', label: 'Moos' },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]));

  const partition = session.fromPartition('persist:moos-workbench');
  partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  partition.setPermissionCheckHandler(() => false);
  const win = new BrowserWindow({
    title: 'Moos', width: 1240, height: 820, minWidth: 760, minHeight: 480, show: false,
    webPreferences: { session: partition, sandbox: true, contextIsolation: true,
      nodeIntegration: false, webviewTag: false },
  });
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
