/**
 * Preload script for the settings window.
 * Exposes settings read/write, app management, and window controls.
 */
import { contextBridge, ipcRenderer } from 'electron';

export interface SettingsData {
  activation: {
    mode: 'auto' | 'modifier';
    delayMs: number;
    modifier: 'Alt' | 'Ctrl' | 'Shift';
  };
  wheel: {
    size: 'S' | 'M' | 'L';
    maxWedges: number;
    motion: 'system' | 'reduce';
  };
  launchAtLogin: boolean;
  paused: { until: string | null };
}

export interface AppRow {
  id: string;
  name: string;
  iconDataUrl: string | null;
  monogram: string;
  monogramColor: string;
  monogramInk: string;
  exePath: string | null;
  packageDisplay: string | null;
  tags: Array<{ label: string; type: 'pinned' | 'default' | 'association' | 'compatible' | 'user' }>;
  usageCount: number;
  isPinned: boolean;
  isDefault: boolean;
  isHideable: boolean;
}

export interface ExtensionInfo {
  ext: string;
  friendlyType: string;
  mime: string | null;
  appCount: number;
}

export interface HistoryStats {
  opensRecorded: number;
  fileTypes: number;
  recordingSince: string;
}

export interface StatusInfo {
  working: boolean;
  reason?: string;
  monitorCount: number;
  elevated: boolean;
}

export interface SettingsAPI {
  // Window controls
  minimize(): void;
  close(): void;

  // Settings
  getSettings(): Promise<SettingsData>;
  updateSettings(partial: Partial<SettingsData>): Promise<void>;
  onSettingsChanged(callback: (settings: SettingsData) => void): void;

  // Status
  getStatus(): Promise<StatusInfo>;
  checkAgain(): Promise<StatusInfo>;

  // Pause
  pause(until: 'hour' | 'tomorrow' | 'indefinite'): void;
  resume(): void;

  // Applications tab
  getExtensions(): Promise<ExtensionInfo[]>;
  getAppsForExtension(ext: string): Promise<AppRow[]>;
  getHiddenAppsForExtension(ext: string): Promise<AppRow[]>;
  pinApp(ext: string, appId: string, pinned: boolean): Promise<void>;
  hideApp(ext: string, appId: string): Promise<void>;
  showApp(ext: string, appId: string): Promise<void>;
  reorderApps(ext: string, appIds: string[]): Promise<void>;
  resetExtension(ext: string): Promise<void>;

  // Add application dialog
  browseForExe(): Promise<{ path: string; name: string } | null>;
  addApplication(app: { exePath: string; name: string; extensions: string[] }): Promise<void>;

  // History
  getHistoryStats(): Promise<HistoryStats>;
  resetHistory(): Promise<void>;
  onHistoryReset(callback: () => void): void;

  // Try the wheel
  tryTheWheel(): void;

  // Misc
  openSettingsFolder(): void;
  getVersion(): Promise<string>;
  getMonitorCount(): Promise<number>;

  // Preview wheel data
  getPreviewWheelData(size: 'S' | 'M' | 'L', maxWedges: number): Promise<{
    wedges: Array<{
      name: string;
      iconDataUrl: string | null;
      monogram: string;
      monogramColor: string;
      monogramInk: string;
      isSpecial: boolean;
      specialKind?: string;
      badge?: string;
    }>;
  }>;
}

const api: SettingsAPI = {
  minimize: () => ipcRenderer.send('settings:minimize'),
  close: () => ipcRenderer.send('settings:close'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (partial) => ipcRenderer.invoke('settings:update', partial),
  onSettingsChanged: (cb) => ipcRenderer.on('settings:changed', (_e, s) => cb(s)),

  getStatus: () => ipcRenderer.invoke('status:get'),
  checkAgain: () => ipcRenderer.invoke('status:check'),

  pause: (until) => ipcRenderer.send('pause', until),
  resume: () => ipcRenderer.send('resume'),

  getExtensions: () => ipcRenderer.invoke('apps:extensions'),
  getAppsForExtension: (ext) => ipcRenderer.invoke('apps:for-ext', ext),
  getHiddenAppsForExtension: (ext) => ipcRenderer.invoke('apps:hidden-for-ext', ext),
  pinApp: (ext, appId, pinned) => ipcRenderer.invoke('apps:pin', ext, appId, pinned),
  hideApp: (ext, appId) => ipcRenderer.invoke('apps:hide', ext, appId),
  showApp: (ext, appId) => ipcRenderer.invoke('apps:show', ext, appId),
  reorderApps: (ext, appIds) => ipcRenderer.invoke('apps:reorder', ext, appIds),
  resetExtension: (ext) => ipcRenderer.invoke('apps:reset-ext', ext),

  browseForExe: () => ipcRenderer.invoke('apps:browse-exe'),
  addApplication: (app) => ipcRenderer.invoke('apps:add', app),

  getHistoryStats: () => ipcRenderer.invoke('history:stats'),
  resetHistory: () => ipcRenderer.invoke('history:reset'),
  onHistoryReset: (cb) => ipcRenderer.on('history:did-reset', () => cb()),

  tryTheWheel: () => ipcRenderer.send('try-the-wheel'),

  openSettingsFolder: () => ipcRenderer.send('open-settings-folder'),
  getVersion: () => ipcRenderer.invoke('app:version'),
  getMonitorCount: () => ipcRenderer.invoke('app:monitor-count'),

  getPreviewWheelData: (size, maxWedges) => ipcRenderer.invoke('wheel:preview', size, maxWedges),
};

contextBridge.exposeInMainWorld('orbit', api);
