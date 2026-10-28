import type {
  PlatformAdapter,
  DragDetector,
  DragDetectorConfig,
  DragEvent,
  DropSurface,
  DropSurfaceGeometry,
  DropEvent,
  AppDiscovery,
  DiscoveredApp,
  AppLauncher,
  LaunchResult,
  DisplayInfo,
  MonitorInfo,
  FileTypeInfo,
} from '../interfaces.js';

// Try to load the native addon; null if not compiled yet
let native: any = null;
try {
  const _path = require('path');
  // __dirname at runtime is dist/platform/windows/ — project root is 3 levels up
  const addonPath = _path.resolve(__dirname, '..', '..', '..', 'native', 'filewheel-native', 'build', 'Release', 'filewheel-native.node');
  native = require(addonPath);
  console.log('[Orbit] Native addon loaded successfully.');
} catch (e: any) {
  console.warn('[Orbit] Native addon not available:', e.message, '— running in degraded mode.');
}

const NATIVE_MISSING: LaunchResult = { success: false, error: 'Native addon not compiled' };

class WindowsDragDetector implements DragDetector {
  private callback: ((event: DragEvent) => void) | null = null;

  start(config: DragDetectorConfig): void {
    if (!native) {
      console.warn('[Orbit] Drag detection unavailable — native addon not compiled.');
      return;
    }
    console.log('[Orbit] Starting drag detector, mode:', config.mode, 'delay:', config.delayMs);
    native.hookOnEvent((event: any) => {
      console.log('[Orbit] Hook event:', event.type, event.cursorX, event.cursorY);
      if (this.callback) this.callback(event);
    });
    native.hookStart({ mode: config.mode, delayMs: config.delayMs, modifier: config.modifier });
    console.log('[Orbit] Drag detector started.');
  }

  stop(): void {
    if (native) native.hookStop();
  }

  updateConfig(config: Partial<DragDetectorConfig>): void {
    if (native) native.hookUpdateConfig(config);
  }

  onEvent(callback: (event: DragEvent) => void): void {
    this.callback = callback;
  }
}

class WindowsDropSurface implements DropSurface {
  private callback: ((event: DropEvent) => void) | null = null;

  private started = false;

  show(rect: { x: number; y: number; width: number; height: number }, geometry: DropSurfaceGeometry): void {
    if (!native) return;
    if (!this.started) {
      console.log('[Orbit] Starting drop surface thread...');
      native.dropSurfaceStart();
      this.started = true;
    }
    console.log('[Orbit] Showing drop surface at', rect.x, rect.y, rect.width, 'x', rect.height);
    native.dropSurfaceShow(rect, geometry);
  }

  hide(): void {
    if (native) native.dropSurfaceHide();
  }

  onEvent(callback: (event: DropEvent) => void): void {
    this.callback = callback;
    if (native) {
      if (!this.started) {
        console.log('[Orbit] Starting drop surface thread (from onEvent)...');
        native.dropSurfaceStart();
        this.started = true;
      }
      native.dropSurfaceOnEvent((event: DropEvent) => {
        if (this.callback) this.callback(event);
      });
    }
  }
}

class WindowsAppDiscovery implements AppDiscovery {
  async getHandlersForExtension(ext: string): Promise<DiscoveredApp[]> {
    if (!native) return [];
    return native.enumHandlers(ext) ?? [];
  }

  async getDefaultHandler(ext: string): Promise<DiscoveredApp | null> {
    if (!native) return null;
    return native.getDefaultHandler(ext) ?? null;
  }

  async detectCatalogApps(): Promise<Map<string, DiscoveredApp>> {
    // TODO: Implement catalog detection via native addon
    return new Map();
  }

  async getAppIcon(appId: string): Promise<Buffer | null> {
    if (!native) return null;
    return native.extractIcon(appId, 80) ?? null;
  }

  async refresh(): Promise<void> {
    // Re-detect installed apps
  }
}

class WindowsAppLauncher implements AppLauncher {
  async invokeHandler(handlerId: string, filePaths: string[]): Promise<LaunchResult> {
    if (!native) return NATIVE_MISSING;
    try {
      const ok = native.invokeHandler(handlerId, filePaths);
      return { success: ok };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  async activatePackaged(aumid: string, filePaths: string[]): Promise<LaunchResult> {
    if (!native) return NATIVE_MISSING;
    try {
      const ok = native.activateForFile(aumid, filePaths);
      return { success: ok };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  async spawnExe(exePath: string, args: string[], workingDir: string): Promise<LaunchResult> {
    if (!native) return NATIVE_MISSING;
    try {
      return native.createProcess(exePath, args, workingDir);
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  async openWithDialog(filePath: string): Promise<LaunchResult> {
    if (!native) return NATIVE_MISSING;
    try {
      native.openWithDialog(filePath);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  async isDangerous(ext: string): Promise<boolean> {
    if (!native) return false;
    return native.isDangerous(ext) ?? false;
  }

  async hasMotw(filePath: string): Promise<boolean> {
    if (!native) return false;
    return native.hasMotw(filePath) ?? false;
  }
}

class WindowsDisplayInfo implements DisplayInfo {
  getCursorPosition(): { x: number; y: number } {
    if (native) return native.getCursorPos();
    return { x: 0, y: 0 };
  }

  getMonitors(): MonitorInfo[] {
    if (native) return native.getMonitors();
    // Fallback: use Electron's screen module (imported dynamically to avoid renderer usage)
    try {
      const { screen } = require('electron');
      return screen.getAllDisplays().map((d: any) => ({
        id: String(d.id),
        x: d.bounds.x, y: d.bounds.y,
        width: d.bounds.width, height: d.bounds.height,
        workAreaX: d.workArea.x, workAreaY: d.workArea.y,
        workAreaWidth: d.workArea.width, workAreaHeight: d.workArea.height,
        scale: d.scaleFactor,
        isPrimary: d.bounds.x === 0 && d.bounds.y === 0,
      }));
    } catch {
      return [{
        id: '0', x: 0, y: 0, width: 1920, height: 1080,
        workAreaX: 0, workAreaY: 0, workAreaWidth: 1920, workAreaHeight: 1040,
        scale: 1, isPrimary: true,
      }];
    }
  }

  getMonitorForPoint(x: number, y: number): MonitorInfo {
    if (native) return native.getMonitorForPoint(x, y);
    const monitors = this.getMonitors();
    for (const m of monitors) {
      if (x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height) return m;
    }
    return monitors[0];
  }

  isElevated(): boolean {
    if (native) return native.isElevated();
    return false;
  }

  isReducedMotion(): boolean {
    if (native) return native.isReducedMotion();
    return false;
  }
}

export function createWindowsAdapter(): PlatformAdapter {
  return {
    dragDetector: new WindowsDragDetector(),
    dropSurface: new WindowsDropSurface(),
    appDiscovery: new WindowsAppDiscovery(),
    appLauncher: new WindowsAppLauncher(),
    displayInfo: new WindowsDisplayInfo(),

    async getFileTypeInfo(filePath: string): Promise<FileTypeInfo> {
      if (native) return native.getFileTypeInfo(filePath);
      return { typeName: 'File', mime: null, perceivedType: null, size: 0 };
    },
  };
}
