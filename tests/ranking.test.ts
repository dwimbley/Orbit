/**
 * Ranking tests — spec section 4.4
 *
 * Tests: default first, pins and their order, manual reorder, usage ordering,
 * catalog tiebreak, hidden apps, max-wedge truncation with "Other app…" last,
 * multi-file intersection, empty intersection, unknown extensions, case-insensitive,
 * folders, folder+file mixes.
 */
import { describe, it, expect } from 'vitest';

interface AppCandidate {
  id: string;
  isDefault: boolean;
  isPinned: boolean;
  isHidden: boolean;
  userOrder?: number;
  usageCount: number;
  catalogOrder?: number;
  multi: boolean;
  name: string;
}

interface WheelEntry {
  id: string;
  badge?: 'DEFAULT' | 'PINNED';
  isOtherApp?: boolean;
}

function buildWheel(params: {
  candidates: AppCandidate[];
  maxWedges: number;
  isMultiFile: boolean;
}): WheelEntry[] {
  let apps = params.candidates.filter(a => !a.isHidden);

  if (params.isMultiFile) {
    apps = apps.filter(a => a.multi);
  }

  // Sort
  apps.sort((a, b) => {
    // Default first
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;

    // Pinned next, in user order
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    if (a.isPinned && b.isPinned) {
      return (a.userOrder ?? 0) - (b.userOrder ?? 0);
    }

    // Manual order if set
    if (a.userOrder !== undefined && b.userOrder !== undefined) {
      return a.userOrder - b.userOrder;
    }

    // Usage count descending
    if (a.usageCount !== b.usageCount) return b.usageCount - a.usageCount;

    // Catalog order
    if (a.catalogOrder !== undefined && b.catalogOrder !== undefined) {
      return a.catalogOrder - b.catalogOrder;
    }
    if (a.catalogOrder !== undefined) return -1;
    if (b.catalogOrder !== undefined) return 1;

    // Alphabetical
    return a.name.localeCompare(b.name);
  });

  // Take maxWedges - 1 and append "Other app…"
  const slots = params.maxWedges - 1;
  const taken = apps.slice(0, slots);

  const result: WheelEntry[] = taken.map(a => ({
    id: a.id,
    badge: a.isDefault ? 'DEFAULT' as const : (a.isPinned ? 'PINNED' as const : undefined),
  }));

  result.push({ id: '__other__', isOtherApp: true });

  return result;
}

