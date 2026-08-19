import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('ohlr', {
  health: () => ipcRenderer.invoke('app:health') as Promise<{ ok: boolean; runtime: string }>,
});
