/**
 * Compile renderer TypeScript files to JavaScript in-place.
 *
 * Each renderer .ts file is a standalone script (not a module) loaded
 * by its corresponding HTML file. We compile them individually with
 * minimal settings — no strict mode, no module system, just TS → JS.
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const rendererDir = path.join(__dirname, '..', 'app', 'renderer');

const tsFiles = [
  'overlay/overlay.ts',
  'settings/settings.ts',
  'tray-menu/tray-menu.ts',
  'toast/toast.ts',
  'confirm/confirm.ts',
];

for (const file of tsFiles) {
  const fullPath = path.join(rendererDir, file);
  if (!fs.existsSync(fullPath)) {
    console.warn(`[build-renderer] Skipping ${file} — not found`);
    continue;
  }

  const jsPath = fullPath.replace(/\.ts$/, '.js');
  console.log(`[build-renderer] ${file}`);

  try {
    execSync(
      `npx tsc --target ES2022 --lib ES2022,DOM,DOM.Iterable --module ES2022 --strict false --skipLibCheck --outDir "${path.dirname(fullPath)}" --declaration false --isolatedModules --noResolve "${fullPath}"`,
      { cwd: path.join(__dirname, '..'), stdio: 'pipe' }
    );
  } catch (e) {
    // tsc may warn but still produce output — check if JS was created
    if (!fs.existsSync(jsPath)) {
      console.error(`[build-renderer] Failed to compile ${file}:`, e.stderr?.toString() || e.message);
    }
  }
}

console.log('[build-renderer] Done');
