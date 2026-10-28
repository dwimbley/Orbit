import type { PlatformAdapter } from './interfaces';

export type { PlatformAdapter } from './interfaces';
export {
  NotImplementedError,
  type DragDetectorConfig,
  type DragEvent,
  type DragDetector,
  type DropSurfaceGeometry,
  type DropEvent,
  type HoverTarget,
  type DroppedItem,
  type DropSurface,
  type FileTypeInfo,
  type DiscoveredApp,
  type AppDiscovery,
  type LaunchResult,
  type AppLauncher,
  type MonitorInfo,
  type DisplayInfo,
} from './interfaces';

let _adapter: PlatformAdapter | null = null;

export function createPlatformAdapter(): PlatformAdapter {
  if (_adapter) {
    return _adapter;
  }

  switch (process.platform) {
    case 'win32': {
      const { createWindowsAdapter } = require('./windows');
      _adapter = createWindowsAdapter();
      break;
    }
    case 'darwin': {
      const { createMacOSAdapter } = require('./macos');
      _adapter = createMacOSAdapter();
      break;
    }
    case 'linux': {
      const { createLinuxAdapter } = require('./linux');
      _adapter = createLinuxAdapter();
      break;
    }
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }

  return _adapter!;
}

/** Reset the cached adapter (useful for testing). */
export function resetPlatformAdapter(): void {
  _adapter = null;
}
