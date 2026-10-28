/**
 * Generates README screenshots of Orbit UI components using Playwright.
 * Run: npx playwright test scripts/take-screenshots.js  (or just: node scripts/take-screenshots.js)
 *
 * Produces PNGs in docs/screenshots/
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.join(__dirname, '..', 'docs', 'screenshots');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ── Shared CSS tokens (inlined so we don't need file:// quirks) ──
const TOKENS_CSS = fs.readFileSync(
  path.join(__dirname, '..', 'app', 'renderer', 'shared', 'tokens.css'),
  'utf-8',
);
const OVERLAY_CSS = fs.readFileSync(
  path.join(__dirname, '..', 'app', 'renderer', 'overlay', 'overlay.css'),
  'utf-8',
);
const SETTINGS_CSS = fs.readFileSync(
  path.join(__dirname, '..', 'app', 'renderer', 'settings', 'settings.css'),
  'utf-8',
);
const TRAY_CSS = fs.readFileSync(
  path.join(__dirname, '..', 'app', 'renderer', 'tray-menu', 'tray-menu.css'),
  'utf-8',
);
const TOAST_CSS = fs.readFileSync(
  path.join(__dirname, '..', 'app', 'renderer', 'toast', 'toast.css'),
  'utf-8',
);

// ── Wheel mockup (self-contained HTML) ──

function buildWheelHTML() {
  const MONO_COLORS = ['#2F6FE4', '#0E8C8A', '#6E5A45', '#C8532A', '#B23A64', '#4560C9', '#6A4BB8', '#3A3D46'];

  const wedges = [
    { name: 'VS Code', monogram: 'VS', color: '#2F6FE4', ink: '#fff' },
    { name: 'Notepad++', monogram: 'N+', color: '#0E8C8A', ink: '#fff' },
    { name: 'Sublime Text', monogram: 'ST', color: '#C8532A', ink: '#fff' },
    { name: 'Vim', monogram: 'Vi', color: '#6A4BB8', ink: '#fff' },
    { name: 'WordPad', monogram: 'WP', color: '#B23A64', ink: '#fff' },
    { name: 'More apps…', monogram: '', color: '', ink: '', isSpecial: true, specialKind: 'choose' },
  ];

  const R = 175, r = Math.round(R * 0.38), GAP_PX = 5;
  const PAD = 80; // extra padding around the wheel for labels
  const S = (R + 22) * 2;
  const W = S + PAD * 2; // expanded canvas
  const c = W / 2; // center in expanded canvas
  const n = wedges.length;
  const hoveredIdx = 0; // VS Code hovered

  function wedgePath(i, hovered) {
    const step = (2 * Math.PI) / n;
    const Ro = hovered ? R + 9 : R;
    const midAngle = -Math.PI / 2 + i * step;
    const spanO = step - GAP_PX / Ro;
    const spanI = step - GAP_PX / r;
    const f = v => Math.round(v * 100) / 100;
    const pt = (rad, a) => `${f(c + rad * Math.cos(a))} ${f(c + rad * Math.sin(a))}`;
    return `M${pt(Ro, midAngle - spanO / 2)} A${Ro} ${Ro} 0 ${spanO > Math.PI ? 1 : 0} 1 ${pt(Ro, midAngle + spanO / 2)} L${pt(r, midAngle + spanI / 2)} A${r} ${r} 0 ${spanI > Math.PI ? 1 : 0} 0 ${pt(r, midAngle - spanI / 2)} Z`;
  }

  let pathsSVG = '';
  let labelsHTML = '';
  for (let i = 0; i < n; i++) {
    const w = wedges[i];
    const hovered = i === hoveredIdx;
    const step = (2 * Math.PI) / n;
    const midAngle = -Math.PI / 2 + i * step;
    const Ro = hovered ? R + 9 : R;
    const lr = (Ro + r) / 2;
    const labelMaxW = Math.min(96, Math.floor(step * ((R + r) / 2) * 0.9));

    const fill = hovered ? '#7C3AED' : (w.isSpecial ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.055)');
    const stroke = hovered ? '#A78BFA' : 'rgba(255,255,255,0.08)';
    pathsSVG += `<path d="${wedgePath(i, hovered)}" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`;

    const lx = Math.round((c + lr * Math.cos(midAngle)) * 100) / 100;
    const ly = Math.round((c + lr * Math.sin(midAngle)) * 100) / 100;

    let iconHTML;
    if (w.isSpecial) {
      iconHTML = `<div class="fw-wedge-icon-special${hovered ? ' hovered' : ''}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="#DAD7E3"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg>
      </div>`;
    } else {
      iconHTML = `<div class="fw-wedge-icon" style="background:${w.color};color:${w.ink}">${w.monogram}</div>`;
    }

    labelsHTML += `<div class="fw-wedge-label" style="left:${lx - labelMaxW / 2}px;top:${ly - 31}px;width:${labelMaxW}px;transform:scale(${hovered ? 1.06 : 1})">
      ${iconHTML}
      <div class="fw-wedge-name${hovered ? ' hovered' : ''}" style="max-width:${labelMaxW}px">${w.name}</div>
    </div>`;
  }

  const discR = R + 12;
  const cd = 2 * r - 10;
  const tw = cd - 26;
  const totalW = W;
  const totalH = W + 60; // room for hint pill

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<style>${TOKENS_CSS}\n${OVERLAY_CSS}
html,body{margin:0;padding:0;background:#0D0D12;width:${totalW}px;height:${totalH}px;display:flex;align-items:center;justify-content:center;overflow:hidden;}
.fw-wheel-root{display:flex !important;position:relative;flex-direction:column;align-items:center;justify-content:center;}
</style></head><body>
<div class="fw-wheel-root">
  <div class="fw-wheel-container" style="width:${W}px;height:${W}px;position:relative;">
    <div class="fw-disc" style="left:${c - discR}px;top:${c - discR}px;width:${discR * 2}px;height:${discR * 2}px;"></div>
    <svg class="fw-wedges-svg" width="${W}" height="${W}" style="position:absolute;left:0;top:0;overflow:visible;">${pathsSVG}</svg>
    <div class="fw-wedge-labels" style="position:absolute;left:0;top:0;width:${W}px;height:${W}px;pointer-events:none;">${labelsHTML}</div>
    <div class="fw-center" style="left:${c - cd / 2}px;top:${c - cd / 2}px;width:${cd}px;height:${cd}px;">
      <div class="fw-center-open">
        <div class="fw-center-verb">Open with</div>
        <div class="fw-center-appname" style="max-width:${tw}px">VS Code</div>
        <div class="fw-center-filename-small" style="max-width:${tw}px">report.pdf</div>
      </div>
    </div>
  </div>
  <div class="fw-hint-pill" style="margin-top:14px;">
    <span class="fw-keycap">Esc</span> Dismiss
    <span class="fw-pill-sep">·</span>
    Drop on the center to cancel
  </div>
</div>
</body></html>`;
}

// ── Settings window mockup ──

function buildSettingsHTML() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<style>${TOKENS_CSS}\n${SETTINGS_CSS}
html,body{height:600px;width:840px;overflow:hidden;background:var(--fw-window-bg);}
body{border:1px solid var(--fw-window-border);display:flex;flex-direction:column;}
</style></head><body>
  <div class="fw-title-bar" style="-webkit-app-region:drag;">
    <div class="fw-title-bar-left">
      <svg class="fw-title-logo" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="7" stroke="#A78BFA" stroke-width="1.5" fill="none"/>
        <circle cx="8" cy="8" r="3" fill="#A78BFA"/>
      </svg>
      <span class="fw-title-text">Orbit Settings</span>
    </div>
    <div class="fw-title-bar-controls">
      <button class="fw-title-btn"><svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="5.5" width="10" height="1" fill="currentColor"/></svg></button>
      <button class="fw-title-btn fw-title-btn--close"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></button>
    </div>
  </div>
  <div class="fw-settings-body">
    <aside class="fw-sidebar">
      <div class="fw-sidebar-header">
        <div class="fw-sidebar-logo-tile">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="8" stroke="#A78BFA" stroke-width="1.5" fill="none"/>
            <circle cx="10" cy="10" r="3.5" fill="#A78BFA"/>
          </svg>
        </div>
        <div class="fw-sidebar-header-text">
          <span class="fw-sidebar-app-name">Orbit</span>
          <span class="fw-sidebar-version">v0.1.0</span>
        </div>
      </div>
      <div class="fw-status-box">
        <div class="fw-status-row">
          <span class="fw-status-dot fw-status-dot--active"></span>
          <span class="fw-status-label">Active</span>
        </div>
        <button class="fw-status-btn">Pause</button>
      </div>
      <nav class="fw-sidebar-nav">
        <button class="fw-nav-btn" aria-current="true">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2v5l3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>
          Activation
        </button>
        <button class="fw-nav-btn">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3" fill="none"/><circle cx="8" cy="8" r="2.5" fill="currentColor"/></svg>
          Wheel
        </button>
        <button class="fw-nav-btn">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>
          Applications
        </button>
        <button class="fw-nav-btn">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M3 8h7M3 12h5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
          History &amp; privacy
        </button>
      </nav>
      <button class="fw-try-wheel-btn">Try the wheel&hellip;</button>
    </aside>
    <main class="fw-content">
      <h2 class="fw-section-title">Activation</h2>
      <p class="fw-section-desc">Configure how Orbit activates when you drag a file.</p>

      <div class="fw-status-card fw-status-card--success">
        <span class="fw-status-card__dot"></span>
        <span class="fw-status-card__text">Orbit is active &mdash; monitoring 2 displays</span>
        <button class="fw-check-again-btn">Check again</button>
      </div>

      <h3 class="fw-subsection-title">Trigger mode</h3>
      <div class="fw-radio-group">
        <div class="fw-radio-card fw-radio-card--selected">
          <span class="fw-radio-card__title"><span class="fw-radio-card__dot"></span>Auto detect</span>
          <span class="fw-radio-card__desc">The wheel appears automatically after a short delay when you drag a file.</span>
        </div>
        <div class="fw-radio-card fw-radio-card--unselected">
          <span class="fw-radio-card__title"><span class="fw-radio-card__dot"></span>Modifier key</span>
          <span class="fw-radio-card__desc">Hold a modifier key while dragging a file to show the wheel.</span>
        </div>
      </div>

      <h3 class="fw-subsection-title">Drag delay</h3>
      <div class="fw-slider-row">
        <input class="fw-slider" type="range" min="100" max="1000" step="50" value="350">
        <span class="fw-slider-value">350 ms</span>
      </div>

      <div class="fw-setting-row">
        <span class="fw-setting-row__label">Launch at sign-in</span>
        <div class="fw-setting-row__right">
          <button class="fw-toggle fw-toggle--on" aria-pressed="true">
            <span class="fw-toggle__knob"></span>
          </button>
        </div>
      </div>
    </main>
  </div>
</body></html>`;
}

// ── Tray menu mockup ──

function buildTrayHTML() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<style>${TOKENS_CSS}\n${TRAY_CSS}
html,body{margin:0;padding:20px;background:transparent;overflow:hidden;}
</style></head><body>
  <div class="fw-tray-menu">
    <div class="fw-tray-header">
      <div class="fw-tray-brand">
        <span class="fw-tray-logo">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="8" stroke="#A78BFA" stroke-width="1.5" fill="none"/>
            <circle cx="10" cy="10" r="3.5" fill="#A78BFA"/>
          </svg>
        </span>
        <span class="fw-tray-title">Orbit</span>
      </div>
      <div class="fw-tray-status">
        <span class="fw-tray-dot"></span>
        <span class="fw-tray-status-text">Active</span>
      </div>
    </div>
    <div class="fw-tray-divider"></div>
    <div class="fw-tray-items">
      <div class="fw-tray-item">Try the wheel&hellip;</div>
      <div class="fw-tray-item fw-tray-item--has-sub">
        <span>Pause</span>
        <span class="fw-tray-chevron">&rsaquo;</span>
      </div>
      <div class="fw-tray-item">Settings&hellip;</div>
      <div class="fw-tray-divider"></div>
      <div class="fw-tray-item">Quit Orbit</div>
    </div>
  </div>
</body></html>`;
}

// ── Toast mockup ──

function buildToastHTML() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<style>${TOKENS_CSS}\n${TOAST_CSS}
html,body{margin:0;padding:20px;background:transparent;overflow:hidden;}
</style></head><body>
  <div class="fw-toast" style="display:flex;">
    <div class="fw-toast-icon-tile">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF9AAB" stroke-width="2.2" stroke-linecap="round">
        <circle cx="12" cy="12" r="9"/>
        <path d="M12 8v5M12 16.5v.01"/>
      </svg>
    </div>
    <div class="fw-toast-body">
      <div class="fw-toast-title">Couldn&rsquo;t open file</div>
      <div class="fw-toast-reason">Notepad++ was not found at the expected location.</div>
      <div class="fw-toast-path">C:\\Program Files\\Notepad++\\notepad++.exe</div>
      <div class="fw-toast-buttons">
        <button class="fw-toast-btn fw-toast-btn--secondary">Remove from wheel</button>
        <button class="fw-toast-btn fw-toast-btn--primary">Locate&hellip;</button>
      </div>
    </div>
    <button class="fw-toast-dismiss" aria-label="Dismiss">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A9A6B5" stroke-width="2.4" stroke-linecap="round">
        <path d="M6 6l12 12M18 6L6 18"/>
      </svg>
    </button>
  </div>
</body></html>`;
}

// ── Main ──

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1200, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });

  async function screenshot(name, html, clip) {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    // Small pause for fonts/rendering
    await page.waitForTimeout(300);
    const opts = {
      path: path.join(OUT_DIR, `${name}.png`),
      omitBackground: true,
    };
    if (clip) {
      opts.clip = clip;
    } else {
      opts.fullPage = true;
    }
    await page.screenshot(opts);
    await page.close();
    console.log(`  ✓ ${name}.png`);
  }

  console.log('Generating screenshots...\n');

  // 1. Radial wheel — tight viewport around the wheel
  {
    const R = 175, PAD = 80, S = (R + 22) * 2, W = S + PAD * 2;
    const page = await context.newPage();
    await page.setViewportSize({ width: W, height: W + 60 });
    await page.setContent(buildWheelHTML(), { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(OUT_DIR, 'wheel.png'),
      omitBackground: false,
    });
    await page.close();
    console.log('  ✓ wheel.png');
  }

  // 2. Settings window
  {
    const page = await context.newPage();
    await page.setViewportSize({ width: 840, height: 600 });
    await page.setContent(buildSettingsHTML(), { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(OUT_DIR, 'settings.png'),
      omitBackground: false,
    });
    await page.close();
    console.log('  ✓ settings.png');
  }

  // 3. Tray menu — element screenshot (tight crop)
  {
    const page = await context.newPage();
    await page.setViewportSize({ width: 400, height: 400 });
    await page.setContent(buildTrayHTML(), { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const el = await page.locator('.fw-tray-menu');
    await el.screenshot({
      path: path.join(OUT_DIR, 'tray-menu.png'),
      omitBackground: true,
    });
    await page.close();
    console.log('  ✓ tray-menu.png');
  }

  // 4. Toast notification — element screenshot (tight crop)
  {
    const page = await context.newPage();
    await page.setViewportSize({ width: 500, height: 300 });
    await page.setContent(buildToastHTML(), { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const el = await page.locator('.fw-toast');
    await el.screenshot({
      path: path.join(OUT_DIR, 'toast.png'),
      omitBackground: true,
    });
    await page.close();
    console.log('  ✓ toast.png');
  }

  await browser.close();
  console.log(`\nDone! Screenshots saved to docs/screenshots/`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
