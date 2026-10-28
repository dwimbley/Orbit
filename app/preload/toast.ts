/**
 * Preload script for the launch-error toast window.
 */
import { contextBridge, ipcRenderer } from 'electron';

export interface ToastData {
  appName: string;
  reason: string;
  exePath?: string;
  fileName: string;
  isNotFound: boolean;
}

export interface ToastAPI {
  onShow(callback: (data: ToastData) => void): void;
  dismiss(): void;
  removeFromWheel(): void;
  locateApp(): void;
}

const api: ToastAPI = {
  onShow(cb) {
    ipcRenderer.on('toast:show', (_e, data: ToastData) => cb(data));
  },
  dismiss: () => ipcRenderer.send('toast:dismiss'),
  removeFromWheel: () => ipcRenderer.send('toast:remove-app'),
  locateApp: () => ipcRenderer.send('toast:locate-app'),
};

contextBridge.exposeInMainWorld('orbit', api);
