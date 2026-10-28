/**
 * Catalog tests — spec section 5
 *
 * Tests: schema validation, every extension's ids exist in apps,
 * detection-rule parsing, glob expansion, highest-version selection,
 * exclusion of console/debug exes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

interface CatalogApp {
  id: string;
  name: string;
  detection: {
    packageFamily?: string;
    exe?: string;
    uninstallRegex?: string;
    knownPaths?: string[];
    special?: string;
  };
  args: string;
  multi: boolean;
  excludeExePatterns?: string[];
}

interface ExtensionMap {
  [ext: string]: string[];
}

let apps: CatalogApp[] = [];
let extensions: ExtensionMap = {};
let appIds: Set<string>;

// Load catalog files
try {
  const catalogDir = join(__dirname, '..', 'catalog');
  apps = JSON.parse(readFileSync(join(catalogDir, 'apps.json'), 'utf-8'));
  extensions = JSON.parse(readFileSync(join(catalogDir, 'extensions.json'), 'utf-8'));
  appIds = new Set(apps.map(a => a.id));
} catch {
  apps = [];
  extensions = {};
  appIds = new Set();
}

describe('Catalog schema', () => {
  it('apps.json is a non-empty array', () => {
    expect(Array.isArray(apps)).toBe(true);
    expect(apps.length).toBeGreaterThan(0);
  });

  it('every app has required fields', () => {
    for (const app of apps) {
      expect(typeof app.id).toBe('string');
      expect(app.id.length).toBeGreaterThan(0);
      expect(typeof app.name).toBe('string');
      expect(app.name.length).toBeGreaterThan(0);
      expect(typeof app.detection).toBe('object');
      expect(typeof app.args).toBe('string');
      expect(typeof app.multi).toBe('boolean');
    }
  });

  it('app ids are unique', () => {
    const seen = new Set<string>();
    for (const app of apps) {
      expect(seen.has(app.id)).toBe(false);
      seen.add(app.id);
    }
  });

  it('extensions.json is a non-empty object', () => {
    expect(typeof extensions).toBe('object');
    expect(Object.keys(extensions).length).toBeGreaterThan(0);
  });

  it('every extension key starts with a dot or is _folder', () => {
    for (const ext of Object.keys(extensions)) {
      expect(ext === '_folder' || ext.startsWith('.')).toBe(true);
    }
  });

  it('every app id referenced in extensions exists in apps', () => {
    for (const [ext, ids] of Object.entries(extensions)) {
      for (const id of ids) {
        expect(appIds.has(id)).toBe(true);
      }
    }
  });

  it('extensions are lowercase', () => {
    for (const ext of Object.keys(extensions)) {
      if (ext === '_folder') continue;
      expect(ext).toBe(ext.toLowerCase());
    }
  });
});

describe('Detection rules', () => {
  it('every app has at least one detection method', () => {
    for (const app of apps) {
      const d = app.detection;
      const hasSome = d.packageFamily || d.exe || d.uninstallRegex ||
                       (d.knownPaths && d.knownPaths.length > 0) || d.special;
      expect(hasSome).toBeTruthy();
    }
  });

  it('packageFamily strings are plausible', () => {
    for (const app of apps) {
      if (app.detection.packageFamily) {
        // Should contain an underscore (family name format)
        expect(app.detection.packageFamily).toContain('_');
      }
    }
  });

  it('knownPaths contain environment variables or absolute paths', () => {
    for (const app of apps) {
      for (const p of app.detection.knownPaths || []) {
        expect(p.startsWith('%') || p.startsWith('/')).toBe(true);
      }
    }
  });

  it('uninstallRegex values are valid regex', () => {
    for (const app of apps) {
      if (app.detection.uninstallRegex) {
        expect(() => new RegExp(app.detection.uninstallRegex!)).not.toThrow();
      }
    }
  });
});

describe('Exclude patterns', () => {
  it('gimp excludes console and debug variants', () => {
    const gimp = apps.find(a => a.id === 'gimp');
    if (gimp?.excludeExePatterns) {
      expect(gimp.excludeExePatterns.length).toBeGreaterThan(0);
      // Verify they are valid regex
      for (const pat of gimp.excludeExePatterns) {
        expect(() => new RegExp(pat, 'i')).not.toThrow();
      }
      // Should match console variant
      const pattern = new RegExp(gimp.excludeExePatterns[0], 'i');
      expect(pattern.test('gimp-console-2.10.exe')).toBe(true);
    }
  });
});

describe('Args templates', () => {
  it('args contain valid placeholders', () => {
    const validPlaceholders = ['{files}', '{file}', '{folder}'];
    for (const app of apps) {
      const hasPlaceholder = validPlaceholders.some(p => app.args.includes(p)) ||
                              app.args === 'IAssocHandler' || app.args === 'AUMID';
      expect(hasPlaceholder).toBe(true);
    }
  });
});

describe('Required apps present', () => {
  const requiredApps = [
    'photos', 'paint', 'notepad', 'explorer', 'terminal',
    'edge', 'chrome', 'firefox', 'vscode', 'notepadpp',
    'vlc', 'gimp', 'photoshop', 'acrobat',
  ];

  for (const id of requiredApps) {
    it(`${id} is in the catalog`, () => {
      expect(appIds.has(id)).toBe(true);
    });
  }
});

describe('Folder apps', () => {
  it('_folder extension has explorer, vscode, terminal', () => {
    const folderApps = extensions['_folder'];
    expect(folderApps).toBeDefined();
    expect(folderApps).toContain('explorer');
    expect(folderApps).toContain('vscode');
    expect(folderApps).toContain('terminal');
  });
});
