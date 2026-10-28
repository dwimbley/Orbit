/**
 * Wheel placement: centres the wheel canvas on the cursor and clamps to
 * the current monitor's work area so the canvas + hint pill stay visible.
 *
 * All values are in physical (device) pixels.  Negative origins and signed
 * coordinates are fully supported.
 */

export interface Monitor {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

export interface PlacementResult {
  /** Top-left x of the canvas window in physical pixels. */
  x: number;
  /** Top-left y of the canvas window in physical pixels. */
  y: number;
  /** DPI scale of the monitor the wheel is placed on. */
  monitorScale: number;
}

export interface PlacementParams {
  cursorX: number;
  cursorY: number;
  /** Side length of the square canvas (physical px). */
  canvasSize: number;
  /** Height of the hint pill below the canvas (physical px). */
  hintPillHeight: number;
  /** Minimum margin from monitor edge (physical px). */
  margin: number;
  monitors: Monitor[];
}

/**
 * Compute the top-left position for the wheel canvas window.
 *
 * 1. Centre the canvas on the cursor.
 * 2. Identify the monitor containing the cursor (or the nearest one).
 * 3. Clamp so canvas + hint pill (14 px gap + pill height) + margin fit.
 */
export function computePlacement(params: PlacementParams): PlacementResult {
  const { cursorX, cursorY, canvasSize, hintPillHeight, margin, monitors } = params;

  const monitor = findMonitor(cursorX, cursorY, monitors);

  // Total vertical extent we need to fit: canvas + 14px gap + hint pill
  const totalHeight = canvasSize + 14 + hintPillHeight;

  // Desired top-left (centred on cursor)
  let x = cursorX - canvasSize / 2;
  let y = cursorY - canvasSize / 2;

  // Clamp to monitor work area with margin
  const minX = monitor.x + margin;
  const minY = monitor.y + margin;
  const maxX = monitor.x + monitor.width - canvasSize - margin;
  const maxY = monitor.y + monitor.height - totalHeight - margin;

  x = Math.max(minX, Math.min(x, maxX));
  y = Math.max(minY, Math.min(y, maxY));

  return { x, y, monitorScale: monitor.scale };
}

/**
 * Find the monitor that contains the cursor point, or the nearest monitor
 * if the cursor is outside all monitors.
 */
function findMonitor(cx: number, cy: number, monitors: Monitor[]): Monitor {
  if (monitors.length === 0) {
    // Fallback: a single virtual monitor
    return { x: 0, y: 0, width: 1920, height: 1080, scale: 1 };
  }

  // Check containment first
  for (const m of monitors) {
    if (cx >= m.x && cx < m.x + m.width && cy >= m.y && cy < m.y + m.height) {
      return m;
    }
  }

  // No containment: pick nearest monitor by distance to its bounding rect
  let best = monitors[0];
  let bestDist = Infinity;
  for (const m of monitors) {
    const dx = Math.max(m.x - cx, 0, cx - (m.x + m.width));
    const dy = Math.max(m.y - cy, 0, cy - (m.y + m.height));
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = m;
    }
  }
  return best;
}
