/**
 * Preload script for the dangerous-open confirmation dialog.
 */
import { contextBridge, ipcRenderer } from 'electron';
const api = {
    onShow(cb) {
        ipcRenderer.on('confirm:show', (_e, data) => cb(data));
    },
    cancel: () => ipcRenderer.send('confirm:cancel'),
    confirm: () => ipcRenderer.send('confirm:proceed'),
    openInNotepad: () => ipcRenderer.send('confirm:notepad'),
};
contextBridge.exposeInMainWorld('orbit', api);
//# sourceMappingURL=confirm.js.map