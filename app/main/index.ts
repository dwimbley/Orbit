/**
 * Orbit -- Electron main process entry point.
 *
 * Single-instance app with no dock/taskbar presence.
 * The wheel overlay is managed by native hooks + an Electron BrowserWindow.
 */

import { app, ipcMain, BrowserWindow } from 'electron';
import { createTray, updateTrayState, destroyTray } from './tray';
import { createOverlay, showOverlay, hideOverlay, setKeyboardMode, getOverlayWindow } from './overlay';
import { openSettings, getSettingsWindow } from './settings-window';
import { closeTrayPopup } from './popup-windows';
import { loadPrefs, getPrefs, updatePrefs, savePrefs } from './prefs';
import { getStats, resetHistory } from './history';
import { resolveInstalledCatalogApps } from './catalog';
import { createActivationMachine } from './activation';
import type { ActivationMachine, DropEntryInfo } from './activation';
import { IpcChannels, validateIpcPayload } from './ipc';
import type { TrayActionPayload, SettingsSetPayload, LaunchAppPayload, ConfirmResponsePayload } from './ipc';
import { buildWheelForFiles } from './ranking';
import { launchApp } from './launch';
import type { ResolvedApp } from './launch';
import { createPlatformAdapter } from '../../platform/index';
import type { PlatformAdapter, DroppedItem } from '../../platform/interfaces';
import { computePlacement } from '../../packages/core/src/placement';
import { makeWheelConfig } from '../../packages/core/src/types';

// ── Single instance lock ───────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// ── No dock / taskbar icon ─────────────────────────────────────────

if (process.platform === 'darwin') {
  app.dock?.hide();
}

// ── State ──────────────────────────────────────────────────────────

let platform: PlatformAdapter;
let activationMachine: ActivationMachine;
let lastCursorX = 0;
let lastCursorY = 0;
let lastPlacement: { x: number; y: number; monitorScale: number } | null = null;
let lastWheelModel: import('./ranking').WheelModel | null = null;
let lastDroppedItems: DroppedItem[] = [];

// ── App ready ──────────────────────────────────────────────────────

