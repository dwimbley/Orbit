/**
 * Settings BrowserWindow.
 *
 * Frameless with a custom title bar, single-instance.
 * Windows 11 rounded corners via DWM attribute.
 */

import { BrowserWindow, screen } from 'electron';
import * as path from 'node:path';
import { rendererHtml, preloadScript } from './paths.js';

let _settings: BrowserWindow | null = null;

/** Security-hardened webPreferences. */
const SECURE_WEB_PREFERENCES: Electron.WebPreferences = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  preload: preloadScript('settings'),
};

/**
 * Open the settings window. If already open, focus it.
 */
export function openSettings(): BrowserWindow {
  if (_settings && !_settings.isDestroyed()) {
    _settings.focus();
    return _settings;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;

  _settings = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 720,
    minHeight: 560,
    maximizable: false,
    show: false,
    titleBarStyle: 'hidden',
    // Custom title bar region is managed in the renderer via -webkit-app-region: drag
    frame: false,
    skipTaskbar: false,
    backgroundColor: '#1a1a2e',
    // Center on primary display
    x: Math.round((screenW - 1180) / 2),
    y: Math.round((screenH - 780) / 2),
    webPreferences: SECURE_WEB_PREFERENCES,
  });

  // Windows 11 rounded corners via DWM_WINDOW_CORNER_PREFERENCE
  // DWMWCP_ROUND = 2 (attribute index 33 = DWMWA_WINDOW_CORNER_PREFERENCE)
  if (process.platform === 'win32') {
    try {
      // Electron exposes this on Windows 11+
      const handle = _settings.getNativeWindowHandle();
      if (handle) {
        // The native addon would call DwmSetWindowAttribute here.
        // For now, Electron's built-in 'hidden' titleBarStyle on
        // Win11 already produces rounded corners.
      }
    } catch {
      // DWM call not critical
    }
  }

  // CSP headers
  _settings.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self';",
        ],
      },
    });
  });

  const settingsUrl = rendererHtml('settings');
  _settings.loadFile(settingsUrl).catch((err) => {
    console.error('[settings] Failed to load settings HTML:', err);
  });

  _settings.once('ready-to-show', () => {
    _settings?.show();
  });

  _settings.on('closed', () => {
    _settings = null;
  });

  return _settings;
}

/**
 * Close the settings window if open.
 */
export function closeSettings(): void {
  if (_settings && !_settings.isDestroyed()) {
    _settings.close();
    _settings = null;
  }
}

/**
 * Get the settings window reference (for IPC routing).
 */
export function getSettingsWindow(): BrowserWindow | null {
  if (_settings && !_settings.isDestroyed()) return _settings;
  return null;
}
