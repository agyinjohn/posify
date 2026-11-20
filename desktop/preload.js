// Only the shell's own pages (setup and offline) get these; the website never does.
const { contextBridge, ipcRenderer } = require('electron');
if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('posify', {
    getUrl: () => ipcRenderer.invoke('posify:get-url'),
    setUrl: (url) => ipcRenderer.invoke('posify:set-url', url),
    retry: () => ipcRenderer.invoke('posify:retry'),
    changeUrl: () => ipcRenderer.invoke('posify:change-url'),
  });
}
