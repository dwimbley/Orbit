/**
 * Preload script for the launch-error toast window.
 */
import { contextBridge, ipcRenderer } from 'electron';
const api = {
    onShow(cb) {
        ipcRenderer.on('toast:show', (_e, data) => cb(data));
    },
    dismiss: () => ipcRenderer.send('toast:dismiss'),
    removeFromWheel: () => ipcRenderer.send('toast:remove-app'),
    locateApp: () => ipcRenderer.send('toast:locate-app'),
};
contextBridge.exposeInMainWorld('orbit', api);
//# sourceMappingURL=toast.js.map