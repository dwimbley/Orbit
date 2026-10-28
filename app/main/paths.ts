/**
 * Resolve paths to renderer HTML and preload scripts.
 *
 * At runtime, __dirname is dist/app/main/.
 * Source renderer HTML/CSS live in app/renderer/ (not compiled to dist).
 * Preload scripts are compiled to dist/app/preload/.
 *
 * The project root is three levels up from dist/app/main.
 */
import * as path from 'node:path';

/** Project root (the directory containing package.json) */
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

/** Source renderer directory (HTML, CSS, static assets) */
export const RENDERER_DIR = path.join(PROJECT_ROOT, 'app', 'renderer');

/** Compiled preload directory */
export const PRELOAD_DIR = path.join(__dirname, '..', 'preload');

/** Get the path to a renderer HTML file */
export function rendererHtml(window: string): string {
  return path.join(RENDERER_DIR, window, 'index.html');
}

/** Get the path to a preload script */
export function preloadScript(name: string): string {
  return path.join(PRELOAD_DIR, `${name}.js`);
}

/** Get the path to the catalog directory */
export const CATALOG_DIR = path.join(PROJECT_ROOT, 'catalog');
