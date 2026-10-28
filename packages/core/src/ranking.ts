/**
 * App ranking logic: builds the ordered list of wedges for the Orbit wheel.
 */

export interface AppCandidate {
  id: string;
  isDefault: boolean;
  isPinned: boolean;
  isHidden: boolean;
  userOrder?: number;
  usageCount: number;
  catalogOrder?: number;
  /** True if the app supports multi-file open. */
  multi: boolean;
}

export interface RankingResult {
  id: string;
  badge?: 'DEFAULT' | 'PINNED';
}

export interface BuildWheelParams {
  candidates: AppCandidate[];
  maxWedges: number;
  isMultiFile: boolean;
  extensions: string[];
}

/**
 * Build the ordered wedge list for the wheel.
 *
 * Ranking order:
 *   1. OS default app (badge DEFAULT)
 *   2. Pinned apps in user-defined order (badge PINNED)
 *   3. Remaining by usage count (desc), then catalog order (asc), then id (alpha)
 *
 * The last slot is reserved for "Other app..." so we take maxWedges - 1 real apps.
 *
 * Multi-file mode: only apps with `multi: true` are eligible.
 * Hidden apps are always excluded.
 * Unknown extension (no candidates): returns empty (caller adds special wedges).
 */
export function buildWheel(params: BuildWheelParams): RankingResult[] {
  const { candidates, maxWedges, isMultiFile } = params;

  // Filter hidden
  let pool = candidates.filter((c) => !c.isHidden);

  // Multi-file: only multi-capable apps
  if (isMultiFile) {
    pool = pool.filter((c) => c.multi);
  }

  if (pool.length === 0) {
    return [];
  }

  // Separate into tiers
  const defaults: AppCandidate[] = [];
  const pinned: AppCandidate[] = [];
  const rest: AppCandidate[] = [];

  for (const c of pool) {
    if (c.isDefault) {
      defaults.push(c);
    } else if (c.isPinned) {
      pinned.push(c);
    } else {
      rest.push(c);
    }
  }

  // Sort pinned by userOrder
  pinned.sort((a, b) => (a.userOrder ?? Infinity) - (b.userOrder ?? Infinity));

  // Sort rest by usage desc, catalog order asc, then id alpha
  rest.sort((a, b) => {
    if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount;
    const catA = a.catalogOrder ?? Infinity;
    const catB = b.catalogOrder ?? Infinity;
    if (catA !== catB) return catA - catB;
    return a.id.localeCompare(b.id);
  });

  // Assemble ranked list with badges
  const ranked: RankingResult[] = [
    ...defaults.map((c) => ({ id: c.id, badge: 'DEFAULT' as const })),
    ...pinned.map((c) => ({ id: c.id, badge: 'PINNED' as const })),
    ...rest.map((c) => ({ id: c.id })),
  ];

  // Reserve one slot for "Other app..."
  const realSlots = Math.max(maxWedges - 1, 0);
  const taken = ranked.slice(0, realSlots);

  // Append sentinel "Other app..."
  taken.push({ id: '__other__' });

  return taken;
}
