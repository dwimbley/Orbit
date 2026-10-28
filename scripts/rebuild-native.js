/**
 * Build the native addon by invoking CMake directly.
 *
 * cmake-js has issues detecting VS2026's C++ toolset, so we call cmake
 * directly with the right variables set for Node/Electron native addons.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ── Find CMake ──────────────────────────────────────────────────────

function findCMake() {
  try {
    execSync('cmake --version', { stdio: 'pipe' });
    return 'cmake';
  } catch {}

  const bases = ['C:/Program Files/Microsoft Visual Studio', 'C:/Program Files (x86)/Microsoft Visual Studio'];
  const editions = ['Community', 'Professional', 'Enterprise', 'BuildTools'];
  const suffix = 'Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe';

  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    for (const ver of fs.readdirSync(base).sort((a, b) => b.localeCompare(a))) {
      for (const ed of editions) {
        const p = path.join(base, ver, ed, suffix);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return null;
}

const cmake = findCMake();
if (!cmake) {
  console.error('CMake not found. Install CMake or Visual Studio with C++ CMake tools.');
  process.exit(1);
}

// ── Resolve Electron header paths for cmake-js compatibility ────────

const projectRoot = path.join(__dirname, '..');
const addonDir = path.join(projectRoot, 'native', 'filewheel-native');
const buildDir = path.join(addonDir, 'build');
const electronVersion = require(path.join(projectRoot, 'node_modules', 'electron', 'package.json')).version;

// cmake-js caches Electron headers in ~/.cmake-js/
const cacheDir = path.join(require('os').homedir(), '.cmake-js', `electron-x64`, `v${electronVersion}`);
const nodeLib = path.join(cacheDir, 'x64', 'node.lib');
const includeDir = path.join(cacheDir, 'include', 'node');

// If headers aren't cached yet, let cmake-js download them
if (!fs.existsSync(nodeLib)) {
  console.log(`[rebuild-native] Downloading Electron ${electronVersion} headers...`);
  const cmakeJsBin = path.join(projectRoot, 'node_modules', '.bin', 'cmake-js');
  // Add cmake to PATH for this call
  const env = { ...process.env, PATH: path.dirname(cmake) + path.delimiter + process.env.PATH };
  try {
    execSync(`"${cmakeJsBin}" install -r electron -v ${electronVersion}`, {
      cwd: projectRoot, stdio: 'inherit', env, shell: true
    });
  } catch {
    console.error('[rebuild-native] Failed to download Electron headers. Trying direct cmake build...');
  }
}

// ── Configure and Build ─────────────────────────────────────────────

fs.mkdirSync(buildDir, { recursive: true });

const defines = [
  `-DCMAKE_JS_VERSION=8.0.0`,
  `-DCMAKE_BUILD_TYPE=Release`,
];

// Add Electron include/lib if available
if (fs.existsSync(includeDir)) {
  defines.push(`-DCMAKE_JS_INC="${includeDir}"`);
}
if (fs.existsSync(nodeLib)) {
  defines.push(`-DCMAKE_JS_LIB="${nodeLib}"`);
}

const configCmd = `"${cmake}" -S "${addonDir}" -B "${buildDir}" ${defines.join(' ')} -DCMAKE_SHARED_LINKER_FLAGS=/DELAYLOAD:NODE.EXE`;
const buildCmd = `"${cmake}" --build "${buildDir}" --config Release`;

console.log(`[rebuild-native] CMake: ${cmake}`);
console.log(`[rebuild-native] Electron: ${electronVersion}`);
console.log(`[rebuild-native] Configuring...`);

try {
  execSync(configCmd, { cwd: projectRoot, stdio: 'inherit' });
} catch (e) {
  console.error('[rebuild-native] CMake configure failed');
  process.exit(1);
}

console.log(`[rebuild-native] Building...`);

try {
  execSync(buildCmd, { cwd: projectRoot, stdio: 'inherit' });
} catch (e) {
  console.error('[rebuild-native] CMake build failed');
  process.exit(1);
}

const nodeFile = path.join(buildDir, 'Release', 'filewheel-native.node');
if (fs.existsSync(nodeFile)) {
  const size = (fs.statSync(nodeFile).size / 1024).toFixed(0);
  console.log(`[rebuild-native] Success: ${nodeFile} (${size} KB)`);
} else {
  console.error('[rebuild-native] Build completed but .node file not found');
  process.exit(1);
}
