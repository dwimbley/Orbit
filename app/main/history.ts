/**
 * Usage history tracking.
 *
 * Tracks how many times each app is opened per extension.
 * Never stores file names or paths -- only extension + appId counts.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { app } from 'electron';

// ── Schema ─────────────────────────────────────────────────────────

const UsageEntrySchema = z.object({
  /** Lowercase extension with dot, e.g. ".jpg" */
  ext: z.string(),
  /** App identifier */
  appId: z.string(),
  /** Number of opens */
  count: z.number().int().min(0),
});

const HistorySchema = z.object({
  recordingSince: z.string().datetime(),
  usage: z.array(UsageEntrySchema),
});

type History = z.infer<typeof HistorySchema>;

// ── File path ──────────────────────────────────────────────────────

function historyFilePath(): string {
  const dir = app?.getPath?.('userData')
    ?? path.join(process.env.APPDATA ?? '', 'Orbit');
  return path.join(dir, 'history.json');
}

// ── State ──────────────────────────────────────────────────────────

let _history: History | null = null;

function ensureLoaded(): History {
  if (_history) return _history;

  const filePath = historyFilePath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      _history = HistorySchema.parse(raw);
      return _history;
    }
  } catch (err) {
    console.error('[history] Failed to load history, starting fresh:', err);
  }

  _history = {
    recordingSince: new Date().toISOString(),
    usage: [],
  };
  return _history;
}

function persist(): void {
  const filePath = historyFilePath();
  const dir = path.dirname(filePath);
  const tmpPath = filePath + '.tmp';

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(_history, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error('[history] Failed to save history:', err);
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Record one usage event: the user opened extension `ext` with app `appId`.
 */
export function recordUsage(ext: string, appId: string): void {
  const h = ensureLoaded();
  const entry = h.usage.find((e) => e.ext === ext && e.appId === appId);
  if (entry) {
    entry.count += 1;
  } else {
    h.usage.push({ ext, appId, count: 1 });
  }
  persist();
}

/**
 * Get usage count for a specific extension + app, or all usage data.
 */
export function getStats(): { recordingSince: string; usage: Array<{ ext: string; appId: string; count: number }> } {
  const h = ensureLoaded();
  return {
    recordingSince: h.recordingSince,
    usage: h.usage.map((e) => ({ ...e })),
  };
}

/**
 * Get usage count for a specific app+extension pair.
 */
export function getUsageCount(ext: string, appId: string): number {
  const h = ensureLoaded();
  return h.usage.find((e) => e.ext === ext && e.appId === appId)?.count ?? 0;
}

/**
 * Reset history: clears all usage counts, resets recording date.
 * Does NOT clear pins, hidden, or custom app settings (those live in prefs).
 */
export function resetHistory(): void {
  _history = {
    recordingSince: new Date().toISOString(),
    usage: [],
  };
  persist();
}
