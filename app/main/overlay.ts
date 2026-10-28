/**
 * Overlay BrowserWindow -- the transparent, click-through window that
 * hosts the wheel canvas.  Created at startup, shown/hidden as needed.
 */

import { BrowserWindow, screen } from 'electron';
import type { WedgeModel } from './ipc';
import { IpcChannels } from './ipc';
import { rendererHtml, preloadScript } from './paths.js';

let _overlay: BrowserWindow | null = null;

/**
 * Create the overlay window at startup (hidden).
 */
export function createOverlay(): BrowserWindow {
  if (_overlay && !_overlay.isDestroyed()) {
    return _overlay;
  }

  _overlay = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    width: 500,
    height: 500,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: preloadScript('overlay'),
    },
  });

  // Always on top at the screen-saver level (above everything)
  _overlay.setAlwaysOnTop(true, 'screen-saver');

  // Click-through by default (real drags pass through to OLE target)
  _overlay.setIgnoreMouseEvents(true);

  // Strict CSP via meta tag -- the renderer HTML sets this, but we also
  // guard with a header policy.
  _overlay.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;",
        ],
      },
    });
  });

  // Load the overlay renderer page from the source tree (HTML/CSS are static assets)
  const overlayUrl = rendererHtml('overlay');
  _overlay.loadFile(overlayUrl).catch((err) => {
    console.error('[overlay] Failed to load overlay HTML:', err);
  });

  _overlay.on('closed', () => {
    _overlay = null;
  });

  return _overlay;
}

/**
 * Show the overlay window at the given bounds (physical px).
 * Converts physical pixels to DIP for Electron's setBounds.
 */
// Monogram tile colors (deterministic by hash of app id)
const MONO_COLORS = ['#2F6FE4', '#0E8C8A', '#6E5A45', '#C8532A', '#B23A64', '#4560C9', '#6A4BB8', '#3A3D46'];

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function showOverlay(
  bounds: { x: number; y: number; width: number; height: number },
  data: { wedges: WedgeModel[]; extensions: string[]; fileCount: number; hintText: string },
): void {
  const win = _overlay;
  if (!win || win.isDestroyed()) return;

  const { getPrefs } = require('./prefs') as typeof import('./prefs');
  const prefs = getPrefs();

  // Find the display containing the center of bounds
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const display = screen.getDisplayNearestPoint({ x: centerX, y: centerY });
  const scale = display.scaleFactor;

  // Convert physical px to DIP
  // The wheel canvas is (R+22)*2 but we need room for:
  // - Label text overflowing beyond the disc edge (~60px)
  // - Hint pill below (34px height + 14px gap)
  // - Some breathing room
  const pad = 80; // extra padding on each side
  const bottomExtra = 80; // hint pill + label overflow at bottom
  const dipBounds = {
    x: Math.round((bounds.x - pad) / scale),
    y: Math.round((bounds.y - pad) / scale),
    width: Math.round((bounds.width + pad * 2) / scale),
    height: Math.round((bounds.height + pad + bottomExtra) / scale),
  };

  win.setBounds(dipBounds);

  // Transform WedgeModel[] into the WheelWedge[] shape the renderer expects
  const wheelWedges = data.wedges.map((w, i) => {
    const isOther = w.id === '__other__';
    const isChoose = w.id === '__choose__';
    const isAdd = w.id === '__add__';
    const isSpecial = isOther || isChoose || isAdd;
    const colorIdx = hashCode(w.id) % MONO_COLORS.length;
    const mono = w.name.slice(0, 2);

    return {
      index: i,
      appId: w.id,
      name: w.name,
      iconDataUrl: w.iconDataUrl ?? null,
      monogram: mono,
      monogramColor: MONO_COLORS[colorIdx],
      monogramInk: '#FFFFFF',
      isSpecial,
      specialKind: isOther ? 'more' as const : isChoose ? 'choose' as const : isAdd ? 'add' as const : undefined,
      badge: w.badge,
    };
  });

  // Build the file info for the center
  const ext = data.extensions[0] || '';
  const extLabel = data.fileCount > 1
    ? `${data.fileCount} FILES`
    : (ext ? ext.replace('.', '').toUpperCase() : '?');

  const wheelData = {
    wedges: wheelWedges,
    fileName: data.hintText,
    fileExtLabel: extLabel,
    metaText: data.extensions.map(e => e.replace('.', '').toUpperCase()).join(' · '),
    isEmpty: wheelWedges.length === 0,
    emptyText: wheelWedges.length === 0 ? 'No app opens this file' : undefined,
    isKeyboardMode: false,
    size: prefs.wheelSize as 'S' | 'M' | 'L',
  };

  console.log(`[overlay] Sending ${wheelWedges.length} wedges to renderer`);

  // Send wheel data to renderer
  win.webContents.send(IpcChannels.WHEEL_SHOW, wheelData);

  // Show without stealing focus
  win.showInactive();
}

/**
 * Hide the overlay window.
 */
export function hideOverlay(): void {
  const win = _overlay;
  if (!win || win.isDestroyed()) return;

  win.webContents.send(IpcChannels.WHEEL_HIDE, { reason: 'cancel' });
  win.hide();
}

/**
 * Toggle whether the overlay intercepts mouse events.
 * Enabled = "try the wheel" mode (mouse events hit the overlay).
 * Disabled = normal mode (events pass through to the OLE drop surface).
 */
export function setKeyboardMode(enabled: boolean): void {
  const win = _overlay;
  if (!win || win.isDestroyed()) return;

  // When keyboard mode is enabled, the user interacts directly with the overlay
  win.setIgnoreMouseEvents(!enabled);
  if (enabled) {
    win.setFocusable(true);
  } else {
    win.setFocusable(false);
  }
}

/**
 * Get the overlay window reference (for IPC routing).
 */
export function getOverlayWindow(): BrowserWindow | null {
  if (_overlay && !_overlay.isDestroyed()) return _overlay;
  return null;
}
