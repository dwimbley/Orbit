/**
 * Catalog loader.
 *
 * Loads apps.json and extensions.json from the catalog/ directory,
 * validates them with zod, resolves detection rules against the
 * native addon, and caches results.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  AppsCatalogSchema,
  ExtensionsMapSchema,
  validateCatalogIntegrity,
  type AppsCatalog,
  type ExtensionsMap,
  type App,
} from '../../catalog/schema';
import type { PlatformAdapter, DiscoveredApp } from '../../platform/interfaces';

// ── State ──────────────────────────────────────────────────────────

let _apps: AppsCatalog | null = null;
let _extensions: ExtensionsMap | null = null;

/** Cache of catalog apps resolved against the system (id -> DiscoveredApp). */
let _resolvedApps: Map<string, DiscoveredApp> | null = null;

// ── File paths ─────────────────────────────────────────────────────

function catalogDir(): string {
  // __dirname at runtime is dist/app/main/ — project root is 3 levels up
  return path.join(__dirname, '..', '..', '..', 'catalog');
}

// ── Loading ────────────────────────────────────────────────────────

function loadAppsJson(): AppsCatalog {
  const filePath = path.join(catalogDir(), 'apps.json');
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return AppsCatalogSchema.parse(raw);
}

function loadExtensionsJson(): ExtensionsMap {
  const filePath = path.join(catalogDir(), 'extensions.json');
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return ExtensionsMapSchema.parse(raw);
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Load and validate the catalog from disk. Caches results.
 * Call refresh() to invalidate the cache.
 */
export function loadCatalog(): { apps: AppsCatalog; extensions: ExtensionsMap } {
  if (_apps && _extensions) {
    return { apps: _apps, extensions: _extensions };
  }

  try {
    _apps = loadAppsJson();
    _extensions = loadExtensionsJson();

    // Cross-validate
    const errors = validateCatalogIntegrity(_apps, _extensions);
    if (errors.length > 0) {
      console.warn('[catalog] Integrity warnings:', errors);
    }
  } catch (err) {
    console.error('[catalog] Failed to load catalog:', err);
    _apps = [];
    _extensions = {};
  }

  return { apps: _apps, extensions: _extensions };
}

/**
 * Get catalog app entries for a given extension.
 * Returns app definitions in their catalog-defined order.
 */
export function getCatalogAppsForExtension(ext: string): App[] {
  const { apps, extensions } = loadCatalog();
  const appIds = extensions[ext.toLowerCase()] ?? [];

  const appMap = new Map(apps.map((a) => [a.id, a]));
  const result: App[] = [];

  for (const id of appIds) {
    const app = appMap.get(id);
    if (app) {
      result.push(app);
    }
  }

  return result;
}

/**
 * Resolve catalog detection rules against the system.
 * Uses native addon if available, falls back to JS-level path checks.
 */
export async function resolveInstalledCatalogApps(
  platform: PlatformAdapter,
): Promise<Map<string, DiscoveredApp>> {
  if (_resolvedApps) {
    return _resolvedApps;
  }

  // Try native detection first
  try {
    const native = await platform.appDiscovery.detectCatalogApps();
    if (native.size > 0) {
      _resolvedApps = native;
      return _resolvedApps;
    }
  } catch {}

  // Fallback: JS-level detection using known paths
  console.log('[catalog] Using JS fallback for app detection...');
  _resolvedApps = new Map();
  const { apps } = loadCatalog();

  for (const app of apps) {
    const resolved = detectAppJS(app);
    if (resolved) {
      _resolvedApps.set(app.id, resolved);
    }
  }

  console.log(`[catalog] Detected ${_resolvedApps.size} installed apps`);
  return _resolvedApps;
}

/**
 * Detect an app using JS-level filesystem checks (no native addon needed).
 */
function detectAppJS(app: App): DiscoveredApp | null {
  const detection = app.detection;

  // Try known paths first (most reliable without native addon)
  if (detection.knownPaths) {
    for (const pattern of detection.knownPaths) {
      const expanded = expandEnvVars(pattern);
      const resolved = resolveGlob(expanded);
      if (resolved) {
        return {
          id: app.id,
          name: app.name,
          exePath: resolved,
          packageFamilyName: detection.packageFamily ?? null,
          aumid: null,
          isDefault: false,
          isRecommended: true,
          iconPng: null,
          source: 'catalog',
          handlerId: null,
        };
      }
    }
  }

  // Try exe name in App Paths registry (via known common locations)
  if (detection.exe) {
    const commonDirs = [
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.LOCALAPPDATA,
      path.join(process.env.LOCALAPPDATA || '', 'Programs'),
      process.env.WINDIR,
    ].filter(Boolean) as string[];

    // Direct check for system executables
    if (detection.exe.includes('\\') || detection.exe.includes('/')) {
      const expanded = expandEnvVars(detection.exe);
      if (fs.existsSync(expanded)) {
        return {
          id: app.id, name: app.name, exePath: expanded,
          packageFamilyName: null, aumid: null, isDefault: false,
          isRecommended: true, iconPng: null, source: 'catalog', handlerId: null,
        };
      }
    }
  }

  return null;
}

function expandEnvVars(p: string): string {
  return p.replace(/%([^%]+)%/g, (_match, varName) => {
    return process.env[varName] || `%${varName}%`;
  });
}

function resolveGlob(pattern: string): string | null {
  // Handle simple * wildcards in path segments
  const parts = pattern.split(/[/\\]/);
  return resolveGlobParts(parts, 0, '');
}

function resolveGlobParts(parts: string[], index: number, current: string): string | null {
  if (index >= parts.length) {
    return fs.existsSync(current) ? current : null;
  }

  const part = parts[index];
  const prefix = index === 0 ? part : path.join(current, part);

  if (!part.includes('*')) {
    // No wildcard — just check next level
    return resolveGlobParts(parts, index + 1, prefix);
  }

  // Wildcard — list the parent directory and match
  const parentDir = current || path.dirname(prefix);
  if (!fs.existsSync(parentDir)) return null;

  try {
    const regex = new RegExp('^' + part.replace(/\*/g, '.*') + '$', 'i');
    const entries = fs.readdirSync(parentDir);
    // Sort descending to prefer newest version
    entries.sort((a: string, b: string) => b.localeCompare(a));

    for (const entry of entries) {
      if (regex.test(entry)) {
        const result = resolveGlobParts(parts, index + 1, path.join(parentDir, entry));
        if (result) return result;
      }
    }
  } catch {}

  return null;
}

/**
 * Invalidate the cached catalog and resolved apps.
 * Called when settings are opened or after a launch failure.
 */
export function refreshCatalog(): void {
  _apps = null;
  _extensions = null;
  _resolvedApps = null;
}
