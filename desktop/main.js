// Thin desktop shell around the hosted web app. Updates to the web app reach the desktop
// install automatically because the window just loads the server's URL.
// The Electron shell itself is updated via electron-updater (GitHub Releases).
const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs');
const path = require('node:path');

// ── Auto-updater setup ────────────────────────────────────────────────────────
// Silent check: no dialog until an update is actually downloaded.
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('update-downloaded', (info) => {
  dialog.showMessageBox({
    type: 'info',
    title: 'Update ready',
    message: `Shop POS ${info.version} has been downloaded.`,
    detail: 'Restart now to apply the update, or it will be applied next time you close the app.',
    buttons: ['Restart now', 'Later'],
    defaultId: 0,
  }).then(({ response }) => {
    if (response === 0) autoUpdater.quitAndInstall();
  });
});

autoUpdater.on('error', (err) => {
  // Log silently — a failed update check must never crash the app.
  console.error('Auto-update error:', err.message);
});

// ── App URL ───────────────────────────────────────────────────────────────────
function appUrl() {
  if (process.env.POS_URL) return process.env.POS_URL;
  try {
    // Installer can drop a config.json in the user data folder to point at the live server.
    return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'config.json'), 'utf8')).url;
  } catch { /* fall through */ }
  return require('./config.default.json').url;
}

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  const url = appUrl();
  const origin = new URL(url).origin;
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600, backgroundColor: '#17212B',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  Menu.setApplicationMenu(null);

  // Keep the window on the POS server; send everything else to the normal browser.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https:\/\//.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, target) => {
    if (new URL(target).origin !== origin && !target.startsWith('file://')) {
      e.preventDefault();
      if (/^https:\/\//.test(target)) shell.openExternal(target);
    }
  });

  // If the server can't be reached, show a retry page instead of a blank window.
  win.webContents.on('did-fail-load', (_e, code, _desc, failedUrl, isMainFrame) => {
    if (isMainFrame && code !== -3 && failedUrl.startsWith(origin)) {
      win.loadFile(path.join(__dirname, 'offline.html'), { query: { url } });
    }
  });

  win.loadURL(url);

  // Check for a new shell version 10 s after launch so it doesn't slow startup.
  // Only runs in a packaged build — dev mode has no update feed.
  if (app.isPackaged) {
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 10_000);
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
if (!app.requestSingleInstanceLock()) app.quit();
