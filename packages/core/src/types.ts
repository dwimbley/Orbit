/** Wheel size presets. */
export type WheelSize = 'S' | 'M' | 'L';

/** Outer radius values for each wheel size. */
export const WheelRadii: Record<WheelSize, number> = {
  S: 150,
  M: 175,
  L: 200,
};

/** Computed wheel configuration derived from a WheelSize. */
export interface WheelConfig {
  size: WheelSize;
  /** Outer radius in px. */
  R: number;
  /** Inner radius in px (round(0.38 * R)). */
  r: number;
  /** Canvas side length in px ((R + 22) * 2). */
  canvasSize: number;
}

/** Build a WheelConfig for the given size. */
export function makeWheelConfig(size: WheelSize): WheelConfig {
  const R = WheelRadii[size];
  return {
    size,
    R,
    r: Math.round(0.38 * R),
    canvasSize: (R + 22) * 2,
  };
}