app.on('ready', async () => {
  // Load preferences
  const prefs = loadPrefs();

  // Initialize the platform adapter (native hooks)
  platform = createPlatformAdapter();

  // Create the system tray
  createTray();
  updateTrayState(prefs.paused);

  // Create the hidden overlay window
  createOverlay();

  // Set up the activation state machine
  activationMachine = createActivationMachine({
    onShowSurface: (cursorX, cursorY) => {
      // Position and show the native drop surface
      const wheelConfig = makeWheelConfig(prefs.wheelSize);
      const monitors = platform.displayInfo.getMonitors().map((m) => ({
        x: m.workAreaX,
        y: m.workAreaY,
        width: m.workAreaWidth,
        height: m.workAreaHeight,
        scale: m.scale,
      }));

      const placement = computePlacement({
        cursorX: cursorX || lastCursorX,
        cursorY: cursorY || lastCursorY,
        canvasSize: wheelConfig.canvasSize,
        hintPillHeight: 32,
        margin: 16,
        monitors,
      });
      lastPlacement = placement;

      // Make the initial surface large to catch the DragEnter
      const initPad = 100;
      platform.dropSurface.show(
        {
          x: placement.x - initPad,
          y: placement.y - initPad,
          width: wheelConfig.canvasSize + initPad * 2,
          height: wheelConfig.canvasSize + initPad * 2,
        },
        {
          centerX: wheelConfig.canvasSize / 2 + initPad,
          centerY: wheelConfig.canvasSize / 2 + initPad,
          outerRadius: wheelConfig.R,
          innerRadius: wheelConfig.r,
          wedgeCount: 0, // Will be updated after DragEnter
          isEmpty: false,
          scale: placement.monitorScale,
        },
      );
    },

    onShowWheel: async (items: DropEntryInfo[]) => {
      try {
      const droppedItems: DroppedItem[] = items.map((i) => ({
        path: i.path,
        isFolder: i.isFolder,
        extension: i.extension || '',
        displayName: i.displayName,
      }));

      console.log('[Orbit] Building wheel for:', droppedItems.map(d => `${d.displayName} (${d.extension})`).join(', '));
      lastDroppedItems = droppedItems;
      const wheelModel = await buildWheelForFiles(droppedItems, platform);
      lastWheelModel = wheelModel;

      // Update the native drop surface geometry with the actual wedge count
      // so hit-testing returns LINK/COPY for wedges instead of NONE
      const actualWedgeCount = wheelModel.wedges.length;
      if (actualWedgeCount > 0) {
        // Make native surface larger than the canvas to catch drops on edge wedges
        const pad = 80;
        const surfaceX = (lastPlacement?.x ?? 0) - pad;
        const surfaceY = (lastPlacement?.y ?? 0) - pad;
        const surfaceW = wheelModel.wheelConfig.canvasSize + pad * 2;
        const surfaceH = wheelModel.wheelConfig.canvasSize + pad * 2;

        platform.dropSurface.show(
          { x: surfaceX, y: surfaceY, width: surfaceW, height: surfaceH },
          {
            // Center is now offset by the padding
            centerX: wheelModel.wheelConfig.canvasSize / 2 + pad,
            centerY: wheelModel.wheelConfig.canvasSize / 2 + pad,
            outerRadius: wheelModel.wheelConfig.R,
            innerRadius: wheelModel.wheelConfig.r,
            wedgeCount: actualWedgeCount,
            isEmpty: actualWedgeCount === 0,
            scale: lastPlacement?.monitorScale ?? 1,
          },
        );
        console.log(`[Orbit] Updated drop surface geometry: ${actualWedgeCount} wedges`);
      }

      const monitors = platform.displayInfo.getMonitors().map((m) => ({
        x: m.workAreaX,
        y: m.workAreaY,
        width: m.workAreaWidth,
        height: m.workAreaHeight,
        scale: m.scale,
      }));

      const placement = computePlacement({
        cursorX: lastCursorX,
        cursorY: lastCursorY,
        canvasSize: wheelModel.wheelConfig.canvasSize,
        hintPillHeight: 32,
        margin: 16,
        monitors,
      });

      showOverlay(
        {
          x: placement.x,
          y: placement.y,
          width: wheelModel.wheelConfig.canvasSize,
          height: wheelModel.wheelConfig.canvasSize,
        },
        {
          wedges: wheelModel.wedges,
          extensions: wheelModel.extensions,
          fileCount: wheelModel.fileCount,
          hintText: wheelModel.hintText,
        },
      );
      } catch (err) {
        console.error('[Orbit] Error building wheel:', err);
        hideOverlay();
        platform.dropSurface.hide();
      }
    },

    onHideWheel: (_reason) => {
      hideOverlay();
      platform.dropSurface.hide();
    },

    onHoverUpdate: (cursorX, cursorY) => {
      lastCursorX = cursorX;
      lastCursorY = cursorY;
      // Hover updates are handled by the native drop surface -> renderer
    },

    onDrop: (wedgeIndex) => {
      console.log(`[Orbit] onDrop called: wedgeIndex=${wedgeIndex}, hasModel=${!!lastWheelModel}, items=${lastDroppedItems.length}, wedges=${lastWheelModel?.wedges?.length}`);

      // Capture state before hiding clears anything
      const wheelModel = lastWheelModel;
      const droppedItems = [...lastDroppedItems];

      hideOverlay();
      platform.dropSurface.hide();

      if (wedgeIndex < 0 || !wheelModel || !droppedItems.length) {
        console.log('[Orbit] onDrop: early exit — no valid target');
        return;
      }

      const wedge = wheelModel.wedges[wedgeIndex];
      if (!wedge || wedge.id === '__other__') {
        // "Other app..." — open the Windows Open With dialog
        if (droppedItems[0]) {
          console.log('[Orbit] Opening "Open with" dialog for', droppedItems[0].path);
          platform.appLauncher.openWithDialog(droppedItems[0].path).catch(console.error);
        }
        return;
      }

      const filePaths = droppedItems.map(i => i.path);
      console.log(`[Orbit] Launching "${wedge.name}" (${wedge.id}) with ${filePaths.length} file(s)`);

      launchWedgeApp(wedge, filePaths).catch(err => {
        console.error(`[Orbit] Launch error:`, err);
      });
    },

    onReset: () => {
      hideOverlay();
      platform.dropSurface.hide();
    },
  });

  // Wire native drag detector events to the activation machine
  if (!prefs.paused) {
    startNativeHooks();
  }

  // Register IPC handlers
  registerIpcHandlers();
});

