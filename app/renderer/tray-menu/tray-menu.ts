/**
 * Tray popup menu renderer — spec section 3.6.
 *
 * All data comes through the preload API (window.orbit).
 * This file never touches node APIs.
 */

declare global {
  interface Window {
    orbit: import('../../preload/tray-menu').TrayMenuAPI;
  }
}

// ---- SVG icons (inline to avoid import in browser context) ----

const logoSvg20 = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="9" stroke="#A78BFA" stroke-width="3.2" stroke-dasharray="5.6 1.47"/>
  <circle cx="12" cy="12" r="2.4" fill="#A78BFA"/>
</svg>`;

const pausedSvg20 = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="9" stroke="#77747F" stroke-width="3.2" stroke-dasharray="5.6 1.47"/>
  <path d="M10 9v6" stroke="#ECEAF2" stroke-width="2" stroke-linecap="round"/>
  <path d="M14 9v6" stroke="#ECEAF2" stroke-width="2" stroke-linecap="round"/>
</svg>`;

// ---- DOM refs ----
const api = window.orbit;
const menu = document.getElementById('tray-menu')!;
const logoGlyph = document.getElementById('logo-glyph')!;
const statusDot = document.getElementById('status-dot')!;
const statusLabel = document.getElementById('status-label')!;
const pauseItem = document.getElementById('pause-item')!;
const pauseLabel = document.getElementById('pause-label')!;
const pauseSubmenu = document.getElementById('pause-submenu')!;

// Collect focusable items
const menuItems = Array.from(document.querySelectorAll<HTMLElement>('.fw-tray-item[role="menuitem"]'));
const subItems = Array.from(document.querySelectorAll<HTMLElement>('.fw-tray-subitem[role="menuitem"]'));

// ---- State ----
let paused = false;
let focusedIndex = -1;
let submenuOpen = false;
let subFocusedIndex = -1;

// ---- Rendering ----

function updateState(state: { paused: boolean }): void {
  paused = state.paused;

  logoGlyph.innerHTML = paused ? pausedSvg20 : logoSvg20;
  statusDot.classList.toggle('paused', paused);
  statusLabel.textContent = paused ? 'Paused' : 'Active';

  // Swap pause/resume label
  if (paused) {
    pauseLabel.textContent = 'Resume';
    pauseItem.classList.remove('fw-tray-item--has-sub');
    const chevron = pauseItem.querySelector('.fw-tray-chevron') as HTMLElement | null;
    if (chevron) chevron.style.display = 'none';
  } else {
    pauseLabel.textContent = 'Pause';
    pauseItem.classList.add('fw-tray-item--has-sub');
    const chevron = pauseItem.querySelector('.fw-tray-chevron') as HTMLElement | null;
    if (chevron) chevron.style.display = '';
  }

  closeSubmenu();
}

// ---- Submenu ----

function openSubmenu(): void {
  if (paused) return; // Resume mode has no submenu
  submenuOpen = true;
  pauseSubmenu.style.display = '';

  // Position to the right of the pause item
  const rect = pauseItem.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  pauseSubmenu.style.left = `${rect.right - menuRect.left + 2}px`;
  pauseSubmenu.style.top = `${rect.top - menuRect.top - 6}px`;

  subFocusedIndex = 0;
  updateSubFocus();
}

function closeSubmenu(): void {
  submenuOpen = false;
  pauseSubmenu.style.display = 'none';
  subFocusedIndex = -1;
  clearSubFocus();
}

function updateFocus(): void {
  menuItems.forEach((el, i) => {
    el.classList.toggle('focused', i === focusedIndex);
  });
}

function updateSubFocus(): void {
  subItems.forEach((el, i) => {
    el.classList.toggle('focused', i === subFocusedIndex);
  });
}

function clearSubFocus(): void {
  subItems.forEach((el) => el.classList.remove('focused'));
}

// ---- Actions ----

function activateItem(action: string): void {
  switch (action) {
    case 'try':
      api.tryTheWheel();
      break;
    case 'pause':
      if (paused) {
        api.resume();
      } else {
        openSubmenu();
        return; // Don't close popup
      }
      break;
    case 'settings':
      api.openSettings();
      break;
    case 'quit':
      api.quit();
      break;
  }
}

function activatePause(until: 'hour' | 'tomorrow' | 'indefinite'): void {
  api.pause(until);
}

// ---- Click handlers ----

menuItems.forEach((item) => {
  item.addEventListener('click', () => {
    const action = item.dataset.action;
    if (action) activateItem(action);
  });
});

subItems.forEach((item) => {
  item.addEventListener('click', () => {
    const until = item.dataset.pause as 'hour' | 'tomorrow' | 'indefinite';
    if (until) activatePause(until);
  });
});

// Hover on pause item opens submenu
pauseItem.addEventListener('mouseenter', () => {
  if (!paused) openSubmenu();
});

// Close submenu when mouse leaves both pause item and submenu
menu.addEventListener('mouseleave', () => {
  closeSubmenu();
});

// ---- Keyboard navigation ----

document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (submenuOpen) {
    handleSubmenuKey(e);
    return;
  }

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      focusedIndex = nextMenuIndex(focusedIndex, 1);
      updateFocus();
      break;
    case 'ArrowUp':
      e.preventDefault();
      focusedIndex = nextMenuIndex(focusedIndex, -1);
      updateFocus();
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (focusedIndex >= 0 && menuItems[focusedIndex]?.dataset.action === 'pause' && !paused) {
        openSubmenu();
      }
      break;
    case 'Enter':
    case ' ':
      e.preventDefault();
      if (focusedIndex >= 0) {
        const action = menuItems[focusedIndex]?.dataset.action;
        if (action) activateItem(action);
      }
      break;
    case 'Escape':
      e.preventDefault();
      api.closePopup();
      break;
  }
});

function handleSubmenuKey(e: KeyboardEvent): void {
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      subFocusedIndex = (subFocusedIndex + 1) % subItems.length;
      updateSubFocus();
      break;
    case 'ArrowUp':
      e.preventDefault();
      subFocusedIndex = (subFocusedIndex - 1 + subItems.length) % subItems.length;
      updateSubFocus();
      break;
    case 'ArrowLeft':
    case 'Escape':
      e.preventDefault();
      closeSubmenu();
      updateFocus();
      break;
    case 'Enter':
    case ' ':
      e.preventDefault();
      if (subFocusedIndex >= 0) {
        const until = subItems[subFocusedIndex]?.dataset.pause as 'hour' | 'tomorrow' | 'indefinite';
        if (until) activatePause(until);
      }
      break;
  }
}

function nextMenuIndex(current: number, direction: number): number {
  const len = menuItems.length;
  let next = current;
  // Skip dividers (items without data-action that may be in the DOM)
  for (let i = 0; i < len; i++) {
    next = (next + direction + len) % len;
    if (menuItems[next]?.dataset.action) return next;
  }
  return current;
}

// ---- Close on blur ----
window.addEventListener('blur', () => {
  api.closePopup();
});

// ---- Init ----
logoGlyph.innerHTML = logoSvg20;
api.onState(updateState);
