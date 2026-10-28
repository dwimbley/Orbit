/**
 * Popup windows: tray popup, toast notifications, confirmation dialogs.
 *
 * All popups are frameless, transparent, security-hardened windows.
 */

import { BrowserWindow, screen } from 'electron';
import * as path from 'node:path';
import { IpcChannels } from './ipc';
import { rendererHtml, preloadScript } from './paths.js';

// ── Shared web preferences ─────────────────────────────────────────

function securePrefs(preloadName: string): Electron.WebPreferences {
  return {
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    preload: preloadScript(preloadName),
  };
}

// ── Tray popup ─────────────────────────────────────────────────────

let _trayPopup: BrowserWindow | null = null;

const TRAY_POPUP_WIDTH = 280;
const TRAY_POPUP_HEIGHT = 320;

/**
 * Create and show the tray popup positioned near the tray icon.
 */
export function createTrayPopup(trayBounds: Electron.Rectangle): BrowserWindow {
  if (_trayPopup && !_trayPopup.isDestroyed()) {
    _trayPopup.focus();
    return _trayPopup;
  }

  // Position above or below the tray icon depending on taskbar location
  const display = screen.getDisplayNearestPoint({
    x: trayBounds.x + trayBounds.width / 2,
    y: trayBounds.y + trayBounds.height / 2,
  });
  const workArea = display.workArea;

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - TRAY_POPUP_WIDTH / 2);
  let y: number;

  // If tray is near the bottom, place popup above; otherwise below
  if (trayBounds.y > workArea.y + workArea.height / 2) {
    y = trayBounds.y - TRAY_POPUP_HEIGHT - 4;
  } else {
    y = trayBounds.y + trayBounds.height + 4;
  }

  // Clamp to work area
  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - TRAY_POPUP_WIDTH));
  y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - TRAY_POPUP_HEIGHT));

  _trayPopup = new BrowserWindow({
    width: TRAY_POPUP_WIDTH,
    height: TRAY_POPUP_HEIGHT,
    x,
    y,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    focusable: true,
    alwaysOnTop: true,
    webPreferences: securePrefs('tray-menu'),
  });

  const popupUrl = rendererHtml('tray-menu');
  _trayPopup.loadFile(popupUrl).catch((err) => {
    console.error('[popup] Failed to load tray popup HTML:', err);
  });

  _trayPopup.once('ready-to-show', () => {
    _trayPopup?.show();
  });

  // Dismiss on blur
  _trayPopup.on('blur', () => {
    closeTrayPopup();
  });

  _trayPopup.on('closed', () => {
    _trayPopup = null;
  });

  return _trayPopup;
}

/**
 * Check if the tray popup is currently open.
 */
export function isTrayPopupOpen(): boolean {
  return _trayPopup !== null && !_trayPopup.isDestroyed();
}

/**
 * Close the tray popup if open.
 */
export function closeTrayPopup(): void {
  if (_trayPopup && !_trayPopup.isDestroyed()) {
    _trayPopup.close();
    _trayPopup = null;
  }
}

// ── Toast notifications ────────────────────────────────────────────

const TOAST_WIDTH = 360;
const TOAST_HEIGHT = 80;
const TOAST_DISMISS_MS = 10_000;

const _activeToasts: Map<string, BrowserWindow> = new Map();

export interface ToastData {
  toastId: string;
  title: string;
  body: string;
  variant?: 'info' | 'error' | 'success';
}

/**
 * Show a non-activating toast notification in the bottom-right of the work area.
 */
