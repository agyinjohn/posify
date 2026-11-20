// Posify desktop: a window around the Posify web app. The app itself is loaded from the shop's web address, so
// every update to the website reaches the desktop at once; this shell only updates through new installers
// (electron-updater, from GitHub Releases).
const { app, BrowserWindow, Menu, shell, dialog, ipcMain, screen } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs');
const path = require('node:path');

const CONFIG = () => path.join(app.getPath('userData'), 'config.json');
const readConfig = () => { try { return JSON.parse(fs.readFileSync(CONFIG(), 'utf8')); } catch { return {}; } };
const writeConfig = (patch) => { fs.mkdirSync(path.dirname(CONFIG()), { recursive: true }); fs.writeFileSync(CONFIG(), JSON.stringify({ ...readConfig(), ...patch }, null, 2)); };

// The shop's web address: POS_URL (testing) > saved by the person > baked into the installer > ask on first run.
function appUrl() {
  if (process.env.POS_URL) return process.env.POS_URL;
  if (readConfig().url) return readConfig().url;
  try { return require('./config.default.json').url || ''; } catch { return ''; }
}

// Only real web addresses: https, or http for this computer / the local network while testing.
function cleanUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('Enter the web address of your Posify');
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  const u = new URL(s);
  const local = /^(localhost|127\.0\.0\.1|192\.168\.|10\.)/.test(u.hostname);
  if (u.protocol !== 'https:' && !local) throw new Error('Use the https:// address of your Posify');
  return u.origin + (u.pathname === '/' ? '' : u.pathname.replace(/\/$/, ''));
}

let win = null;

function loadApp() {
  const url = appUrl();
  if (!url) return win.loadFile(path.join(__dirname, 'setup.html'));
  win.loadURL(url);
}

function createWindow() {
  const saved = readConfig().bounds;
  const area = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: saved?.width || Math.min(1366, area.width), height: saved?.height || Math.min(860, area.height),
    x: saved?.x, y: saved?.y, minWidth: 900, minHeight: 600,
    title: 'Posify', backgroundColor: '#F4F6F8', show: false, autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.js') },
  });
  if (readConfig().maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  const remember = () => { if (!win.isMaximized() && !win.isMinimized()) writeConfig({ bounds: win.getBounds() }); writeConfig({ maximized: win.isMaximized() }); };
  win.on('close', remember);

  // Pop-ups: the app opens blank windows to print labels and PDF lists, so those stay inside; any web link
  // goes to the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank' || url === '') {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 900, height: 700, autoHideMenuBar: true, title: 'Print', webPreferences: { sandbox: true } } };
    }
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // Stay on the shop's site; other sites open in the browser.
  win.webContents.on('will-navigate', (e, target) => {
    if (target.startsWith('file://')) return;
    const url = appUrl();
    if (url && new URL(target).origin !== new URL(url).origin) {
      e.preventDefault();
      if (/^https?:\/\//.test(target)) shell.openExternal(target);
    }
  });
  // Server unreachable: a retry page instead of a blank window.
  win.webContents.on('did-fail-load', (_e, code, _desc, failedUrl, isMainFrame) => {
    if (isMainFrame && code !== -3 && !failedUrl.startsWith('file://')) {
      win.loadFile(path.join(__dirname, 'offline.html'), { query: { url: appUrl() } });
    }
  });

  loadApp();
  if (app.isPackaged) setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 10_000);
}

// Setup and offline pages talk to the shell through preload.js.
ipcMain.handle('posify:get-url', () => appUrl());
ipcMain.handle('posify:set-url', (_e, input) => {
  const url = cleanUrl(input);
  writeConfig({ url });
  setTimeout(loadApp, 50);
  return url;
});
ipcMain.handle('posify:retry', () => { loadApp(); });
ipcMain.handle('posify:change-url', () => win.loadFile(path.join(__dirname, 'setup.html')));

function buildMenu() {
  const isMac = process.platform === 'darwin';
  return Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'Posify', submenu: [
      { label: 'Change shop address…', click: () => win?.loadFile(path.join(__dirname, 'setup.html')) },
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => win?.webContents.reload() },
      { type: 'separator' },
      { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { role: 'togglefullscreen' },
      { type: 'separator' },
      { label: 'Check for updates', click: () => autoUpdater.checkForUpdates().then((r) => {
        if (!r?.updateInfo || r.updateInfo.version === app.getVersion()) dialog.showMessageBox(win, { message: `Posify ${app.getVersion()} is up to date.` });
      }).catch(() => dialog.showMessageBox(win, { message: 'Could not check for updates. Try again later.' })) },
      { label: `About Posify ${app.getVersion()}`, click: () => dialog.showMessageBox(win, { message: `Posify desktop ${app.getVersion()}`, detail: `Shop address: ${appUrl() || 'not set'}` }) },
      ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }]),
    ] },
    { role: 'editMenu' },
  ]);
}

// Updates: download quietly, then offer a restart.
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on('update-downloaded', (info) => {
  dialog.showMessageBox(win, {
    type: 'info', title: 'Update ready', message: `Posify ${info.version} has been downloaded.`,
    detail: 'Restart now to use it, or it will be installed the next time you close Posify.',
    buttons: ['Restart now', 'Later'], defaultId: 0,
  }).then(({ response }) => { if (response === 0) autoUpdater.quitAndInstall(); });
});
autoUpdater.on('error', (err) => console.error('Update check failed:', err.message));

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => { Menu.setApplicationMenu(buildMenu()); createWindow(); });
  app.on('window-all-closed', () => app.quit());
}

module.exports = { cleanUrl };