// ── App launching ─────────────────────────────────────────────────

async function launchWedgeApp(wedge: { id: string; name: string }, filePaths: string[]): Promise<void> {
  const path = require('path');
  const { exec } = require('child_process');

  // 1. If the wedge ID is a direct exe path (from OS handler discovery)
  if (wedge.id.includes('\\') || wedge.id.includes('/')) {
    const exePath = wedge.id;
    const workingDir = path.dirname(filePaths[0]);
    console.log(`[Orbit] Launching exe: ${exePath}`);

    const result = await platform.appLauncher.spawnExe(exePath, filePaths, workingDir);
    if (result.success) {
      console.log(`[Orbit] Launched "${wedge.name}" successfully`);
    } else {
      console.error(`[Orbit] Launch failed:`, result.error);
      // Fallback: try start command
      launchWithStart(filePaths[0], wedge.name);
    }
    return;
  }

  // 2. Catalog app — look up resolved info
  const installed = await resolveInstalledCatalogApps(platform);
  const resolved = installed.get(wedge.id);

  if (resolved?.exePath && resolved.exePath !== wedge.id) {
    // Has a real exe path
    const workingDir = path.dirname(filePaths[0]);
    console.log(`[Orbit] Launching catalog app: ${resolved.exePath}`);

    const result = await platform.appLauncher.spawnExe(resolved.exePath, filePaths, workingDir);
    if (result.success) {
      console.log(`[Orbit] Launched "${wedge.name}" successfully`);
    } else {
      console.error(`[Orbit] Launch failed:`, result.error);
      launchWithStart(filePaths[0], wedge.name);
    }
    return;
  }

  // 3. Store app or app without resolved path — use 'start' command as fallback
  //    This opens the file with the system default or specified app
  console.log(`[Orbit] No exe path for "${wedge.name}" — using system open`);
  launchWithStart(filePaths[0], wedge.name);
}

/**
 * Fallback launcher using the Windows 'start' command.
 * Opens the file with the system's default handler.
 */
function launchWithStart(filePath: string, appName: string): void {
  const { shell } = require('electron') as typeof import('electron');
  console.log(`[Orbit] Opening with system handler: ${filePath}`);
  shell.openPath(filePath).then((error: string) => {
    if (error) {
      console.error(`[Orbit] shell.openPath failed:`, error);
    } else {
      console.log(`[Orbit] Opened "${appName}" via system handler`);
    }
  });
}

// ── Native hooks ───────────────────────────────────────────────────

