/**
 * Wedge geometry: computes SVG path `d` attributes for wheel wedges.
 *
 * Layout conventions:
 *  - The first wedge starts at 12 o'clock (-90 deg) and proceeds clockwise.
 *  - A 5 px visual gap separates adjacent wedges (measured as arc-length at each radius).
 *  - A hovered wedge extends 9 px beyond the normal outer radius.
 */

const GAP_PX = 5;

export interface WedgePathParams {
  /** Center coordinate (cx = cy = c for a square canvas). */
  c: number;
  /** Normal outer radius. */
  R: number;
  /** Inner radius. */
  r: number;
  /** Total number of wedges. */
  n: number;
  /** Zero-based index of this wedge. */
  i: number;
  /** Whether the wedge is currently hovered. */
  hovered: boolean;
}

/**
 * Returns an SVG path `d` attribute string for wedge `i`.
 *
 * Path order:
 *   outer-arc-start -> outer-arc-end -> line-to inner-arc-end -> inner-arc (reverse) -> close
 */
export function computeWedgePath(params: WedgePathParams): string {
  const { c, R, r, n, i, hovered } = params;

  const Ro = hovered ? R + 9 : R;
  const step = (2 * Math.PI) / n; // angular step per wedge in radians

  // Half-gap angles at outer and inner radii (arc = gap / radius)
  const halfGapOuter = GAP_PX / (2 * Ro);
  const halfGapInner = GAP_PX / (2 * r);

  // Wedge centre angle (0 = 12 o'clock = -PI/2, clockwise positive)
  const centreAngle = -Math.PI / 2 + step * i;

  // Outer arc span
  const outerStart = centreAngle - step / 2 + halfGapOuter;
  const outerEnd = centreAngle + step / 2 - halfGapOuter;

  // Inner arc span (same angular direction)
  const innerStart = centreAngle - step / 2 + halfGapInner;
  const innerEnd = centreAngle + step / 2 - halfGapInner;

  // Convert polar to cartesian
  const px = (angle: number, radius: number) => c + radius * Math.cos(angle);
  const py = (angle: number, radius: number) => c + radius * Math.sin(angle);

  // Large-arc flag: 1 if the arc spans more than PI radians
  const outerSpan = outerEnd - outerStart;
  const innerSpan = innerEnd - innerStart;
  const outerLargeArc = outerSpan > Math.PI ? 1 : 0;
  const innerLargeArc = innerSpan > Math.PI ? 1 : 0;

  // Build path segments
  const osx = px(outerStart, Ro);
  const osy = py(outerStart, Ro);
  const oex = px(outerEnd, Ro);
  const oey = py(outerEnd, Ro);

  const isx = px(innerStart, r);
  const isy = py(innerStart, r);
  const iex = px(innerEnd, r);
  const iey = py(innerEnd, r);

  // Outer arc: clockwise (sweep-flag = 1)
  // Inner arc: counter-clockwise (sweep-flag = 0) to trace back
  return [
    `M ${osx} ${osy}`,
    `A ${Ro} ${Ro} 0 ${outerLargeArc} 1 ${oex} ${oey}`,
    `L ${iex} ${iey}`,
    `A ${r} ${r} 0 ${innerLargeArc} 0 ${isx} ${isy}`,
    'Z',
  ].join(' ');
}
