/**
 * Placement clamping tests — spec section 2.7
 *
 * Tests: all four edges and corners, multi-monitor layouts,
 * hint pill included, negative origins.
 */
import { describe, it, expect } from 'vitest';

interface Monitor {
  x: number; y: number;
  width: number; height: number;
  scale: number;
}

interface PlacementResult {
  x: number; y: number;
  monitorScale: number;
}

function computePlacement(params: {
  cursorX: number; cursorY: number;
  canvasSize: number;
  hintPillHeight: number;
  margin: number;
  monitors: Monitor[];
}): PlacementResult {
  const { cursorX, cursorY, canvasSize, hintPillHeight, margin, monitors } = params;
  const totalHeight = canvasSize + 14 + hintPillHeight; // 14px gap between canvas and pill

  // Find monitor containing cursor (or nearest)
  let bestMon = monitors[0];
  let bestDist = Infinity;
  for (const m of monitors) {
    if (cursorX >= m.x && cursorX < m.x + m.width &&
        cursorY >= m.y && cursorY < m.y + m.height) {
      bestMon = m;
      bestDist = 0;
      break;
    }
    const cx = Math.max(m.x, Math.min(cursorX, m.x + m.width - 1));
    const cy = Math.max(m.y, Math.min(cursorY, m.y + m.height - 1));
    const dist = Math.sqrt((cursorX - cx) ** 2 + (cursorY - cy) ** 2);
    if (dist < bestDist) {
      bestDist = dist;
      bestMon = m;
    }
  }

  const scaledMargin = Math.round(margin * bestMon.scale);

  // Center on cursor
  let x = cursorX - Math.round(canvasSize / 2);
  let y = cursorY - Math.round(canvasSize / 2);

  // Clamp to work area with margin
  const minX = bestMon.x + scaledMargin;
  const maxX = bestMon.x + bestMon.width - scaledMargin - canvasSize;
  const minY = bestMon.y + scaledMargin;
  const maxY = bestMon.y + bestMon.height - scaledMargin - totalHeight;

  x = Math.max(minX, Math.min(x, maxX));
  y = Math.max(minY, Math.min(y, maxY));

  return { x, y, monitorScale: bestMon.scale };
}

const CANVAS_M = (175 + 22) * 2; // 394
const PILL_H = 34;
const MARGIN = 8;