function startNativeHooks(): void {
  const prefs = getPrefs();

  platform.dragDetector.start({
    mode: prefs.activationMode,
    delayMs: prefs.activationDelay,
    modifier: prefs.activationModifier,
  });

  platform.dragDetector.onEvent((event) => {
    switch (event.type) {
      case 'pending':
        lastCursorX = event.cursorX;
        lastCursorY = event.cursorY;
        activationMachine.send({ type: 'DRAG_START', cursorX: event.cursorX, cursorY: event.cursorY });
        break;
      case 'surfaceRequested':
        lastCursorX = event.cursorX;
        lastCursorY = event.cursorY;
        activationMachine.send({ type: 'DELAY_ELAPSED' });
        break;
      case 'ended':
        activationMachine.send({ type: 'DRAG_END' });
        break;
    }
  });

  platform.dropSurface.onEvent((event) => {
    switch (event.type) {
      case 'enter': {
        // The native addon sends items as path strings or {path} objects
        // Convert to DropEntryInfo format
        const items: DropEntryInfo[] = (event.items || []).map((item: any) => {
          const filePath = typeof item === 'string' ? item : item.path;
          if (!filePath) return null;
          const pathModule = require('path');
          const fs = require('fs');
          const ext = pathModule.extname(filePath).toLowerCase();
          const name = pathModule.basename(filePath);
          let isFolder = false;
          try { isFolder = fs.statSync(filePath).isDirectory(); } catch {}
          return { path: filePath, isFolder, extension: ext || '', displayName: name };
        }).filter(Boolean) as DropEntryInfo[];

        if (items.length > 0) {
          console.log('[Orbit] DragEnter with', items.length, 'items:', items.map(i => i.displayName).join(', '));
          activationMachine.send({ type: 'DRAG_ENTER', items });
        }
        break;
      }
        break;
      case 'hover': {
        // Forward hover to overlay renderer — match the shape expected by preload
        const hoverData = {
          type: event.target.type,
          index: event.target.type === 'wedge' ? event.target.index : undefined,
        };
        getOverlayWindow()?.webContents.send(IpcChannels.WHEEL_HOVER, hoverData);
        break;
      }
        break;
      case 'drop':
        console.log('[Orbit] Drop event, target:', event.target.type, event.target.type === 'wedge' ? `index=${event.target.index}` : '');
        activationMachine.send({
          type: 'DROP',
          wedgeIndex: event.target.type === 'wedge' ? event.target.index : -1,
        });
        break;
      case 'leave':
        activationMachine.send({ type: 'DRAG_LEAVE' });
        break;
    }
  });
}

function stopNativeHooks(): void {
  try {
    platform.dragDetector.stop();
  } catch {
    // May not be started
  }
}

// ── IPC handlers ───────────────────────────────────────────────────

