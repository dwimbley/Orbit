/**
 * Preload script for the overlay (wheel) window.
 * Exposes a minimal API through contextBridge.
 * The renderer receives display data only — no file paths, no node APIs.
 */
import { contextBridge, ipcRenderer } from 'electron';

export interface WheelWedge {
  index: number;
  appId: string;
  name: string;
  iconDataUrl: string | null;
  monogram: string;
  monogramColor: string;
  monogramInk: string;
  isSpecial: boolean;
  specialKind?: 'more' | 'add' | 'choose';
  badge?: 'DEFAULT' | 'PINNED';
}

export interface WheelData {
  wedges: WheelWedge[];
  fileName: string;
  fileExtLabel: string;
  metaText: string;
  isEmpty: boolean;
  emptyText?: string;
  isKeyboardMode: boolean;
  size: 'S' | 'M' | 'L';
}

export interface OverlayAPI {
  onShow(callback: (data: WheelData) => void): void;
  onHide(callback: () => void): void;
  onHoverChange(callback: (target: { type: 'center' | 'wedge' | 'outside'; index?: number }) => void): void;
  onKeyboardFocusChange(callback: (index: number) => void): void;
  /** In keyboard mode, user pressed Enter on a wedge */
  selectWedge(index: number): void;
  /** In keyboard mode, user pressed Escape */
  dismiss(): void;
}

const api: OverlayAPI = {
  onShow(callback) {
    ipcRenderer.on('wheel:show', (_event, data: WheelData) => callback(data));
  },
  onHide(callback) {
    ipcRenderer.on('wheel:hide', () => callback());
  },
  onHoverChange(callback) {
    ipcRenderer.on('wheel:hover', (_event, target) => callback(target));
  },
  onKeyboardFocusChange(callback) {
    ipcRenderer.on('wheel:keyboard-focus', (_event, index: number) => callback(index));
  },
  selectWedge(index: number) {
    ipcRenderer.send('wheel:select', index);
  },
  dismiss() {
    ipcRenderer.send('wheel:dismiss');
  },
};

contextBridge.exposeInMainWorld('orbit', api);
