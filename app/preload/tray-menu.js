/**
 * Preload script for the tray popup menu window.
 */
import { contextBridge, ipcRenderer } from 'electron';
const api = {
    onState(cb) {
        ipcRenderer.on('tray:state', (_e, state) => cb(state));
        // Request initial state
        ipcRenderer.send('tray:request-state');
    },
    tryTheWheel: () => { ipcRenderer.send('try-the-wheel'); ipcRenderer.send('tray:close'); },
    pause: (until) => { ipcRenderer.send('pause', until); ipcRenderer.send('tray:close'); },
    resume: () => { ipcRenderer.send('resume'); ipcRenderer.send('tray:close'); },
    openSettings: () => { ipcRenderer.send('open-settings'); ipcRenderer.send('tray:close'); },
    quit: () => ipcRenderer.send('app:quit'),
    closePopup: () => ipcRenderer.send('tray:close'),
};
contextBridge.exposeInMainWorld('orbit', api);
//# sourceMappingURL=tray-menu.js.map