function registerIpcHandlers(): void {
  // Tray menu actions — match the channel names used in preload/tray-menu.ts
  ipcMain.on('open-settings', () => {
    openSettings();
  });

  ipcMain.on('pause', (_event, until?: string) => {
    updatePrefs({ paused: true });
    updateTrayState(true);
    stopNativeHooks();
  });

  ipcMain.on('resume', () => {
    updatePrefs({ paused: false });
    updateTrayState(false);
    startNativeHooks();
  });

  ipcMain.on('app:quit', () => {
    app.quit();
  });

  ipcMain.on('tray:close', () => {
    closeTrayPopup();
  });

  ipcMain.on('tray:request-state', (event) => {
    event.sender.send('tray:state', { paused: getPrefs().paused });
  });

  ipcMain.on('try-the-wheel', () => {
    // TODO: implement Try the wheel flow
    console.log('[Orbit] Try the wheel requested');
  });

  // Settings window controls
  ipcMain.on('settings:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.minimize();
  });

  ipcMain.on('settings:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.close();
  });

  // Wheel keyboard mode actions
  ipcMain.on('wheel:select', (_event, index: number) => {
    console.log('[Orbit] Wheel select wedge:', index);
    activationMachine.send({ type: 'DROP', wedgeIndex: index });
  });

  ipcMain.on('wheel:dismiss', () => {
    activationMachine.send({ type: 'DISMISS' });
  });

  // Toast actions
  ipcMain.on('toast:dismiss', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.close();
  });

  // Confirm dialog actions
  ipcMain.on('confirm:cancel', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.close();
  });

  ipcMain.on('confirm:proceed', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.close();
  });

  // Legacy tray:action handler (for compatibility)
  ipcMain.on(IpcChannels.TRAY_ACTION, (_event, rawPayload) => {
    try {
      const payload = validateIpcPayload<{ action: string }>(IpcChannels.TRAY_ACTION, rawPayload) as ReturnType<typeof TrayActionPayload.parse>;
      switch (payload.action) {
        case 'open-settings': openSettings(); break;
        case 'pause': updatePrefs({ paused: true }); updateTrayState(true); stopNativeHooks(); break;
        case 'resume': updatePrefs({ paused: false }); updateTrayState(false); startNativeHooks(); break;
        case 'quit': app.quit(); break;
      }
    } catch {}
  });

  // Settings get (handled by 'settings:get' below)

  // Settings set (handled by 'settings:update' below)

  // Launch app
  ipcMain.on(IpcChannels.LAUNCH_APP, async (_event, rawPayload) => {
    const payload = validateIpcPayload<{ appId: string; filePaths: string[]; extension: string }>(
      IpcChannels.LAUNCH_APP,
      rawPayload,
    ) as ReturnType<typeof LaunchAppPayload.parse>;

    // Resolve the app from current state
    // TODO: look up the full ResolvedApp from ranking/catalog
    const resolvedApp: ResolvedApp = {
      id: payload.appId,
      name: payload.appId,
      exePath: null,
      aumid: null,
      handlerId: null,
      args: '"{file}"',
    };

    await launchApp(resolvedApp, payload.filePaths, payload.extension, platform);
  });

  // Confirm dialog response (forwarded from renderer)
  ipcMain.on(IpcChannels.CONFIRM_RESPONSE, (_event, rawPayload) => {
    // Validation happens; the popup-windows module listens for this directly
    validateIpcPayload<{ dialogId: string; confirmed: boolean }>(
      IpcChannels.CONFIRM_RESPONSE,
      rawPayload,
    );
  });

  // Toast dismiss
  ipcMain.on(IpcChannels.TOAST_DISMISS, (_event, rawPayload) => {
    const payload = validateIpcPayload<{ toastId: string }>(IpcChannels.TOAST_DISMISS, rawPayload);
    const { dismissToast } = require('./popup-windows') as typeof import('./popup-windows');
    dismissToast(payload.toastId);
  });

  // ── Settings window IPC handlers ──────────────────────────────────

  ipcMain.handle('app:version', () => {
    return app.getVersion();
  });

  ipcMain.handle('app:monitor-count', () => {
    return platform.displayInfo.getMonitors().length;
  });

  ipcMain.handle('status:get', () => {
    const elevated = platform.displayInfo.isElevated();
    const monitors = platform.displayInfo.getMonitors();
    return {
      working: !elevated,
      reason: elevated
        ? 'Orbit is running as administrator. Windows blocks drags from Explorer into elevated apps. Restart Orbit normally.'
        : undefined,
      monitorCount: monitors.length,
      elevated,
    };
  });

  ipcMain.handle('status:check', () => {
    const elevated = platform.displayInfo.isElevated();
    const monitors = platform.displayInfo.getMonitors();
    return {
      working: !elevated,
      reason: elevated
        ? 'Orbit is running as administrator. Windows blocks drags from Explorer into elevated apps. Restart Orbit normally.'
        : undefined,
      monitorCount: monitors.length,
      elevated,
    };
  });

  ipcMain.handle('settings:get', () => {
    const p = getPrefs();
    return {
      activation: { mode: p.activationMode, delayMs: p.activationDelay, modifier: p.activationModifier },
      wheel: { size: p.wheelSize, maxWedges: 8, motion: p.animationsEnabled ? 'system' : 'reduce' },
      launchAtLogin: p.launchOnStartup,
      paused: { until: p.paused ? 'indefinite' : null },
    };
  });

  ipcMain.handle('settings:update', (_event, partial: any) => {
    const current = getPrefs();
    if (partial.activation) {
      if (partial.activation.mode) updatePrefs({ activationMode: partial.activation.mode });
      if (partial.activation.delayMs !== undefined) updatePrefs({ activationDelay: partial.activation.delayMs });
      if (partial.activation.modifier) updatePrefs({ activationModifier: partial.activation.modifier });
    }
    if (partial.wheel) {
      if (partial.wheel.size) updatePrefs({ wheelSize: partial.wheel.size });
    }
    if (partial.launchAtLogin !== undefined) updatePrefs({ launchOnStartup: partial.launchAtLogin });
  });

  ipcMain.handle('apps:extensions', async () => {
    const { loadCatalog } = require('./catalog') as typeof import('./catalog');
    const { extensions } = loadCatalog();
    const exts: Array<{ ext: string; friendlyType: string; mime: string | null; appCount: number }> = [];

    for (const [ext, appIds] of Object.entries(extensions)) {
      if (ext === '_folder') {
        exts.push({ ext: 'Folders', friendlyType: 'File-system folders', mime: null, appCount: (appIds as string[]).length });
      } else {
        exts.push({ ext, friendlyType: '', mime: null, appCount: (appIds as string[]).length });
      }
    }

    // Sort by extension name
    exts.sort((a, b) => a.ext.localeCompare(b.ext));
    return exts;
  });

  ipcMain.handle('apps:for-ext', async (_event, ext: string) => {
    const { getCatalogAppsForExtension } = require('./catalog') as typeof import('./catalog');
    const catalogApps = getCatalogAppsForExtension(ext);
    const installed = await resolveInstalledCatalogApps(platform);
    const prefs = getPrefs();
    const extPrefs = prefs.extensions[ext.toLowerCase()];
    const MONO_COLORS = ['#2F6FE4', '#0E8C8A', '#6E5A45', '#C8532A', '#B23A64', '#4560C9', '#6A4BB8', '#3A3D46'];

    const rows = catalogApps.map((app, i) => {
      const resolved = installed.get(app.id);
      const isPinned = extPrefs?.pinned?.includes(app.id) ?? false;
      const colorIdx = Math.abs(app.id.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0)) % MONO_COLORS.length;

      return {
        id: app.id,
        name: app.name,
        iconDataUrl: null,
        monogram: app.name.slice(0, 2),
        monogramColor: MONO_COLORS[colorIdx],
        monogramInk: '#FFFFFF',
        exePath: resolved?.exePath ?? null,
        packageDisplay: resolved?.packageFamilyName ? `${app.name} (Store app)` : null,
        tags: [
          ...(resolved ? [{ label: 'File association', type: 'association' as const }] : [{ label: 'Not installed', type: 'compatible' as const }]),
          ...(isPinned ? [{ label: 'Pinned', type: 'pinned' as const }] : []),
        ],
        usageCount: 0,
        isPinned,
        isDefault: false,
        isHideable: true,
      };
    });

    return rows;
  });

  ipcMain.handle('apps:hidden-for-ext', async (_event, ext: string) => {
    const prefs = getPrefs();
    const hidden = prefs.extensions[ext.toLowerCase()]?.hidden ?? [];
    return hidden.map(id => ({ id, name: id }));
  });

  ipcMain.handle('history:stats', () => {
    const stats = getStats();
    return stats;
  });

  ipcMain.handle('history:reset', () => {
    resetHistory();
  });

  ipcMain.handle('wheel:preview', (_event, size: string, maxWedges: number) => {
    return { wedges: [] }; // TODO: build preview from real data
  });

  ipcMain.on('open-settings-folder', () => {
    const { shell } = require('electron');
    const prefsPath = require('path').dirname(getPrefs().schemaVersion ? '' : '');
    shell.openPath(app.getPath('userData'));
  });
}

// ── Second instance ────────────────────────────────────────────────

app.on('second-instance', () => {
  // Focus settings window if it's open
  const settings = getSettingsWindow();
  if (settings) {
    if (settings.isMinimized()) settings.restore();
    settings.focus();
  }
});

// ── Before quit ────────────────────────────────────────────────────

app.on('before-quit', () => {
  stopNativeHooks();
  savePrefs(getPrefs());
  destroyTray();
});

// ── Prevent default window-all-closed quit behaviour ───────────────

app.on('window-all-closed', () => {
  // Do not quit when all windows are closed -- we're a tray app
});
