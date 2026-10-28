/**
 * Hit-testing unit tests — spec section 3.3
 *
 * Tests: n=1…8, boundaries at exact angles, 5px gaps resolve to nearest wedge,
 * center vs inner ring, disc+margin vs outside, S/M/L, DPI scales,
 * canvases on monitors with negative origins.
 */
import { describe, it, expect } from 'vitest';

// Inline the hit-test function for testing (will import from @core once built)
type HitResult = { type: 'center' } | { type: 'wedge'; index: number } | { type: 'outside' };

function hitTest(params: {
  px: number; py: number;
  cx: number; cy: number;
  R: number; r: number;
  n: number; isEmpty: boolean;
}): HitResult {
  const { px, py, cx, cy, R, r, n, isEmpty } = params;
  const dx = px - cx;
  const dy = py - cy;
  const d = Math.sqrt(dx * dx + dy * dy);

  if (isEmpty) {
    if (d <= R + 12 + 24) return { type: 'center' };
    return { type: 'outside' };
  }

  if (d <= r) return { type: 'center' };

  if (d <= R + 12 + 24 && n > 0) {
    // Angle: 0 at 12 o'clock, increasing clockwise
    let angle = Math.atan2(dx, -dy); // atan2(x, -y) gives 0 at top, CW positive
    if (angle < 0) angle += 2 * Math.PI;
    const step = (2 * Math.PI) / n;
    const index = Math.floor(((angle + step / 2) % (2 * Math.PI)) / step);
    return { type: 'wedge', index: Math.min(index, n - 1) };
  }

  return { type: 'outside' };
}

// Size configs
const SIZES = {
  S: { R: 150, r: Math.round(150 * 0.38) },
  M: { R: 175, r: Math.round(175 * 0.38) },
  L: { R: 200, r: Math.round(200 * 0.38) },
};

