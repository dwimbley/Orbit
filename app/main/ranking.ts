/**
 * Main-process ranking: ties together catalog, prefs, OS discovery,
 * and the core ranking algorithm to produce the final wheel model.
 */

import { buildWheel, makeWheelConfig } from '../../packages/core/src/index';
import type { AppCandidate, RankingResult } from '../../packages/core/src/ranking';
import type { WheelConfig } from '../../packages/core/src/types';
import type { PlatformAdapter, DiscoveredApp, DroppedItem } from '../../platform/interfaces';
import { getPrefs } from './prefs';
import { getUsageCount } from './history';
import { getCatalogAppsForExtension, resolveInstalledCatalogApps } from './catalog';
import type { WedgeModel } from './ipc';

// ── Types ──────────────────────────────────────────────────────────

export interface WheelModel {
  wedges: WedgeModel[];
  extensions: string[];
  fileCount: number;
  hintText: string;
  wheelConfig: WheelConfig;
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Normalize an exe path for deduplication: lowercase, forward slashes, resolve env vars.
 */
function normalizeExePath(p: string): string {
  return p.toLowerCase().replace(/\\/g, '/').trim();
}

/**
 * Deduplicate apps by normalized exe path or package family name.
 * Prefers OS-discovered apps over catalog-only entries.
 */
function deduplicateApps(apps: Map<string, MergedApp>): MergedApp[] {
  const seen = new Map<string, MergedApp>();

  for (const app of apps.values()) {
    const key = app.packageFamilyName
      ?? (app.exePath ? normalizeExePath(app.exePath) : app.id);

    if (!seen.has(key)) {
      seen.set(key, app);
    }
    // If duplicate, keep the first (OS-sourced entries are added first)
  }

  return Array.from(seen.values());
}

interface MergedApp {
  id: string;
  name: string;
  exePath: string | null;
  packageFamilyName: string | null;
  aumid: string | null;
  isDefault: boolean;
  iconDataUrl?: string;
  source: 'os' | 'catalog' | 'user';
  multi: boolean;
  catalogOrder?: number;
  handlerId: string | null;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Build the complete wheel model for a set of dropped items.
 */
export async function buildWheelForFiles(
  items: DroppedItem[],
  platform: PlatformAdapter,
): Promise<WheelModel> {
  const prefs = getPrefs();
  const wheelConfig = makeWheelConfig(prefs.wheelSize);

  // Determine the file extensions involved
  const extensions = [...new Set(items.map((i) => i.extension.toLowerCase()))];
  const isMultiFile = items.length > 1;
  const primaryExt = extensions[0] ?? '';

  // Collect apps from all sources
  const mergedApps = new Map<string, MergedApp>();

  // 1. OS handlers for the primary extension
  try {
    const osHandlers = await platform.appDiscovery.getHandlersForExtension(primaryExt);
    const osDefault = await platform.appDiscovery.getDefaultHandler(primaryExt);

    for (const handler of osHandlers) {
      // Extract a friendly name from the handler — native returns exe path as name sometimes
      let friendlyName = handler.name || '';
      if (friendlyName.includes('\\') || friendlyName.includes('/')) {
        // It's a path — extract the exe name without extension
        const path = require('path');
        friendlyName = path.basename(friendlyName, path.extname(friendlyName));
        // Capitalize first letter
        friendlyName = friendlyName.charAt(0).toUpperCase() + friendlyName.slice(1);
      }

      mergedApps.set(handler.id, {
        id: handler.id,
        name: friendlyName,
        exePath: handler.exePath ?? (handler.id.includes('\\') ? handler.id : null),
        packageFamilyName: handler.packageFamilyName,
        aumid: handler.aumid,
        isDefault: osDefault?.id === handler.id,
        iconDataUrl: handler.iconPng
          ? `data:image/png;base64,${handler.iconPng.toString('base64')}`
          : undefined,
        source: 'os',
        multi: true,
        handlerId: handler.handlerId,
      });
    }
  } catch (err) {
    console.warn('[ranking] Failed to get OS handlers:', err);
  }

  // 2. Catalog apps for the extension
  const catalogApps = getCatalogAppsForExtension(primaryExt);
  const installedCatalog = await resolveInstalledCatalogApps(platform);

  for (let i = 0; i < catalogApps.length; i++) {
    const catApp = catalogApps[i];
    const resolved = installedCatalog.get(catApp.id);
    if (!resolved) continue; // Not installed

    // Check if an OS handler with the same exe path already exists — override it with catalog info
    const existingByPath = resolved.exePath
      ? [...mergedApps.entries()].find(([_, a]) => a.exePath && normalizeExePath(a.exePath) === normalizeExePath(resolved.exePath!))
      : undefined;
    if (existingByPath) {
      // Remove the path-keyed OS entry and replace with catalog entry
      mergedApps.delete(existingByPath[0]);
    }

    if (!mergedApps.has(catApp.id)) {
      mergedApps.set(catApp.id, {
        id: catApp.id,
        name: catApp.name,
        exePath: resolved.exePath,
        packageFamilyName: resolved.packageFamilyName,
        aumid: resolved.aumid,
        isDefault: resolved.isDefault,
        iconDataUrl: resolved.iconPng
          ? `data:image/png;base64,${resolved.iconPng.toString('base64')}`
          : undefined,
        source: 'catalog',
        multi: catApp.multi,
        catalogOrder: i,
        handlerId: resolved.handlerId,
      });
    }
  }

  // 3. User custom apps for this extension
  const extPrefs = prefs.extensions[primaryExt];
  if (extPrefs) {
    for (const custom of extPrefs.customApps) {
      if (!mergedApps.has(custom.id)) {
        mergedApps.set(custom.id, {
          id: custom.id,
          name: custom.name,
          exePath: custom.exePath,
          packageFamilyName: null,
          aumid: null,
          isDefault: false,
          source: 'user',
          multi: custom.multi,
          handlerId: null,
        });
      }
    }
  }

  // Deduplicate
  const uniqueApps = deduplicateApps(mergedApps);

  // Build AppCandidate list for the core ranking algorithm
  const candidates: AppCandidate[] = uniqueApps.map((app) => ({
    id: app.id,
    isDefault: app.isDefault,
    isPinned: extPrefs?.pinned.includes(app.id) ?? false,
    isHidden: extPrefs?.hidden.includes(app.id) ?? false,
    userOrder: extPrefs?.pinnedOrder.indexOf(app.id) ?? undefined,
    usageCount: getUsageCount(primaryExt, app.id),
    catalogOrder: app.catalogOrder,
    multi: app.multi,
  }));

  // Max wedges based on wheel size
  const maxWedges = wheelConfig.size === 'S' ? 6 : wheelConfig.size === 'M' ? 8 : 10;

  const ranked: RankingResult[] = buildWheel({
    candidates,
    maxWedges,
    isMultiFile,
    extensions,
  });

  // Build the wedge models for the renderer
  const appLookup = new Map(uniqueApps.map((a) => [a.id, a]));
  const wedges: WedgeModel[] = ranked.map((r) => {
    if (r.id === '__other__') {
      return { id: '__other__', name: 'Other app\u2026' };
    }
    const app = appLookup.get(r.id);
    return {
      id: r.id,
      name: app?.name ?? r.id,
      iconDataUrl: app?.iconDataUrl,
      badge: r.badge,
    };
  });

  // Hint text
  const fileCount = items.length;
  const hintText = fileCount === 1
    ? items[0].displayName
    : `${fileCount} files`;

  console.log(`[ranking] Built wheel: ${wedges.length} wedges, candidates: ${candidates.length}, merged: ${mergedApps.size}`);
  for (const a of uniqueApps) {
    console.log(`  [app] id=${a.id} name="${a.name}" exe=${a.exePath?.substring(0, 40)}`);
  }
  for (const w of wedges) {
    console.log(`  [wedge] ${w.id}: "${w.name}" ${w.badge || ''}`);
  }

  return {
    wedges,
    extensions,
    fileCount,
    hintText,
    wheelConfig,
  };
}
