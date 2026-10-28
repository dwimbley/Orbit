/**
 * Overlay renderer — draws the radial wheel, handles hover states,
 * and keyboard navigation for Try-the-wheel mode.
 *
 * All data comes through the preload API (window.orbit).
 * This file never touches file paths or node APIs.
 */

declare global {
  interface Window {
    orbit: import('../../preload/overlay').OverlayAPI;
  }
}

// ---- Constants from spec ----
const WHEEL_SIZES: Record<string, number> = { S: 150, M: 175, L: 200 };
const INNER_RATIO = 0.38;
const GAP_PX = 5;
const DISC_EXTRA = 12; // disc radius = R + 12
const CANVAS_PAD = 22; // canvas side = (R + 22) * 2

// Monogram tile colors (deterministic by hash of app id)
const MONO_COLORS = ['#2F6FE4', '#0E8C8A', '#6E5A45', '#C8532A', '#B23A64', '#4560C9', '#6A4BB8', '#3A3D46'];

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// ---- Geometry ----
interface WedgeGeom {
  midAngle: number;
  outerR: number;
  innerR: number;
  path: string;
  labelX: number;
  labelY: number;
  labelMaxW: number;
}

function computeWedge(
  c: number, R: number, r: number, n: number, i: number, hovered: boolean
): WedgeGeom {
  const step = (2 * Math.PI) / n;
  const Ro = hovered ? R + 9 : R;
  const midAngle = -Math.PI / 2 + i * step;

  const spanO = step - GAP_PX / Ro;
  const spanI = step - GAP_PX / r;

  const f = (v: number) => Math.round(v * 100) / 100;
  const pt = (rad: number, a: number) =>
    `${f(c + rad * Math.cos(a))} ${f(c + rad * Math.sin(a))}`;

  const d =
    `M${pt(Ro, midAngle - spanO / 2)}` +
    ` A${Ro} ${Ro} 0 ${spanO > Math.PI ? 1 : 0} 1 ${pt(Ro, midAngle + spanO / 2)}` +
    ` L${pt(r, midAngle + spanI / 2)}` +
    ` A${r} ${r} 0 ${spanI > Math.PI ? 1 : 0} 0 ${pt(r, midAngle - spanI / 2)}` +
    ` Z`;

  const lr = (Ro + r) / 2;
  const labelMaxW = Math.min(96, Math.floor(step * ((R + r) / 2) * 0.9));

  return {
    midAngle,
    outerR: Ro,
    innerR: r,
    path: d,
    labelX: f(c + lr * Math.cos(midAngle) - labelMaxW / 2),
    labelY: f(c + lr * Math.sin(midAngle)),
    labelMaxW,
  };
}

// ---- State ----
interface WheelState {
  visible: boolean;
  data: import('../../preload/overlay').WheelData | null;
  hoveredWedge: number;
  centerHovered: boolean;
  keyboardFocus: number;
}

const state: WheelState = {
  visible: false,
  data: null,
  hoveredWedge: -1,
  centerHovered: false,
  keyboardFocus: -1,
};

// ---- DOM refs ----
const root = document.getElementById('wheel-root')!;
const container = document.getElementById('wheel-container')!;
const disc = document.getElementById('disc')!;
const emptyRings = document.getElementById('empty-rings')! as unknown as SVGSVGElement;
const wedgesSvg = document.getElementById('wedges-svg')! as unknown as SVGSVGElement;
const wedgeLabels = document.getElementById('wedge-labels')!;
const center = document.getElementById('center')!;
const centerFile = document.getElementById('center-file')!;
const centerOpen = document.getElementById('center-open')!;
const centerCancel = document.getElementById('center-cancel')!;
const centerEmpty = document.getElementById('center-empty')!;
const hintPill = document.getElementById('hint-pill')!;

// ---- Render ----