describe('Hit testing', () => {
  describe('center detection', () => {
    it('should detect center at origin', () => {
      const { R, r } = SIZES.M;
      const c = (R + 22);
      expect(hitTest({ px: c, py: c, cx: c, cy: c, R, r, n: 8, isEmpty: false }))
        .toEqual({ type: 'center' });
    });

    it('should detect center at inner radius boundary', () => {
      const { R, r } = SIZES.M;
      const c = (R + 22);
      // Point just inside inner radius
      expect(hitTest({ px: c, py: c - r + 1, cx: c, cy: c, R, r, n: 8, isEmpty: false }))
        .toEqual({ type: 'center' });
    });

    it('should detect center at exact inner radius', () => {
      const { R, r } = SIZES.M;
      const c = (R + 22);
      expect(hitTest({ px: c, py: c - r, cx: c, cy: c, R, r, n: 8, isEmpty: false }))
        .toEqual({ type: 'center' });
    });
  });

  describe('wedge detection for n=1..8', () => {
    for (let n = 1; n <= 8; n++) {
      it(`should detect wedge 0 at 12 o'clock for n=${n}`, () => {
        const { R, r } = SIZES.M;
        const c = (R + 22);
        const midR = (R + r) / 2;
        // 12 o'clock is straight up: (cx, cy - midR)
        expect(hitTest({ px: c, py: c - midR, cx: c, cy: c, R, r, n, isEmpty: false }))
          .toEqual({ type: 'wedge', index: 0 });
      });
    }

    it('should detect last wedge just left of 12 o\'clock for n=8', () => {
      const { R, r } = SIZES.M;
      const c = (R + 22);
      const midR = (R + r) / 2;
      const step = (2 * Math.PI) / 8;
      // Last wedge (7) is at angle -90° + 7*step = -90° + 315° = 225° from x-axis = just before 12 o'clock going CCW
      const angle = -Math.PI / 2 + 7 * step;
      const px = c + midR * Math.cos(angle);
      const py = c + midR * Math.sin(angle);
      expect(hitTest({ px, py, cx: c, cy: c, R, r, n: 8, isEmpty: false }))
        .toEqual({ type: 'wedge', index: 7 });
    });

    it('should assign gaps to nearest wedge (generous targets)', () => {
      const { R, r } = SIZES.M;
      const c = (R + 22);
      const midR = (R + r) / 2;
      const n = 4;
      const step = (2 * Math.PI) / n;

      // Right at the boundary between wedge 0 and 1
      // Wedge 0 center: -PI/2, Wedge 1 center: -PI/2 + step
      // Boundary angle from 12 o'clock: step/2
      // A point slightly past boundary → should go to wedge 1
      const boundaryAngle = step / 2 + 0.01;
      const angle = -Math.PI / 2 + boundaryAngle;
      const px = c + midR * Math.cos(angle);
      const py = c + midR * Math.sin(angle);
      const result = hitTest({ px, py, cx: c, cy: c, R, r, n, isEmpty: false });
      expect(result.type).toBe('wedge');
      if (result.type === 'wedge') {
        expect(result.index).toBe(1);
      }
    });
  });

  describe('outside detection', () => {
    it('should detect outside beyond disc + 24px margin', () => {
      const { R, r } = SIZES.M;
      const c = (R + 22);
      const farOut = R + 12 + 24 + 10;
      expect(hitTest({ px: c, py: c - farOut, cx: c, cy: c, R, r, n: 8, isEmpty: false }))
        .toEqual({ type: 'outside' });
    });

    it('should detect wedge at disc + 24px margin boundary', () => {
      const { R, r } = SIZES.M;
      const c = (R + 22);
      const atEdge = R + 12 + 24;
      expect(hitTest({ px: c, py: c - atEdge, cx: c, cy: c, R, r, n: 8, isEmpty: false }))
        .toEqual({ type: 'wedge', index: 0 });
    });
  });

  describe('empty state', () => {
    it('should return center for everything inside disc when empty', () => {
      const { R, r } = SIZES.M;
      const c = (R + 22);
      const midR = (R + r) / 2;
      expect(hitTest({ px: c, py: c - midR, cx: c, cy: c, R, r, n: 0, isEmpty: true }))
        .toEqual({ type: 'center' });
    });

    it('should return outside beyond disc when empty', () => {
      const { R, r } = SIZES.M;
      const c = (R + 22);
      const farOut = R + 12 + 24 + 10;
      expect(hitTest({ px: c, py: c - farOut, cx: c, cy: c, R, r, n: 0, isEmpty: true }))
        .toEqual({ type: 'outside' });
    });
  });

  describe('all sizes', () => {
    for (const [name, { R, r }] of Object.entries(SIZES)) {
      it(`size ${name}: center, wedge, outside work`, () => {
        const c = (R + 22);
        // Center
        expect(hitTest({ px: c, py: c, cx: c, cy: c, R, r, n: 6, isEmpty: false }).type).toBe('center');
        // Wedge
        const midR = (R + r) / 2;
        expect(hitTest({ px: c, py: c - midR, cx: c, cy: c, R, r, n: 6, isEmpty: false }).type).toBe('wedge');
        // Outside
        expect(hitTest({ px: c + R + 50, py: c, cx: c, cy: c, R, r, n: 6, isEmpty: false }).type).toBe('outside');
      });
    }
  });

  describe('DPI scaling', () => {
    const scales = [1, 1.25, 1.5, 1.75, 2];
    for (const scale of scales) {
      it(`works at ${scale * 100}% DPI`, () => {
        const R = Math.round(175 * scale);
        const r = Math.round(R * 0.38);
        const c = (R + Math.round(22 * scale));
        const midR = (R + r) / 2;

        // Center
        expect(hitTest({ px: c, py: c, cx: c, cy: c, R, r, n: 8, isEmpty: false }).type).toBe('center');
        // Wedge 0
        expect(hitTest({ px: c, py: c - midR, cx: c, cy: c, R, r, n: 8, isEmpty: false }))
          .toEqual({ type: 'wedge', index: 0 });
      });
    }
  });

  describe('negative coordinates (monitors left of primary)', () => {
    it('works with negative origin', () => {
      const { R, r } = SIZES.M;
      const cx = -1920 + (R + 22);
      const cy = -200 + (R + 22);
      // Center
      expect(hitTest({ px: cx, py: cy, cx, cy, R, r, n: 8, isEmpty: false }).type).toBe('center');
      // Wedge at 12 o'clock
      const midR = (R + r) / 2;
      expect(hitTest({ px: cx, py: cy - midR, cx, cy, R, r, n: 8, isEmpty: false }))
        .toEqual({ type: 'wedge', index: 0 });
    });
  });
});
