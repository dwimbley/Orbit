/**
 * Preload script for the dangerous-open confirmation dialog.
 */
import { contextBridge, ipcRenderer } from 'electron';

export interface ConfirmData {
  title: string; // "Run this script?" / "Run this program?" / "Open this shortcut?"
  extLabel: string; // "PS1", "EXE", etc.
  fileName: string;
  description: string;
  hasMotw: boolean;
  showNotepadLink: boolean;
  actionLabel: string; // "Run script" / "Run program" / "Open shortcut"
}

export interface ConfirmAPI {
  onShow(callback: (data: ConfirmData) => void): void;
  cancel(): void;
  confirm(): void;
  openInNotepad(): void;
}

const api: ConfirmAPI = {
  onShow(cb) {
    ipcRenderer.on('confirm:show', (_e, data: ConfirmData) => cb(data));
  },
  cancel: () => ipcRenderer.send('confirm:cancel'),
  confirm: () => ipcRenderer.send('confirm:proceed'),
  openInNotepad: () => ipcRenderer.send('confirm:notepad'),
};

contextBridge.exposeInMainWorld('orbit', api);
