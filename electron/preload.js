'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('sentinel', {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  saveSettings: (patch) => ipcRenderer.invoke('app:save-settings', patch),
  getStats: () => ipcRenderer.invoke('stats:get'),
  refresh: () => ipcRenderer.invoke('stats:refresh'),
  testBt: (cfg) => ipcRenderer.invoke('stats:test-bt', cfg),
  testSsh: () => ipcRenderer.invoke('stats:test-ssh'),
  quit: () => ipcRenderer.invoke('app:quit'),
  previewTip: (tip) => ipcRenderer.invoke('app:preview-tip', tip),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  openPanel: () => ipcRenderer.invoke('app:open-panel'),
  window: {
    openDashboard: () => ipcRenderer.invoke('window:open-dashboard'),
    hideDashboard: () => ipcRenderer.invoke('window:hide-dashboard'),
    closeDashboard: () => ipcRenderer.invoke('window:close-dashboard'),
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    hideWidget: () => ipcRenderer.invoke('window:hide-widget'),
    showWidget: () => ipcRenderer.invoke('window:show-widget'),
    setWidgetVisible: (v) => ipcRenderer.invoke('window:set-widget-visible', v),
    setPin: (v) => ipcRenderer.invoke('window:set-pin', v),
    isPinned: () => ipcRenderer.invoke('window:is-pinned')
  },
  wallpaper: {
    get: () => ipcRenderer.invoke('wallpaper:get'),
    list: () => ipcRenderer.invoke('wallpaper:list'),
    pick: () => ipcRenderer.invoke('wallpaper:pick'),
    apply: (payload) => ipcRenderer.invoke('wallpaper:apply', payload),
    openFolder: () => ipcRenderer.invoke('wallpaper:open-folder')
  },
  terminal: {
    connect: (opts) => ipcRenderer.invoke('terminal:connect', opts || {}),
    input: (data) => ipcRenderer.send('terminal:input', data),
    resize: (cols, rows) => ipcRenderer.send('terminal:resize', { cols, rows }),
    disconnect: () => ipcRenderer.invoke('terminal:disconnect'),
    info: () => ipcRenderer.invoke('terminal:info')
  },
  onStats: (cb) => on('stats', cb),
  onWallpaper: (cb) => on('wallpaper:changed', cb),
  onTerminalData: (cb) => on('terminal:data', cb),
  onTerminalStatus: (cb) => on('terminal:status', cb),
  onNavigate: (cb) => on('navigate', cb),
  onWindowState: (cb) => on('window:state', cb),
  onSettings: (cb) => on('settings:changed', cb)
});
