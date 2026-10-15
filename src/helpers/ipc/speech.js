const { ipcMain, BrowserWindow } = require('electron');
module.exports = function register(ctx) {
  const manager = ctx.speechEngineManager;
  manager.on('state', state => {
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('speech-engine-state', state);
  });
  const sendOwner = (event, data) => {
    const owner = manager.job?.owner;
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed() && win.webContents.id === owner) win.webContents.send(event, data);
  };
  manager.on('preview', data => sendOwner('speech-preview', data));
  manager.on('comparison-progress', data => sendOwner('speech-comparison-progress', data));
  manager.on('job-error', data => sendOwner('speech-job-error', data));
  ipcMain.handle('speech-engine-state', () => manager.checkState());
  ipcMain.handle('speech-engine-select', async (_event, key, value) => {
    const state = await manager.select(key, value);
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('setting-changed', { key, value });
    return state;
  });
  ipcMain.handle('speech-engine-retry', () => manager.retry());
  ipcMain.handle('speech-engine-install', () => manager.install());
  ipcMain.handle('speech-job-begin', (event, kind) => {
    const job = manager.begin(kind, event.sender.id);
    // A renderer crash must not hold the recording/switch lock forever.
    const ended = () => manager.end(job.id, event.sender.id, true).catch(() => {});
    event.sender.once('destroyed', ended);
    event.sender.once('render-process-gone', ended);
    job.releaseOwnerListener = undefined;
    manager.job.releaseOwnerListener = () => { event.sender.removeListener('destroyed', ended); event.sender.removeListener('render-process-gone', ended); };
    return job;
  });
  ipcMain.handle('speech-job-end', (event, id, cancel) => manager.end(id, event.sender.id, cancel === true));
  ipcMain.handle('speech-session-start', (event, id, format) => manager.startSession(id, event.sender.id, format));
  ipcMain.handle('speech-session-feed', (event, id, packet) => manager.feed(id, event.sender.id, packet));
  ipcMain.handle('speech-job-cancel', (event, id) => manager.cancel(id, event.sender.id));
  ipcMain.handle('speech-session-finish', (event, id, audio, options) => manager.finishSession(id, event.sender.id, audio, options));
};
