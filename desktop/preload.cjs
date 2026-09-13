const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('sorteo', {
  pickDbFolder: () => ipcRenderer.invoke('pick-db-folder'),

  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChange: (listener) => {
      const wrapped = (_event, maximized) => listener(maximized)
      ipcRenderer.on('window:maximized', wrapped)
      return () => ipcRenderer.removeListener('window:maximized', wrapped)
    },
  },

  update: {
    state: () => ipcRenderer.invoke('update:state'),
    installNow: () => ipcRenderer.invoke('update:install'),
    onChange: (listener) => {
      const wrapped = (_event, state) => listener(state)
      ipcRenderer.on('update:state', wrapped)
      return () => ipcRenderer.removeListener('update:state', wrapped)
    },
  },
})
