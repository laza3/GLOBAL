import { contextBridge, ipcRenderer } from 'electron';

/** Surface minimale exposée au renderer : aucun accès Node, aucun jeton. */
contextBridge.exposeInMainWorld('gp', {
  call: (method: string, params?: unknown) => ipcRenderer.invoke('gp:call', method, params),
  system: (op: string, params?: unknown) => ipcRenderer.invoke('gp:system', op, params),
  onUpdate: (cb: (state: unknown) => void) => {
    const h = (_e: unknown, s: unknown) => cb(s);
    ipcRenderer.on('gp:update', h);
    return () => void ipcRenderer.removeListener('gp:update', h);
  },
});