export function createToast(data: ToastData): BrowserWindow {
  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;

  // Stack toasts: offset by existing active toasts
  const stackOffset = _activeToasts.size * (TOAST_HEIGHT + 8);

  const x = workArea.x + workArea.width - TOAST_WIDTH - 16;
  const y = workArea.y + workArea.height - TOAST_HEIGHT - 16 - stackOffset;

  const toast = new BrowserWindow({
    width: TOAST_WIDTH,
    height: TOAST_HEIGHT,
    x,
    y,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    webPreferences: securePrefs('toast'),
  });

  toast.setAlwaysOnTop(true, 'pop-up-menu');

  const toastUrl = rendererHtml('toast');
  toast.loadFile(toastUrl).catch((err) => {
    console.error('[popup] Failed to load toast HTML:', err);
  });

  toast.webContents.once('did-finish-load', () => {
    toast.webContents.send('toast:data', data);
  });

  // Show without stealing focus
  toast.showInactive();

  _activeToasts.set(data.toastId, toast);

  // Auto-dismiss
  const timer = setTimeout(() => {
    dismissToast(data.toastId);
  }, TOAST_DISMISS_MS);

  toast.on('closed', () => {
    clearTimeout(timer);
    _activeToasts.delete(data.toastId);
  });

  return toast;
}

/**
 * Dismiss a specific toast by ID.
 */
export function dismissToast(toastId: string): void {
  const toast = _activeToasts.get(toastId);
  if (toast && !toast.isDestroyed()) {
    toast.close();
  }
  _activeToasts.delete(toastId);
}

// ── Confirmation dialog ────────────────────────────────────────────

export interface ConfirmDialogData {
  dialogId: string;
  title: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

const CONFIRM_WIDTH = 440;
const CONFIRM_HEIGHT = 240;

/**
 * Show a modal confirmation dialog centered on the cursor's monitor.
 * Returns a promise that resolves with the user's choice.
 */
export function createConfirmDialog(data: ConfirmDialogData): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const workArea = display.workArea;

    const x = Math.round(workArea.x + (workArea.width - CONFIRM_WIDTH) / 2);
    const y = Math.round(workArea.y + (workArea.height - CONFIRM_HEIGHT) / 2);

    // Backdrop window (semi-transparent overlay to dim the screen)
    const backdrop = new BrowserWindow({
      x: workArea.x,
      y: workArea.y,
      width: workArea.width,
      height: workArea.height,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      focusable: false,
      alwaysOnTop: true,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    backdrop.setAlwaysOnTop(true, 'modal-panel');
    // The backdrop renderer just shows a translucent black div
    backdrop.loadURL('data:text/html,<html><body style="margin:0;background:rgba(0,0,0,0.3)"></body></html>');
    backdrop.showInactive();

    // Dialog window
    const dialog = new BrowserWindow({
      width: CONFIRM_WIDTH,
      height: CONFIRM_HEIGHT,
      x,
      y,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      focusable: true,
      alwaysOnTop: true,
      webPreferences: securePrefs('confirm'),
    });

    dialog.setAlwaysOnTop(true, 'modal-panel');

    const dialogUrl = rendererHtml('confirm');
    dialog.loadFile(dialogUrl).catch((err) => {
      console.error('[popup] Failed to load confirm dialog HTML:', err);
    });

    dialog.webContents.once('did-finish-load', () => {
      dialog.webContents.send('confirm:data', data);
    });

    dialog.once('ready-to-show', () => {
      dialog.show();
      dialog.focus();
    });

    // Listen for the response from the renderer
    const { ipcMain } = require('electron') as typeof import('electron');
    const handler = (_event: Electron.IpcMainEvent, payload: { dialogId: string; confirmed: boolean }) => {
      if (payload.dialogId === data.dialogId) {
        ipcMain.removeListener(IpcChannels.CONFIRM_RESPONSE, handler);
        resolve(payload.confirmed);
        backdrop.close();
        dialog.close();
      }
    };
    ipcMain.on(IpcChannels.CONFIRM_RESPONSE, handler);

    // If dialog is closed without response, treat as cancel
    dialog.on('closed', () => {
      ipcMain.removeListener(IpcChannels.CONFIRM_RESPONSE, handler);
      backdrop.close();
      resolve(false);
    });
  });
}