function render(): void {
  if (!state.visible || !state.data) {
    root.style.display = 'none';
    return;
  }

  root.style.display = 'flex';
  const d = state.data;
  const R = WHEEL_SIZES[d.size] || 175;
  const r = Math.round(R * INNER_RATIO);
  const S = (R + CANVAS_PAD) * 2;
  const c = S / 2;
  const n = d.wedges.length;
  const isEmpty = d.isEmpty || n === 0;

  // Container size
  container.style.width = `${S}px`;
  container.style.height = `${S}px`;

  // Disc
  const discR = R + DISC_EXTRA;
  disc.style.left = `${c - discR}px`;
  disc.style.top = `${c - discR}px`;
  disc.style.width = `${discR * 2}px`;
  disc.style.height = `${discR * 2}px`;

  // Empty rings
  if (isEmpty) {
    emptyRings.style.display = '';
    emptyRings.setAttribute('width', String(S));
    emptyRings.setAttribute('height', String(S));
    const ringR = (R + r) / 2;
    const ringW = R - r;
    emptyRings.innerHTML =
      `<circle cx="${c}" cy="${c}" r="${ringR}" fill="none" stroke="rgba(255,255,255,0.035)" stroke-width="${ringW}"/>` +
      `<circle cx="${c}" cy="${c}" r="${R}" fill="none" stroke="rgba(255,255,255,0.16)" stroke-dasharray="4 6"/>`;
  } else {
    emptyRings.style.display = 'none';
  }

  // Wedges
  wedgesSvg.setAttribute('width', String(S));
  wedgesSvg.setAttribute('height', String(S));
  wedgesSvg.innerHTML = '';
  wedgeLabels.innerHTML = '';

  const hIdx = state.data.isKeyboardMode ? state.keyboardFocus : state.hoveredWedge;
  const isKb = state.data.isKeyboardMode;

  for (let i = 0; i < n; i++) {
    const w = d.wedges[i];
    const hovered = i === hIdx;
    const geom = computeWedge(c, R, r, n, i, hovered);

    // SVG path
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', geom.path);
    path.setAttribute('class', 'fw-wedge-path');

    if (hovered) {
      path.setAttribute('fill', '#7C3AED');
      path.setAttribute('stroke', isKb ? '#FFFFFF' : '#A78BFA');
      path.setAttribute('stroke-width', isKb ? '2.5' : '1');
    } else {
      path.setAttribute('fill', w.isSpecial ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.055)');
      path.setAttribute('stroke', 'rgba(255,255,255,0.08)');
      path.setAttribute('stroke-width', '1');
    }

    path.dataset.index = String(i);
    wedgesSvg.appendChild(path);

    // Label container
    const hasBadge = !!w.badge;
    const bh = hasBadge ? 76 : 62;
    const label = document.createElement('div');
    label.className = 'fw-wedge-label';
    label.style.left = `${geom.labelX}px`;
    label.style.top = `${geom.labelY - bh / 2}px`;
    label.style.width = `${geom.labelMaxW}px`;
    label.style.transform = `scale(${hovered ? 1.06 : 1})`;

    // Icon
    if (w.isSpecial) {
      const tile = document.createElement('div');
      tile.className = `fw-wedge-icon-special${hovered ? ' hovered' : ''}`;
      if (w.specialKind === 'add') {
        tile.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#DAD7E3" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;
      } else {
        tile.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="#DAD7E3"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg>`;
      }
      label.appendChild(tile);
    } else {
      const tile = document.createElement('div');
      tile.className = 'fw-wedge-icon';
      if (w.iconDataUrl) {
        tile.innerHTML = `<img src="${escapeAttr(w.iconDataUrl)}" alt="" width="40" height="40">`;
      } else {
        const colorIdx = hashCode(w.appId) % MONO_COLORS.length;
        tile.style.background = w.monogramColor || MONO_COLORS[colorIdx];
        tile.style.color = w.monogramInk || '#FFFFFF';
        tile.textContent = w.monogram;
      }
      label.appendChild(tile);
    }

    // Name
    const nameEl = document.createElement('div');
    nameEl.className = `fw-wedge-name${hovered ? ' hovered' : ''}`;
    nameEl.style.maxWidth = `${geom.labelMaxW}px`;
    nameEl.textContent = w.name;
    label.appendChild(nameEl);

    // Badge
    if (w.badge) {
      const badge = document.createElement('div');
      badge.className = `fw-wedge-badge${hovered ? ' hovered' : ''}`;
      badge.textContent = w.badge;
      label.appendChild(badge);
    }

    wedgeLabels.appendChild(label);
  }

  // Center
  const cd = 2 * r - 10;
  const tw = cd - 26;
  center.style.left = `${c - cd / 2}px`;
  center.style.top = `${c - cd / 2}px`;
  center.style.width = `${cd}px`;
  center.style.height = `${cd}px`;

  const hoveredApp = hIdx >= 0 && hIdx < n ? d.wedges[hIdx] : null;
  const showCancel = state.centerHovered;
  const showOpen = !!hoveredApp && !showCancel;
  const showEmpty = isEmpty && !showCancel;
  const showFile = !showCancel && !showOpen && !showEmpty;

  center.classList.toggle('cancel-hover', showCancel);

  // File state
  centerFile.style.display = showFile ? '' : 'none';
  if (showFile) {
    centerFile.innerHTML = `
      <div class="fw-ext-chip">${escapeHtml(d.fileExtLabel)}</div>
      <div class="fw-center-filename" style="max-width:${tw}px">${escapeHtml(d.fileName)}</div>
      <div class="fw-center-meta" style="max-width:${tw}px">${escapeHtml(d.metaText)}</div>
    `;
  }

  // Open state
  centerOpen.style.display = showOpen ? '' : 'none';
  if (showOpen && hoveredApp) {
    const verb = hoveredApp.isSpecial
      ? (hoveredApp.specialKind === 'add' ? 'Remember an app' :
         hoveredApp.specialKind === 'choose' ? 'Windows' : 'Choose')
      : 'Open with';
    const target = hoveredApp.isSpecial
      ? (hoveredApp.specialKind === 'add' ? `for ${d.fileExtLabel.toLowerCase()} files` :
         hoveredApp.specialKind === 'choose' ? 'Choose an app…' : 'Another app…')
      : hoveredApp.name;
    centerOpen.innerHTML = `
      <div class="fw-center-verb">${escapeHtml(verb)}</div>
      <div class="fw-center-appname" style="max-width:${tw}px">${escapeHtml(target)}</div>
      <div class="fw-center-filename-small" style="max-width:${tw}px">${escapeHtml(d.fileName)}</div>
    `;
  }

  // Cancel state
  centerCancel.style.display = showCancel ? '' : 'none';
  if (showCancel) {
    centerCancel.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ECEAF2" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
      <div class="fw-cancel-label">Cancel</div>
      <div class="fw-cancel-hint">Release to close</div>
    `;
  }

  // Empty state
  centerEmpty.style.display = showEmpty ? '' : 'none';
  if (showEmpty) {
    centerEmpty.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C9B8FF" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg>
      <div class="fw-empty-line" style="max-width:${tw}px">${escapeHtml(d.emptyText || 'No app opens this file')}</div>
      <div class="fw-center-meta">${escapeHtml(d.fileName)}</div>
    `;
  }

  // Hint pill
  renderHintPill(d, hIdx, n, state.centerHovered);
}

function renderHintPill(
  data: import('../../preload/overlay').WheelData,
  hoveredIdx: number,
  n: number,
  centerHov: boolean
): void {
  hintPill.classList.toggle('center-hover', centerHov);

  if (data.isKeyboardMode) {
    hintPill.innerHTML = `
      <span class="fw-keycap keyboard-mode">← →</span> Move
      <span class="fw-keycap keyboard-mode">Enter</span> Open
      <span class="fw-keycap keyboard-mode">Esc</span> Close
    `;
    return;
  }

  if (centerHov) {
    hintPill.textContent = 'Nothing opens. The file stays where it was.';
    return;
  }

  if (data.isEmpty && data.emptyText?.includes('all')) {
    // Multiple files with nothing in common
    hintPill.innerHTML = `
      <span style="font-family:var(--fw-font-mono);color:var(--fw-accent-text)">${escapeHtml(data.metaText)}</span>
      <span class="fw-pill-sep">·</span>
      drop them one type at a time
    `;
    return;
  }

  if (n > 0 && data.fileName.includes('files')) {
    // Multiple files with common apps
    hintPill.textContent = `Showing apps that open ${data.fileName}`;
    return;
  }

  // Default
  hintPill.innerHTML = `
    <span class="fw-keycap">Esc</span> Dismiss
    <span class="fw-pill-sep">·</span>
    Drop on the center to cancel
  `;
}

// ---- Helpers ----
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---- Event wiring ----
const api = window.orbit;

api.onShow((data) => {
  state.visible = true;
  state.data = data;
  state.hoveredWedge = -1;
  state.centerHovered = false;
  state.keyboardFocus = data.isKeyboardMode ? 0 : -1;

  root.classList.add('fw-reveal');
  render();

  // Remove animation class after it completes
  setTimeout(() => root.classList.remove('fw-reveal'), 200);
});

api.onHide(() => {
  state.visible = false;
  state.data = null;
  render();
});

api.onHoverChange((target) => {
  if (target.type === 'wedge' && target.index !== undefined) {
    state.hoveredWedge = target.index;
    state.centerHovered = false;
  } else if (target.type === 'center') {
    state.hoveredWedge = -1;
    state.centerHovered = true;
  } else {
    state.hoveredWedge = -1;
    state.centerHovered = false;
  }
  render();
});

api.onKeyboardFocusChange((index) => {
  state.keyboardFocus = index;
  render();
});

// Keyboard navigation (Try-the-wheel mode)
document.addEventListener('keydown', (e) => {
  if (!state.visible || !state.data?.isKeyboardMode) return;

  const n = state.data.wedges.length;
  if (n === 0) {
    if (e.key === 'Escape') api.dismiss();
    return;
  }

  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      state.keyboardFocus = (state.keyboardFocus + 1) % n;
      render();
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
      state.keyboardFocus = (state.keyboardFocus - 1 + n) % n;
      render();
      break;
    case 'Enter':
      if (state.keyboardFocus >= 0) {
        api.selectWedge(state.keyboardFocus);
      }
      break;
    case 'Escape':
      api.dismiss();
      break;
  }
});
