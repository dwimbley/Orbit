import { z } from 'zod';

// ── Detection schema ────────────────────────────────────────────────

export const DetectionSchema = z.object({
  /** MSIX / Store package family name. */
  packageFamily: z.string().optional(),
  /** Executable name for App Paths lookup (e.g. "chrome.exe"). May contain wildcards. */
  exe: z.string().optional(),
  /** Regex applied to Uninstall DisplayName. */
  uninstallRegex: z.string().optional(),
  /** Glob patterns expanded against known install directories. */
  knownPaths: z.array(z.string()).optional(),
  /** Special detection command (e.g. "vswhere"). */
  special: z.string().optional(),
}).refine(
  (d) =>
    d.packageFamily !== undefined ||
    d.exe !== undefined ||
    d.uninstallRegex !== undefined ||
    d.knownPaths !== undefined ||
    d.special !== undefined,
  { message: 'At least one detection method must be specified' },
);

export type Detection = z.infer<typeof DetectionSchema>;

// ── App entry schema ────────────────────────────────────────────────

export const AppSchema = z.object({
  /** Unique identifier (e.g. "photos", "gimp", "vscode"). */
  id: z.string().regex(/^[a-z][a-z0-9_]*$/, 'id must be lowercase alphanumeric with underscores'),
  /** Display name shown on the wheel. */
  name: z.string().min(1),
  /** How to detect whether this app is installed. */
  detection: DetectionSchema,
  /** Argument template: "{files}", "{file}", "{folder}", or custom like "-d {folder}". */
  args: z.string().min(1),
  /** Whether this app can handle multi-file drops. */
  multi: z.boolean(),
  /** Regex patterns for exe filenames to exclude (e.g. console/debug variants). */
  excludeExePatterns: z.array(z.string()).optional(),
});

export type App = z.infer<typeof AppSchema>;

// ── Apps catalog schema (the full apps.json) ────────────────────────

export const AppsCatalogSchema = z
  .array(AppSchema)
  .min(1)
  .refine(
    (apps) => {
      const ids = apps.map((a) => a.id);
      return new Set(ids).size === ids.length;
    },
    { message: 'App ids must be unique' },
  );

export type AppsCatalog = z.infer<typeof AppsCatalogSchema>;

// ── Extensions map schema (extensions.json) ─────────────────────────

/**
 * Keys are lowercase extensions with a leading dot (e.g. ".jpg"),
 * or the special key "_folder".
 * Values are ordered arrays of app ids.
 */
export const ExtensionKeySchema = z
  .string()
  .regex(/^(\.[a-z0-9]+|_folder)$/, 'Key must be a dotted lowercase extension or "_folder"');

export const ExtensionsMapSchema = z
  .record(z.string(), z.array(z.string().min(1)))
  .refine(
    (map) => Object.keys(map).every((k) => ExtensionKeySchema.safeParse(k).success),
    { message: 'All keys must be valid extension keys' },
  );

export type ExtensionsMap = z.infer<typeof ExtensionsMapSchema>;

// ── Cross-file validation ───────────────────────────────────────────

/**
 * Validate that every app id referenced in the extensions map
 * exists in the apps catalog.
 */
export function validateCatalogIntegrity(
  apps: AppsCatalog,
  extensions: ExtensionsMap,
): string[] {
  const appIds = new Set(apps.map((a) => a.id));
  const errors: string[] = [];

  for (const [ext, ids] of Object.entries(extensions)) {
    for (const id of ids) {
      if (!appIds.has(id)) {
        errors.push(`Extension "${ext}" references unknown app id "${id}"`);
      }
    }
  }

  return errors;
}