describe('Placement clamping', () => {
  const singleMonitor: Monitor[] = [
    { x: 0, y: 0, width: 1920, height: 1080, scale: 1 }
  ];

  it('centers on cursor when there is plenty of space', () => {
    const result = computePlacement({
      cursorX: 960, cursorY: 540,
      canvasSize: CANVAS_M, hintPillHeight: PILL_H, margin: MARGIN,
      monitors: singleMonitor,
    });
    expect(result.x).toBe(960 - CANVAS_M / 2);
    expect(result.y).toBe(540 - CANVAS_M / 2);
  });

  it('clamps at left edge', () => {
    const result = computePlacement({
      cursorX: 50, cursorY: 540,
      canvasSize: CANVAS_M, hintPillHeight: PILL_H, margin: MARGIN,
      monitors: singleMonitor,
    });
    expect(result.x).toBe(MARGIN); // clamped to left margin
    expect(result.y).toBe(540 - CANVAS_M / 2);
  });

  it('clamps at right edge', () => {
    const result = computePlacement({
      cursorX: 1870, cursorY: 540,
      canvasSize: CANVAS_M, hintPillHeight: PILL_H, margin: MARGIN,
      monitors: singleMonitor,
    });
    expect(result.x).toBe(1920 - MARGIN - CANVAS_M);
  });

  it('clamps at top edge', () => {
    const result = computePlacement({
      cursorX: 960, cursorY: 50,
      canvasSize: CANVAS_M, hintPillHeight: PILL_H, margin: MARGIN,
      monitors: singleMonitor,
    });
    expect(result.y).toBe(MARGIN);
  });

  it('clamps at bottom edge including hint pill', () => {
    const result = computePlacement({
      cursorX: 960, cursorY: 1050,
      canvasSize: CANVAS_M, hintPillHeight: PILL_H, margin: MARGIN,
      monitors: singleMonitor,
    });
    const totalH = CANVAS_M + 14 + PILL_H;
    expect(result.y).toBe(1080 - MARGIN - totalH);
  });

  it('clamps at bottom-right corner', () => {
    const result = computePlacement({
      cursorX: 1900, cursorY: 1060,
      canvasSize: CANVAS_M, hintPillHeight: PILL_H, margin: MARGIN,
      monitors: singleMonitor,
    });
    expect(result.x).toBe(1920 - MARGIN - CANVAS_M);
    const totalH = CANVAS_M + 14 + PILL_H;
    expect(result.y).toBe(1080 - MARGIN - totalH);
  });

  describe('multi-monitor', () => {
    const dualMonitors: Monitor[] = [
      { x: 0, y: 0, width: 1920, height: 1080, scale: 1 },       // primary
      { x: -1920, y: 0, width: 1920, height: 1080, scale: 1.5 },  // left (negative x)
    ];

    it('uses monitor containing cursor', () => {
      const result = computePlacement({
        cursorX: -960, cursorY: 540,
        canvasSize: CANVAS_M, hintPillHeight: PILL_H, margin: MARGIN,
        monitors: dualMonitors,
      });
      expect(result.monitorScale).toBe(1.5);
      expect(result.x).toBeGreaterThanOrEqual(-1920);
      expect(result.x + CANVAS_M).toBeLessThanOrEqual(0);
    });

    it('works with negative origin monitor at left edge', () => {
      const result = computePlacement({
        cursorX: -1900, cursorY: 540,
        canvasSize: CANVAS_M, hintPillHeight: PILL_H, margin: MARGIN,
        monitors: dualMonitors,
      });
      // Clamped to left margin of left monitor (margin scaled by 1.5)
      expect(result.x).toBe(-1920 + Math.round(MARGIN * 1.5));
    });

    it('stays on one monitor, never spans two', () => {
      // Cursor near the boundary between monitors
      const result = computePlacement({
        cursorX: -50, cursorY: 540,
        canvasSize: CANVAS_M, hintPillHeight: PILL_H, margin: MARGIN,
        monitors: dualMonitors,
      });
      // Should be fully within the left monitor
      expect(result.x).toBeGreaterThanOrEqual(-1920);
      expect(result.x + CANVAS_M).toBeLessThanOrEqual(0);
    });
  });

  describe('mixed DPI', () => {
    const mixedDpi: Monitor[] = [
      { x: 0, y: 0, width: 3840, height: 2160, scale: 2 },    // 4K at 200%
      { x: 3840, y: 0, width: 1920, height: 1080, scale: 1 },  // 1080p at 100%
    ];

    it('uses correct scale for each monitor', () => {
      const r1 = computePlacement({
        cursorX: 1920, cursorY: 1080,
        canvasSize: CANVAS_M, hintPillHeight: PILL_H, margin: MARGIN,
        monitors: mixedDpi,
      });
      expect(r1.monitorScale).toBe(2);

      const r2 = computePlacement({
        cursorX: 4800, cursorY: 540,
        canvasSize: CANVAS_M, hintPillHeight: PILL_H, margin: MARGIN,
        monitors: mixedDpi,
      });
      expect(r2.monitorScale).toBe(1);
    });
  });

  describe('monitor above primary (negative y)', () => {
    const stacked: Monitor[] = [
      { x: 0, y: 0, width: 1920, height: 1080, scale: 1 },
      { x: 0, y: -1080, width: 1920, height: 1080, scale: 1 },
    ];

    it('works with negative y coordinates', () => {
      const result = computePlacement({
        cursorX: 960, cursorY: -540,
        canvasSize: CANVAS_M, hintPillHeight: PILL_H, margin: MARGIN,
        monitors: stacked,
      });
      expect(result.y).toBeGreaterThanOrEqual(-1080);
      expect(result.y + CANVAS_M + 14 + PILL_H).toBeLessThanOrEqual(0);
    });
  });

  describe('all three sizes', () => {
    const sizes = { S: 150, M: 175, L: 200 };
    for (const [name, R] of Object.entries(sizes)) {
      const canvas = (R + 22) * 2;
      it(`size ${name} (canvas ${canvas}px) fits on screen`, () => {
        const result = computePlacement({
          cursorX: 960, cursorY: 540,
          canvasSize: canvas, hintPillHeight: PILL_H, margin: MARGIN,
          monitors: singleMonitor,
        });
        expect(result.x).toBeGreaterThanOrEqual(MARGIN);
        expect(result.x + canvas).toBeLessThanOrEqual(1920 - MARGIN);
      });
    }
  });
});
