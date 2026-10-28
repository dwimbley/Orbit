/**
 * System tray icon and menu.
 *
 * Left or right click opens a custom popup window (not a native context menu).
 * The tray icon is generated from an SVG data URL since bundled icon files
 * may not exist during development.
 */

import { Tray, nativeImage, Menu } from 'electron';
import { createTrayPopup, closeTrayPopup, isTrayPopupOpen } from './popup-windows.js';

let _tray: Tray | null = null;
let _paused = false;

/** Generate a 32×32 tray icon as a data URL */
function makeTrayIcon(paused: boolean): Electron.NativeImage {
  // Active: purple ring + center dot
  // Paused: grey ring + pause bars
  const svg = paused
    ? `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="9" stroke="#77747F" stroke-width="3.2" stroke-dasharray="5.6 1.47"/>
        <path d="M10 9v6" stroke="#ECEAF2" stroke-width="2" stroke-linecap="round"/>
        <path d="M14 9v6" stroke="#ECEAF2" stroke-width="2" stroke-linecap="round"/>
       </svg>`
    : `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="9" stroke="#A78BFA" stroke-width="3.2" stroke-dasharray="5.6 1.47"/>
        <circle cx="12" cy="12" r="2.4" fill="#A78BFA"/>
       </svg>`;

  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  );
}

/**
 * Create the system tray icon.
 */
export function createTray(): Tray {
  if (_tray && !_tray.isDestroyed()) {
    return _tray;
  }

  _tray = new Tray(makeTrayIcon(false));
  _tray.setToolTip('Orbit');

  // Set an empty context menu to prevent the default one
  _tray.setContextMenu(Menu.buildFromTemplate([]));

  // Both left and right click open the custom popup
  _tray.on('click', (_event, bounds) => {
    toggleTrayPopup(bounds);
  });

  _tray.on('right-click', (_event, bounds) => {
    toggleTrayPopup(bounds);
  });

  return _tray;
}

function toggleTrayPopup(bounds: Electron.Rectangle): void {
  if (isTrayPopupOpen()) {
    closeTrayPopup();
  } else {
    createTrayPopup(bounds);
  }
}

export function updateTrayState(paused: boolean): void {
  _paused = paused;
  if (!_tray || _tray.isDestroyed()) return;
  _tray.setImage(makeTrayIcon(paused));
  _tray.setToolTip(paused ? 'Orbit \u2014 paused' : 'Orbit');
}

export function destroyTray(): void {
  if (_tray && !_tray.isDestroyed()) {
    _tray.destroy();
    _tray = null;
  }
}
