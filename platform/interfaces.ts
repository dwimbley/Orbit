// DragDetector - emits drag lifecycle events
export interface DragDetectorConfig {
  mode: 'auto' | 'modifier';
  delayMs: number;
  modifier: 'Alt' | 'Ctrl' | 'Shift';
}

export type DragEvent =
  | { type: 'pending'; cursorX: number; cursorY: number }
  | { type: 'surfaceRequested'; cursorX: number; cursorY: number }
  | { type: 'ended' };

export interface DragDetector {
  start(config: DragDetectorConfig): void;
  stop(): void;
  updateConfig(config: Partial<DragDetectorConfig>): void;
  onEvent(callback: (event: DragEvent) => void): void;
}

// DropSurface - OLE drop target
export interface DropSurfaceGeometry {
  centerX: number; centerY: number;
  outerRadius: number; innerRadius: number;
  wedgeCount: number; isEmpty: boolean;
  scale: number;
}

export type DropEvent =
  | { type: 'enter'; items: DroppedItem[] }
  | { type: 'hover'; target: HoverTarget }
  | { type: 'drop'; target: HoverTarget; items: DroppedItem[] }
  | { type: 'leave' };

export type HoverTarget =
  | { type: 'center' }
  | { type: 'wedge'; index: number }
  | { type: 'outside' };

export interface DroppedItem {
  path: string;
  isFolder: boolean;
  extension: string; // lowercase with dot
  displayName: string;
}

export interface DropSurface {
  show(rect: { x: number; y: number; width: number; height: number }, geometry: DropSurfaceGeometry): void;
  hide(): void;
  onEvent(callback: (event: DropEvent) => void): void;
}

// FileTypeInfo
export interface FileTypeInfo {
  typeName: string;
  mime: string | null;
  perceivedType: string | null;
  size: number;
  childCount?: number; // for folders
}

// AppDiscovery
export interface DiscoveredApp {
  id: string;
  name: string;
  exePath: string | null;
  packageFamilyName: string | null;
  aumid: string | null;
  isDefault: boolean;
  isRecommended: boolean;
  iconPng: Buffer | null; // 80x80 PNG
  source: 'os' | 'catalog' | 'user';
  handlerId: string | null; // opaque ID for IAssocHandler
}

export interface AppDiscovery {
  getHandlersForExtension(ext: string): Promise<DiscoveredApp[]>;
  getDefaultHandler(ext: string): Promise<DiscoveredApp | null>;
  detectCatalogApps(): Promise<Map<string, DiscoveredApp>>;
  getAppIcon(appId: string): Promise<Buffer | null>;
  refresh(): Promise<void>;
}

// AppLauncher
export interface LaunchResult {
  success: boolean;
  error?: string;
  errorCode?: number;
}

export interface AppLauncher {
  invokeHandler(handlerId: string, filePaths: string[]): Promise<LaunchResult>;
  activatePackaged(aumid: string, filePaths: string[]): Promise<LaunchResult>;
  spawnExe(exePath: string, args: string[], workingDir: string): Promise<LaunchResult>;
  openWithDialog(filePath: string): Promise<LaunchResult>;
  isDangerous(ext: string): Promise<boolean>;
  hasMotw(filePath: string): Promise<boolean>;
}

// DisplayInfo
export interface MonitorInfo {
  id: string;
  x: number; y: number;
  width: number; height: number;
  workAreaX: number; workAreaY: number;
  workAreaWidth: number; workAreaHeight: number;
  scale: number;
  isPrimary: boolean;
}

export interface DisplayInfo {
  getCursorPosition(): { x: number; y: number };
  getMonitors(): MonitorInfo[];
  getMonitorForPoint(x: number, y: number): MonitorInfo;
  isElevated(): boolean;
  isReducedMotion(): boolean;
}

// Platform adapter that combines all
export interface PlatformAdapter {
  dragDetector: DragDetector;
  dropSurface: DropSurface;
  appDiscovery: AppDiscovery;
  appLauncher: AppLauncher;
  displayInfo: DisplayInfo;
  getFileTypeInfo(filePath: string): Promise<FileTypeInfo>;
}

// NotImplemented error for stub platforms
export class NotImplementedError extends Error {
  constructor(platform: string, feature: string) {
    super(`${feature} is not implemented on ${platform}`);
    this.name = 'NotImplementedError';
  }
}