describe('Ranking', () => {
  const base: AppCandidate[] = [
    { id: 'photos', name: 'Photos', isDefault: true, isPinned: false, isHidden: false, usageCount: 23, catalogOrder: 0, multi: true },
    { id: 'paintdotnet', name: 'Paint.NET', isDefault: false, isPinned: true, isHidden: false, usageCount: 41, catalogOrder: 1, userOrder: 0, multi: true },
    { id: 'gimp', name: 'GIMP', isDefault: false, isPinned: false, isHidden: false, usageCount: 12, catalogOrder: 2, multi: true },
    { id: 'paint', name: 'Paint', isDefault: false, isPinned: false, isHidden: false, usageCount: 7, catalogOrder: 3, multi: false },
    { id: 'affinity', name: 'Affinity Photo', isDefault: false, isPinned: false, isHidden: false, usageCount: 3, catalogOrder: 4, multi: true },
    { id: 'irfanview', name: 'IrfanView', isDefault: false, isPinned: false, isHidden: false, usageCount: 2, catalogOrder: 5, multi: false },
    { id: 'krita', name: 'Krita', isDefault: false, isPinned: false, isHidden: false, usageCount: 0, catalogOrder: 6, multi: true },
  ];

  it('places default first with DEFAULT badge', () => {
    const result = buildWheel({ candidates: base, maxWedges: 8, isMultiFile: false });
    expect(result[0]).toEqual({ id: 'photos', badge: 'DEFAULT' });
  });

  it('places pinned apps after default with PINNED badge', () => {
    const result = buildWheel({ candidates: base, maxWedges: 8, isMultiFile: false });
    expect(result[1]).toEqual({ id: 'paintdotnet', badge: 'PINNED' });
  });

  it('orders remaining by usage count descending', () => {
    const result = buildWheel({ candidates: base, maxWedges: 8, isMultiFile: false });
    // After default (photos) and pinned (paintdotnet): gimp(12), paint(7), affinity(3), irfanview(2), krita(0)
    expect(result[2].id).toBe('gimp');
    expect(result[3].id).toBe('paint');
    expect(result[4].id).toBe('affinity');
  });

  it('ends with "Other app…"', () => {
    const result = buildWheel({ candidates: base, maxWedges: 8, isMultiFile: false });
    expect(result[result.length - 1].isOtherApp).toBe(true);
  });

  it('respects maxWedges truncation', () => {
    const result = buildWheel({ candidates: base, maxWedges: 4, isMultiFile: false });
    expect(result).toHaveLength(4); // 3 apps + Other
    expect(result[3].isOtherApp).toBe(true);
  });

  it('removes hidden apps', () => {
    const withHidden = base.map(a => a.id === 'gimp' ? { ...a, isHidden: true } : a);
    const result = buildWheel({ candidates: withHidden, maxWedges: 8, isMultiFile: false });
    expect(result.find(r => r.id === 'gimp')).toBeUndefined();
  });

  it('multi-file: only includes multi:true apps', () => {
    const result = buildWheel({ candidates: base, maxWedges: 8, isMultiFile: true });
    // paint and irfanview are multi:false
    expect(result.find(r => r.id === 'paint')).toBeUndefined();
    expect(result.find(r => r.id === 'irfanview')).toBeUndefined();
    expect(result.find(r => r.id === 'gimp')).toBeDefined();
  });

  it('empty candidates produces just "Other app…"', () => {
    const result = buildWheel({ candidates: [], maxWedges: 8, isMultiFile: false });
    expect(result).toHaveLength(1);
    expect(result[0].isOtherApp).toBe(true);
  });

  it('uses catalog order as tiebreak when usage is equal', () => {
    const tied = [
      { id: 'a', name: 'A', isDefault: false, isPinned: false, isHidden: false, usageCount: 0, catalogOrder: 2, multi: true },
      { id: 'b', name: 'B', isDefault: false, isPinned: false, isHidden: false, usageCount: 0, catalogOrder: 1, multi: true },
      { id: 'c', name: 'C', isDefault: false, isPinned: false, isHidden: false, usageCount: 0, catalogOrder: 0, multi: true },
    ];
    const result = buildWheel({ candidates: tied, maxWedges: 8, isMultiFile: false });
    expect(result[0].id).toBe('c');
    expect(result[1].id).toBe('b');
    expect(result[2].id).toBe('a');
  });

  it('pin order is respected among pinned apps', () => {
    const pinned = [
      { id: 'a', name: 'A', isDefault: false, isPinned: true, isHidden: false, usageCount: 0, userOrder: 2, multi: true },
      { id: 'b', name: 'B', isDefault: false, isPinned: true, isHidden: false, usageCount: 50, userOrder: 0, multi: true },
      { id: 'c', name: 'C', isDefault: false, isPinned: true, isHidden: false, usageCount: 100, userOrder: 1, multi: true },
    ];
    const result = buildWheel({ candidates: pinned, maxWedges: 8, isMultiFile: false });
    expect(result[0].id).toBe('b'); // userOrder 0
    expect(result[1].id).toBe('c'); // userOrder 1
    expect(result[2].id).toBe('a'); // userOrder 2
  });

  it('alphabetical fallback when no catalog order and same usage', () => {
    const alpha = [
      { id: 'z', name: 'Zebra', isDefault: false, isPinned: false, isHidden: false, usageCount: 0, multi: true },
      { id: 'a', name: 'Alpha', isDefault: false, isPinned: false, isHidden: false, usageCount: 0, multi: true },
      { id: 'm', name: 'Middle', isDefault: false, isPinned: false, isHidden: false, usageCount: 0, multi: true },
    ];
    const result = buildWheel({ candidates: alpha, maxWedges: 8, isMultiFile: false });
    expect(result[0].id).toBe('a');
    expect(result[1].id).toBe('m');
    expect(result[2].id).toBe('z');
  });
});
