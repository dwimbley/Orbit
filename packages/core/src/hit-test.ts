/**
 * Pure hit-testing for the Orbit wheel.
 *
 * Coordinate system: angle 0 at 12 o'clock, increasing clockwise.
 */

export type HitResult =
  | { type: 'center' }
  | { type: 'wedge'; index: number }
  | { type: 'outside' };

export interface HitTestParams {
  /** Pointer x in canvas coordinates. */
  px: number;
  /** Pointer y in canvas coordinates. */
  py: number;
  /** Wheel centre x. */
  cx: number;
  /** Wheel centre y. */
  cy: number;
  /** Outer radius. */
  R: number;
  /** Inner radius. */
  r: number;
  /** Number of wedges. */
  n: number;
  /** True when the wheel has no file/extension context (everything inside is "center"). */
  isEmpty: boolean;
}

/**
 * Determine what the pointer is over.
 *
 * - d <= r  -> center
 * - r < d <= R + 12 + 24  and  n > 0  -> wedge (gaps assigned to nearest wedge)
 * - otherwise -> outside
 * - When isEmpty, the entire disc area is treated as center.
 */
export function hitTest(params: HitTestParams): HitResult {
  const { px, py, cx, cy, R, r, n, isEmpty } = params;

  const dx = px - cx;
  const dy = py - cy;
  const d = Math.sqrt(dx * dx + dy * dy);

  if (isEmpty) {
    // Entire disc counts as centre when empty
    if (d <= R + 12 + 24) {
      return { type: 'center' };
    }
    return { type: 'outside' };
  }

  if (d <= r) {
    return { type: 'center' };
  }

  if (d <= R + 12 + 24 && n > 0) {
    // Angle with 0 at 12 o'clock, increasing clockwise
    // atan2(dy, dx) gives 0 = 3 o'clock. Rotate by +90 deg.
    let theta = Math.atan2(dx, -dy); // 0 at top, CW positive
    if (theta < 0) {
      theta += 2 * Math.PI;
    }

    const step = (2 * Math.PI) / n;
    // Shift by half-step so wedge 0 is centred at 12 o'clock
    const index = Math.floor(((theta + step / 2) % (2 * Math.PI)) / step);
    return { type: 'wedge', index: index % n };
  }

  return { type: 'outside' };
}
