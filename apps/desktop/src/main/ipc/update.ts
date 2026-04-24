import type { BrowserWindow as ElectronBrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { app, ipcMain } from '../electron-runtime';
import { getLogger } from '../logger';

// Cached update-available payload so a window opened after the event still
// shows the banner. Cleared only on app quit (matching the one-shot nature
// of autoUpdater — a new check will re-emit if still applicable).
let pendingUpdateAvailable: unknown = null;

export function getPendingUpdate(): unknown {
  return pendingUpdateAvailable;
}

export function setupAutoUpdater(getMainWindow: () => ElectronBrowserWindow | null): void {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = false;
  autoUpdater.on('update-available', (info) => {
    pendingUpdateAvailable = info;
    getMainWindow()?.webContents.send('codesign:update-available', info);
  });
  autoUpdater.on('error', (err) => {
    getLogger('main:updates').error('autoUpdater.error', {
      message: err.message,
      stack: err.stack,
    });
  });
  ipcMain.handle('codesign:check-for-updates', () => autoUpdater.checkForUpdates());
  ipcMain.handle('codesign:download-update', () => autoUpdater.downloadUpdate());
  ipcMain.handle('codesign:install-update', () => autoUpdater.quitAndInstall());
}
