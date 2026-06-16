// ============================================================
//  Acıbadem DigitAlive — Preload Köprüsü (v1.2)
//  v1.2: bulkExec eklendi (toplu yazma için, Aşama 3'te kullanılacak)
// ============================================================
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('db', {
  query: (sql, params) => ipcRenderer.invoke('db:query', sql, params || []),
  queryOne: (sql, params) => ipcRenderer.invoke('db:queryOne', sql, params || []),
  exec: (sql, params) => ipcRenderer.invoke('db:exec', sql, params || []),

  // Toplu yazma — 300.000 kayıt için kritik
  bulkExec: (sql, paramsArray) => ipcRenderer.invoke('db:bulkExec', sql, paramsArray || []),

  info: () => ipcRenderer.invoke('db:info'),
  backup: (targetPath) => ipcRenderer.invoke('db:backup', targetPath),
  ready: () => ipcRenderer.invoke('db:ready'),
});

contextBridge.exposeInMainWorld('digitalive', {
  isDesktop: true,
  version: '1.2.0',
  userDataPath: () => ipcRenderer.invoke('app:userData'),
});

console.log('[Preload] Köprü hazır — window.db ve window.digitalive kullanıma açık.');
