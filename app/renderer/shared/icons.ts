// Orbit SVG icon definitions — spec section 3.1
// All icons as SVG strings for embedding in the UI

/** Logo glyph (24×24 viewBox): segmented ring + center dot */
export const logoGlyph = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="9" stroke="#A78BFA" stroke-width="3.2" stroke-dasharray="5.6 1.47"/>
  <circle cx="12" cy="12" r="2.4" fill="#A78BFA"/>
</svg>`;

/** Paused glyph: ring in muted color + pause bars */
export const pausedGlyph = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="9" stroke="#77747F" stroke-width="3.2" stroke-dasharray="5.6 1.47"/>
  <path d="M10 9v6" stroke="#ECEAF2" stroke-width="2" stroke-linecap="round"/>
  <path d="M14 9v6" stroke="#ECEAF2" stroke-width="2" stroke-linecap="round"/>
</svg>`;

/** Logo at specific size */
export function logoSvg(size: number): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="9" stroke="#A78BFA" stroke-width="3.2" stroke-dasharray="5.6 1.47"/>
  <circle cx="12" cy="12" r="2.4" fill="#A78BFA"/>
</svg>`;
}

/** Paused icon at specific size */
export function pausedSvg(size: number): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="9" stroke="#77747F" stroke-width="3.2" stroke-dasharray="5.6 1.47"/>
  <path d="M10 9v6" stroke="#ECEAF2" stroke-width="2" stroke-linecap="round"/>
  <path d="M14 9v6" stroke="#ECEAF2" stroke-width="2" stroke-linecap="round"/>
</svg>`;
}

// Title bar icons
export const minimizeIcon = `<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="#A9A6B5"/></svg>`;
export const closeIcon = `<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="#A9A6B5"/></svg>`;

// Checkmark
export const checkIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34C77B" stroke-width="2.2" stroke-linecap="round"><path d="M5 12l5 5 9-10"/></svg>`;

// Folder icon
export const folderIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#A9A6B5" stroke-width="1.8"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;

// Plus icon
export const plusIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;

// Chevron right (for submenu)
export const chevronRight = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#A9A6B5" stroke-width="2.4"><path d="M9 6l6 6-6 6"/></svg>`;

// Eye-off (hide) icon
export const eyeOffIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A9A6B5" stroke-width="1.8" stroke-linecap="round"><path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a16 16 0 0 1-2.6 3.2M6.6 6.6C4.2 8.2 3 12 3 12s4 6 9 6a8.7 8.7 0 0 0 4.4-1.2"/></svg>`;

// Pin icon
export const pinIcon = (filled: boolean) => {
  const fill = filled ? '#C9B8FF' : 'none';
  const stroke = filled ? '#C9B8FF' : '#A9A6B5';
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}" stroke-width="1.8" stroke-linejoin="round"><path d="M9 3h6l-1 6 4 4H6l4-4zM12 13v8"/></svg>`;
};

// Reorder handle (6-dot grip)
export const reorderHandle = `<svg width="10" height="16" viewBox="0 0 10 16" fill="#77747F"><circle cx="2" cy="2" r="1.5"/><circle cx="8" cy="2" r="1.5"/><circle cx="2" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="2" cy="14" r="1.5"/><circle cx="8" cy="14" r="1.5"/></svg>`;

// X (dismiss/cancel)
export const xIcon = (size: number, strokeWidth = 2.2) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#ECEAF2" stroke-width="${strokeWidth}" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

// Info circle
export const infoIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C9B8FF" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg>`;

// Warning triangle
export const warningTriangle = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF9AAB" stroke-width="2.2" stroke-linecap="round"><path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5v.01"/></svg>`;

// Terminal icon (for script confirmation)
export const terminalIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F1CF7A" stroke-width="2" stroke-linecap="round"><path d="M4 17l6-6-6-6M12 19h8"/></svg>`;

// Wheel special wedge icons

/** 2×2 grid for "Other app…" / "Choose an app…" */
export const gridIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="#DAD7E3"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg>`;

/** Plus for "Add app for .ext" */
export const addIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#DAD7E3" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;
