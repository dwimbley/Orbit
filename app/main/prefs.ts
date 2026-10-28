/**
 * Preferences management.
 *
 * Reads / writes %APPDATA%\Orbit\settings.json with:
 *  - Zod validation
 *  - Atomic writes (temp file + rename)
 *  - Corrupt-file recovery (backup + defaults)
 *  - Schema-version migration
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { z } from 'zod';
import { app } from 'electron';

// ── Schema ─────────────────────────────────────────────────────────

const CURRENT_SCHEMA_VERSION = 1;

export const ActivationModeSchema = z.enum(['auto', 'modifier']);
export const ModifierKeySchema = z.enum(['Alt', 'Ctrl', 'Shift']);
export const WheelSizeSchema = z.enum(['S', 'M', 'L']);
export const ThemeSchema = z.enum(['system', 'light', 'dark']);

export const PerExtensionPrefsSchema = z.object({
  pinned: z.array(z.string()).default([]),
  hidden: z.array(z.string()).default([]),
  pinnedOrder: z.array(z.string()).default([]),
  customApps: z.array(z.object({
    id: z.string(),
    name: z.string(),
    exePath: z.string(),
    args: z.string().default('"{file}"'),
    multi: z.boolean().default(false),
    iconPath: z.string().optional(),
  })).default([]),
});

export type PerExtensionPrefs = z.infer<typeof PerExtensionPrefsSchema>;

export const PrefsSchema = z.object({
  schemaVersion: z.number().int().default(CURRENT_SCHEMA_VERSION),

  // Activation
  activationMode: ActivationModeSchema.default('auto'),
  activationDelay: z.number().int().min(0).max(2000).default(300),
  activationModifier: ModifierKeySchema.default('Alt'),

  // Appearance
  wheelSize: WheelSizeSchema.default('M'),
  theme: ThemeSchema.default('system'),
  showHintPill: z.boolean().default(true),
  animationsEnabled: z.boolean().default(true),

  // Behaviour
  paused: z.boolean().default(false),
  launchOnStartup: z.boolean().default(true),
  confirmDangerousOpen: z.boolean().default(true),
  showToastOnLaunch: z.boolean().default(false),

  // Per-extension overrides: key is lowercase extension with dot (e.g. ".jpg")
  extensions: z.record(z.string(), PerExtensionPrefsSchema).default({}),
});

export type Prefs = z.infer<typeof PrefsSchema>;

// ── Defaults ───────────────────────────────────────────────────────

function defaultPrefs(): Prefs {
  return PrefsSchema.parse({});
}

// ── File paths ─────────────────────────────────────────────────────

function prefsDir(): string {
  const appData = app?.getPath?.('userData')
    ?? path.join(os.homedir(), 'AppData', 'Roaming', 'Orbit');
  return appData;
}

function prefsFilePath(): string {
  return path.join(prefsDir(), 'settings.json');
}

function backupFilePath(): string {
  return path.join(prefsDir(), 'settings.backup.json');
}

// ── State ──────────────────────────────────────────────────────────

let _prefs: Prefs | null = null;

// ── Migration ──────────────────────────────────────────────────────

function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;

  // Future migrations go here:
  // if (version < 2) { ... transform ... raw.schemaVersion = 2; }

  if (version < CURRENT_SCHEMA_VERSION) {
    raw.schemaVersion = CURRENT_SCHEMA_VERSION;
  }

  return raw;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Load preferences from disk. Falls back to defaults on any error.
 */
export function loadPrefs(): Prefs {
  const filePath = prefsFilePath();

  try {
    if (fs.existsSync(filePath)) {
      const text = fs.readFileSync(filePath, 'utf-8');
      const raw = JSON.parse(text) as Record<string, unknown>;
      const migrated = migrate(raw);
      const parsed = PrefsSchema.parse(migrated);

      // If migration changed anything, persist immediately
      if (raw.schemaVersion !== migrated.schemaVersion) {
        savePrefsToFile(parsed);
      }

      _prefs = parsed;
      return _prefs;
    }
  } catch (err) {
    console.error('[prefs] Failed to load settings, recovering from backup:', err);

    // Attempt to preserve the corrupt file as a backup
    try {
      if (fs.existsSync(filePath)) {
        fs.copyFileSync(filePath, backupFilePath());
      }
    } catch {
      // Ignore backup errors
    }
  }

  // Fall back to defaults
  _prefs = defaultPrefs();
  savePrefsToFile(_prefs);
  return _prefs;
}

/**
 * Get current in-memory prefs. Loads from disk if not yet loaded.
 */
export function getPrefs(): Prefs {
  if (!_prefs) {
    return loadPrefs();
  }
  return _prefs;
}

/**
 * Merge partial updates into prefs and persist.
 */
export function updatePrefs(partial: Partial<Prefs>): Prefs {
  const current = getPrefs();
  const merged = { ...current, ...partial };
  const validated = PrefsSchema.parse(merged);
  _prefs = validated;
  savePrefsToFile(_prefs);
  return _prefs;
}

/**
 * Replace prefs entirely and persist.
 */
export function savePrefs(prefs: Prefs): void {
  const validated = PrefsSchema.parse(prefs);
  _prefs = validated;
  savePrefsToFile(_prefs);
}

// ── Atomic write ───────────────────────────────────────────────────

function savePrefsToFile(prefs: Prefs): void {
  const dir = prefsDir();
  const filePath = prefsFilePath();
  const tmpPath = filePath + '.tmp';

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(prefs, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error('[prefs] Failed to save settings:', err);
    // Clean up temp file if rename failed
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Ignore
    }
  }
}
