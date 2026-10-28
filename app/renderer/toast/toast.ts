/**
 * Toast renderer — launch-error notification, spec section 3.7.
 *
 * All data comes through the preload API (window.orbit).
 * This file never touches node APIs.
 */

declare global {
  interface Window {
    orbit: import('../../preload/toast').ToastAPI;
  }
}

// ---- DOM refs ----
const api = window.orbit;
const toast = document.getElementById('toast')!;
const titleEl = document.getElementById('toast-title')!;
const reasonEl = document.getElementById('toast-reason')!;
const pathEl = document.getElementById('toast-path')!;
const unchangedEl = document.getElementById('toast-unchanged')!;
const buttonsEl = document.getElementById('toast-buttons')!;
const btnRemove = document.getElementById('btn-remove')! as HTMLButtonElement;
const btnLocate = document.getElementById('btn-locate')! as HTMLButtonElement;
const btnDismiss = document.getElementById('btn-dismiss')! as HTMLButtonElement;

// ---- Auto-dismiss timer ----
let dismissTimer: ReturnType<typeof setTimeout> | null = null;
let hovered = false;
let focused = false;

function startDismissTimer(): void {
  clearDismissTimer();
  dismissTimer = setTimeout(() => {
    if (!hovered && !focused) {
      api.dismiss();
    }
  }, 10_000);
}

function clearDismissTimer(): void {
  if (dismissTimer !== null) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
}

function restartTimerIfNeeded(): void {
  if (!hovered && !focused) {
    startDismissTimer();
  }
}

// Pause auto-dismiss on hover/focus
toast.addEventListener('mouseenter', () => {
  hovered = true;
  clearDismissTimer();
});

toast.addEventListener('mouseleave', () => {
  hovered = false;
  restartTimerIfNeeded();
});

toast.addEventListener('focusin', () => {
  focused = true;
  clearDismissTimer();
});

toast.addEventListener('focusout', () => {
  focused = false;
  restartTimerIfNeeded();
});

// ---- Helpers ----

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- Render ----

function show(data: import('../../preload/toast').ToastData): void {
  titleEl.textContent = `Couldn\u2019t open with ${data.appName}`;
  reasonEl.textContent = data.reason;

  // Optional exe path
  if (data.exePath) {
    pathEl.textContent = data.exePath;
    pathEl.style.display = '';
  } else {
    pathEl.style.display = 'none';
  }

  unchangedEl.innerHTML = `${escapeHtml(data.fileName)} was not changed.`;

  // Buttons only for "not found" errors
  if (data.isNotFound) {
    buttonsEl.style.display = '';
    btnLocate.textContent = `Locate ${data.appName}\u2026`;
  } else {
    buttonsEl.style.display = 'none';
  }

  toast.style.display = '';
  startDismissTimer();
}

// ---- Event wiring ----

api.onShow(show);

btnDismiss.addEventListener('click', () => {
  api.dismiss();
});

btnRemove.addEventListener('click', () => {
  api.removeFromWheel();
});

btnLocate.addEventListener('click', () => {
  api.locateApp();
});

// Esc to dismiss
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    api.dismiss();
  }
});
