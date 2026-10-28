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
} from '../interfaces';

import { NotImplementedError } from '../interfaces';

const PLATFORM = 'Linux';

class LinuxDragDetector implements DragDetector {
  start(_config: DragDetectorConfig): void {
    throw new NotImplementedError(PLATFORM, 'DragDetector');
  }

  stop(): void {
    throw new NotImplementedError(PLATFORM, 'DragDetector');
  }

  updateConfig(_config: Partial<DragDetectorConfig>): void {
    throw new NotImplementedError(PLATFORM, 'DragDetector');
  }

  onEvent(_callback: (event: DragEvent) => void): void {
    throw new NotImplementedError(PLATFORM, 'DragDetector');
  }
}

class LinuxDropSurface implements DropSurface {
  show(_rect: { x: number; y: number; width: number; height: number }, _geometry: DropSurfaceGeometry): void {
    throw new NotImplementedError(PLATFORM, 'DropSurface');
  }

  hide(): void {
    throw new NotImplementedError(PLATFORM, 'DropSurface');
  }

  onEvent(_callback: (event: DropEvent) => void): void {
    throw new NotImplementedError(PLATFORM, 'DropSurface');
  }
}

class LinuxAppDiscovery implements AppDiscovery {
  async getHandlersForExtension(_ext: string): Promise<DiscoveredApp[]> {
    throw new NotImplementedError(PLATFORM, 'AppDiscovery');
  }

  async getDefaultHandler(_ext: string): Promise<DiscoveredApp | null> {
    throw new NotImplementedError(PLATFORM, 'AppDiscovery');
  }

  async detectCatalogApps(): Promise<Map<string, DiscoveredApp>> {
    throw new NotImplementedError(PLATFORM, 'AppDiscovery');
  }

  async getAppIcon(_appId: string): Promise<Buffer | null> {
    throw new NotImplementedError(PLATFORM, 'AppDiscovery');
  }

  async refresh(): Promise<void> {
    throw new NotImplementedError(PLATFORM, 'AppDiscovery');
  }
}

class LinuxAppLauncher implements AppLauncher {
  async invokeHandler(_handlerId: string, _filePaths: string[]): Promise<LaunchResult> {
    throw new NotImplementedError(PLATFORM, 'AppLauncher');
  }

  async activatePackaged(_aumid: string, _filePaths: string[]): Promise<LaunchResult> {
    throw new NotImplementedError(PLATFORM, 'AppLauncher');
  }

  async spawnExe(_exePath: string, _args: string[], _workingDir: string): Promise<LaunchResult> {
    throw new NotImplementedError(PLATFORM, 'AppLauncher');
  }

  async openWithDialog(_filePath: string): Promise<LaunchResult> {
    throw new NotImplementedError(PLATFORM, 'AppLauncher');
  }

  async isDangerous(_ext: string): Promise<boolean> {
    throw new NotImplementedError(PLATFORM, 'AppLauncher');
  }

  async hasMotw(_filePath: string): Promise<boolean> {
    throw new NotImplementedError(PLATFORM, 'AppLauncher');
  }
}

class LinuxDisplayInfo implements DisplayInfo {
  getCursorPosition(): { x: number; y: number } {
    throw new NotImplementedError(PLATFORM, 'DisplayInfo');
  }

  getMonitors(): MonitorInfo[] {
    throw new NotImplementedError(PLATFORM, 'DisplayInfo');
  }

  getMonitorForPoint(_x: number, _y: number): MonitorInfo {
    throw new NotImplementedError(PLATFORM, 'DisplayInfo');
  }

  isElevated(): boolean {
    throw new NotImplementedError(PLATFORM, 'DisplayInfo');
  }

  isReducedMotion(): boolean {
    throw new NotImplementedError(PLATFORM, 'DisplayInfo');
  }
}

export function createLinuxAdapter(): PlatformAdapter {
  return {
    dragDetector: new LinuxDragDetector(),
    dropSurface: new LinuxDropSurface(),
    appDiscovery: new LinuxAppDiscovery(),
    appLauncher: new LinuxAppLauncher(),
    displayInfo: new LinuxDisplayInfo(),

    async getFileTypeInfo(_filePath: string): Promise<FileTypeInfo> {
      throw new NotImplementedError(PLATFORM, 'getFileTypeInfo');
    },
  };
}
