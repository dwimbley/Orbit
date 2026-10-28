/**
 * Preload script for the overlay (wheel) window.
 * Exposes a minimal API through contextBridge.
 * The renderer receives display data only — no file paths, no node APIs.
 */
import { contextBridge, ipcRenderer } from 'electron';
const api = {
    onShow(callback) {
        ipcRenderer.on('wheel:show', (_event, data) => callback(data));
    },
    onHide(callback) {
        ipcRenderer.on('wheel:hide', () => callback());
    },
    onHoverChange(callback) {
        ipcRenderer.on('wheel:hover', (_event, target) => callback(target));
    },
    onKeyboardFocusChange(callback) {
        ipcRenderer.on('wheel:keyboard-focus', (_event, index) => callback(index));
    },
    selectWedge(index) {
        ipcRenderer.send('wheel:select', index);
    },
    dismiss() {
        ipcRenderer.send('wheel:dismiss');
    },
};
contextBridge.exposeInMainWorld('orbit', api);
//# sourceMappingURL=overlay.js.map