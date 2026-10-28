/**
 * Settings window renderer — plain DOM, no framework.
 * All data flows through window.orbit (preload API).
 */

interface SettingsAPI {
  minimize(): void;
  close(): void;
  getSettings(): Promise<SettingsData>;
  updateSettings(partial: Partial<SettingsData>): Promise<void>;
  onSettingsChanged(callback: (settings: SettingsData) => void): void;
  getStatus(): Promise<StatusInfo>;
  checkAgain(): Promise<StatusInfo>;
  pause(until: 'hour' | 'tomorrow' | 'indefinite'): void;
  resume(): void;
  getExtensions(): Promise<ExtensionInfo[]>;
  getAppsForExtension(ext: string): Promise<AppRow[]>;
  getHiddenAppsForExtension(ext: string): Promise<AppRow[]>;
  pinApp(ext: string, appId: string, pinned: boolean): Promise<void>;
  hideApp(ext: string, appId: string): Promise<void>;
  showApp(ext: string, appId: string): Promise<void>;
  reorderApps(ext: string, appIds: string[]): Promise<void>;
  resetExtension(ext: string): Promise<void>;
  browseForExe(): Promise<{ path: string; name: string } | null>;
  addApplication(app: { exePath: string; name: string; extensions: string[] }): Promise<void>;
  getHistoryStats(): Promise<HistoryStats>;
  resetHistory(): Promise<void>;
  onHistoryReset(callback: () => void): void;
  tryTheWheel(): void;
  openSettingsFolder(): void;
  getVersion(): Promise<string>;
  getMonitorCount(): Promise<number>;
  getPreviewWheelData(size: 'S' | 'M' | 'L', maxWedges: number): Promise<PreviewWheelData>;
}

interface SettingsData {
  activation: {
    mode: 'auto' | 'modifier';
    delayMs: number;
    modifier: 'Alt' | 'Ctrl' | 'Shift';
  };
  wheel: {
    size: 'S' | 'M' | 'L';
    maxWedges: number;
    motion: 'system' | 'reduce';
  };
  launchAtLogin: boolean;
  paused: { until: string | null };
}

interface AppRow {
  id: string;
  name: string;
  iconDataUrl: string | null;
  monogram: string;
  monogramColor: string;
  monogramInk: string;
  exePath: string | null;
  packageDisplay: string | null;
  tags: Array<{ label: string; type: 'pinned' | 'default' | 'association' | 'compatible' | 'user' }>;
  usageCount: number;
  isPinned: boolean;
  isDefault: boolean;
  isHideable: boolean;
}

interface ExtensionInfo {
  ext: string;
  friendlyType: string;
  mime: string | null;
  appCount: number;
}

interface HistoryStats {
  opensRecorded: number;
  fileTypes: number;
  recordingSince: string;
}

interface StatusInfo {
  working: boolean;
  reason?: string;
  monitorCount: number;
  elevated: boolean;
}

interface PreviewWheelData {
  wedges: Array<{
    name: string;
    iconDataUrl: string | null;
    monogram: string;
    monogramColor: string;
    monogramInk: string;
    isSpecial: boolean;
    specialKind?: string;
    badge?: string;
  }>;
}

declare global {
  interface Window {
    orbit: SettingsAPI;
  }
}

const api = window.orbit;

// ─── State ───
let currentTab = 'activation';
let settings: SettingsData;
let selectedExt: string | null = null;

// ─── DOM references ───
const content = document.getElementById('content')!;
const navBtns = document.querySelectorAll<HTMLButtonElement>('.fw-nav-btn');
const statusDot = document.getElementById('status-dot')!;
const statusLabel = document.getElementById('status-label')!;
const btnPause = document.getElementById('btn-pause')!;
const sidebarVersion = document.getElementById('sidebar-version')!;

// ─── Helpers ───
function $(sel: string, parent: Element | Document = document): HTMLElement | null {
  return parent.querySelector(sel);
}

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string>,
  ...children: (string | Node)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className') el.className = v;
      else if (k === 'textContent') el.textContent = v;
      else el.setAttribute(k, v);
    }
  }
  for (const c of children) {
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

function clear(el: HTMLElement) {
  el.innerHTML = '';
}

// ─── Window controls ───
document.getElementById('btn-minimize')!.addEventListener('click', () => api.minimize());
document.getElementById('btn-close')!.addEventListener('click', () => api.close());

// ─── Sidebar: pause/resume ───
function updateSidebarStatus(paused: boolean) {
  statusDot.className = `fw-status-dot ${paused ? 'fw-status-dot--paused' : 'fw-status-dot--active'}`;
  statusLabel.textContent = paused ? 'Paused' : 'Active';
  btnPause.textContent = paused ? 'Resume' : 'Pause';
}

btnPause.addEventListener('click', () => {
  const isPaused = settings.paused.until !== null;
  if (isPaused) {
    api.resume();
  } else {
    api.pause('indefinite');
  }
});

// ─── Sidebar: try the wheel ───
document.getElementById('btn-try-wheel')!.addEventListener('click', () => api.tryTheWheel());

// ─── Tab navigation ───
navBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab!;
    if (tab === currentTab) return;
    currentTab = tab;
    navBtns.forEach(b => b.setAttribute('aria-current', String(b === btn)));
    renderTab();
  });
});

function renderTab() {
  clear(content);
  switch (currentTab) {
    case 'activation': renderActivation(); break;
    case 'wheel': renderWheel(); break;
    case 'applications': renderApplications(); break;
    case 'history': renderHistory(); break;
  }
}

// ─── Toggle helper ───
function createToggle(on: boolean, onChange: (val: boolean) => void): HTMLButtonElement {
  const btn = h('button', {
    className: `fw-toggle ${on ? 'fw-toggle--on' : 'fw-toggle--off'}`,
    'aria-pressed': String(on),
    type: 'button',
  });
  const knob = h('span', { className: 'fw-toggle__knob' });
  btn.append(knob);
  btn.addEventListener('click', () => {
    const next = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(next));
    btn.className = `fw-toggle ${next ? 'fw-toggle--on' : 'fw-toggle--off'}`;
    onChange(next);
  });
  return btn;
}

// ─── Segmented control helper ───
function createSegmented<T extends string>(
  options: { label: string; value: T }[],
  selected: T,
  onChange: (val: T) => void
): HTMLElement {
  const container = h('div', { className: 'fw-segmented' });
  const btns: HTMLButtonElement[] = [];
  for (const opt of options) {
    const btn = h('button', {
      className: `fw-segmented__btn ${opt.value === selected ? 'fw-segmented__btn--selected' : ''}`,
      type: 'button',
      textContent: opt.label,
    });
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('fw-segmented__btn--selected'));
      btn.classList.add('fw-segmented__btn--selected');
      onChange(opt.value);
    });
    btns.push(btn);
    container.append(btn);
  }
  return container;
}

// ─── Confirm dialog helper ───
function showConfirm(title: string, body: string, confirmLabel: string): Promise<boolean> {
  return new Promise(resolve => {
    const overlay = h('div', { className: 'fw-confirm-overlay' });
    const dialog = h('div', { className: 'fw-confirm-dialog' });
    dialog.append(
      h('h3', { className: 'fw-confirm-dialog__title', textContent: title }),
      h('p', { className: 'fw-confirm-dialog__body', textContent: body }),
    );
    const actions = h('div', { className: 'fw-confirm-dialog__actions' });
    const cancelBtn = h('button', { className: 'fw-confirm-dialog__cancel', type: 'button', textContent: 'Cancel' });
    const confirmBtn = h('button', {
      className: 'fw-confirm-dialog__confirm fw-confirm-dialog__confirm--danger',
      type: 'button',
      textContent: confirmLabel,
    });
    cancelBtn.addEventListener('click', () => { overlay.remove(); resolve(false); });
    confirmBtn.addEventListener('click', () => { overlay.remove(); resolve(true); });
    actions.append(cancelBtn, confirmBtn);
    dialog.append(actions);
    overlay.append(dialog);
    document.body.append(overlay);
  });
}

// ─── ACTIVATION TAB ───
async function renderActivation() {
  const status = await api.getStatus();

  // Title
  content.append(
    h('h2', { className: 'fw-section-title', textContent: 'Activation' }),
    h('p', { className: 'fw-section-desc', textContent: 'Configure how Orbit activates when you open a file.' }),
  );

  // Status card
  const cardClass = status.working ? 'fw-status-card--success' : 'fw-status-card--warning';
  const statusCard = h('div', { className: `fw-status-card ${cardClass}` });
  statusCard.append(
    h('span', { className: 'fw-status-card__dot' }),
    h('span', {
      className: 'fw-status-card__text',
      textContent: status.working
        ? `Orbit is active — monitoring ${status.monitorCount} display${status.monitorCount !== 1 ? 's' : ''}`
        : (status.reason || 'Orbit is not running correctly'),
    }),
  );
  const checkBtn = h('button', { className: 'fw-check-again-btn', type: 'button', textContent: 'Check again' });
  checkBtn.addEventListener('click', async () => {
    checkBtn.textContent = 'Checking\u2026';
    const newStatus = await api.checkAgain();
    statusCard.className = `fw-status-card ${newStatus.working ? 'fw-status-card--success' : 'fw-status-card--warning'}`;
    const textEl = statusCard.querySelector('.fw-status-card__text')!;
    textEl.textContent = newStatus.working
      ? `Orbit is active — monitoring ${newStatus.monitorCount} display${newStatus.monitorCount !== 1 ? 's' : ''}`
      : (newStatus.reason || 'Orbit is not running correctly');
    checkBtn.textContent = 'Check again';
  });
  statusCard.append(checkBtn);
  content.append(statusCard);

  // Mode radio cards
  content.append(h('h3', { className: 'fw-subsection-title', textContent: 'Trigger mode' }));

  const radioGroup = h('div', { className: 'fw-radio-group' });

  function renderRadioCards() {
    clear(radioGroup);
    const modes: Array<{ value: 'auto' | 'modifier'; title: string; desc: string }> = [
      { value: 'auto', title: 'Auto detect', desc: 'The wheel appears automatically after a short delay when you double-click a file.' },
      { value: 'modifier', title: 'Modifier key', desc: 'Hold a modifier key while double-clicking a file to show the wheel.' },
    ];
    for (const m of modes) {
      const selected = settings.activation.mode === m.value;
      const card = h('div', {
        className: `fw-radio-card ${selected ? 'fw-radio-card--selected' : 'fw-radio-card--unselected'}`,
      });
      const titleRow = h('span', { className: 'fw-radio-card__title' });
      titleRow.append(h('span', { className: 'fw-radio-card__dot' }), m.title);
      card.append(titleRow, h('span', { className: 'fw-radio-card__desc', textContent: m.desc }));
      card.addEventListener('click', async () => {
        settings.activation.mode = m.value;
        await api.updateSettings({ activation: settings.activation });
        renderRadioCards();
        renderModeOptions();
      });
      radioGroup.append(card);
    }
  }
  renderRadioCards();
  content.append(radioGroup);

  // Conditional options container
  const optionsContainer = h('div');
  content.append(optionsContainer);

  function renderModeOptions() {
    clear(optionsContainer);
    if (settings.activation.mode === 'auto') {
      // Drag delay slider
      const label = h('h3', { className: 'fw-subsection-title', textContent: 'Drag delay' });
      const row = h('div', { className: 'fw-slider-row' });
      const slider = h('input', {
        className: 'fw-slider',
        type: 'range',
        min: '100',
        max: '1000',
        step: '50',
        value: String(settings.activation.delayMs),
      }) as HTMLInputElement;
      const valueDisplay = h('span', { className: 'fw-slider-value', textContent: `${settings.activation.delayMs} ms` });
      slider.addEventListener('input', () => {
        valueDisplay.textContent = `${slider.value} ms`;
      });
      slider.addEventListener('change', async () => {
        settings.activation.delayMs = parseInt(slider.value, 10);
        await api.updateSettings({ activation: settings.activation });
      });
      row.append(slider, valueDisplay);
      optionsContainer.append(label, row);
    } else {
      // Modifier key select
      const label = h('h3', { className: 'fw-subsection-title', textContent: 'Modifier key' });
      const row = h('div', { className: 'fw-setting-row' });
      const rowLabel = h('span', { className: 'fw-setting-row__label', textContent: 'Hold this key while double-clicking' });
      const select = h('select', { className: 'fw-select' }) as HTMLSelectElement;
      for (const key of ['Alt', 'Ctrl', 'Shift']) {
        const opt = h('option', { value: key, textContent: key });
        if (key === settings.activation.modifier) opt.selected = true;
        select.append(opt);
      }
      select.addEventListener('change', async () => {
        settings.activation.modifier = select.value as 'Alt' | 'Ctrl' | 'Shift';
        await api.updateSettings({ activation: settings.activation });
      });
      const right = h('div', { className: 'fw-setting-row__right' });
      right.append(select);
      row.append(rowLabel, right);
      optionsContainer.append(label, row);
    }
  }
  renderModeOptions();

  // Launch at sign-in
  const launchRow = h('div', { className: 'fw-setting-row' });
  launchRow.append(
    h('span', { className: 'fw-setting-row__label', textContent: 'Launch at sign-in' }),
  );
  const launchRight = h('div', { className: 'fw-setting-row__right' });
  launchRight.append(createToggle(settings.launchAtLogin, async (val) => {
    settings.launchAtLogin = val;
    await api.updateSettings({ launchAtLogin: val });
  }));
  launchRow.append(launchRight);
  content.append(launchRow);
}

// ─── WHEEL TAB ───
async function renderWheel() {
  content.append(
    h('h2', { className: 'fw-section-title', textContent: 'Wheel' }),
    h('p', { className: 'fw-section-desc', textContent: 'Customize the appearance and behavior of the file wheel.' }),
  );

  const layout = h('div', { className: 'fw-wheel-preview-container' });
  const controls = h('div', { className: 'fw-wheel-controls' });
  const preview = h('div', { className: 'fw-wheel-preview' });
  preview.append(h('span', { className: 'fw-wheel-preview__placeholder', textContent: 'Loading preview\u2026' }));

  // Size segmented
  const sizeLabel = h('h3', { className: 'fw-subsection-title', textContent: 'Size' });
  const sizeControl = createSegmented(
    [{ label: 'S', value: 'S' as const }, { label: 'M', value: 'M' as const }, { label: 'L', value: 'L' as const }],
    settings.wheel.size,
    async (val) => {
      settings.wheel.size = val;
      await api.updateSettings({ wheel: settings.wheel });
      refreshPreview();
    },
  );
  controls.append(sizeLabel, sizeControl);

  // Max wedges segmented
  const wedgesLabel = h('h3', { className: 'fw-subsection-title', textContent: 'Max wedges' });
  const wedgeOptions = [4, 5, 6, 7, 8].map(n => ({ label: String(n), value: String(n) }));
  const wedgesControl = createSegmented(
    wedgeOptions,
    String(settings.wheel.maxWedges),
    async (val) => {
      settings.wheel.maxWedges = parseInt(val, 10);
      await api.updateSettings({ wheel: settings.wheel });
      refreshPreview();
    },
  );
  controls.append(wedgesLabel, wedgesControl);

  // Animation select
  const motionLabel = h('h3', { className: 'fw-subsection-title', textContent: 'Animation' });
  const motionRow = h('div', { className: 'fw-setting-row' });
  const motionSelect = h('select', { className: 'fw-select' }) as HTMLSelectElement;
  for (const [val, label] of [['system', 'System default'], ['reduce', 'Reduced motion']] as const) {
    const opt = h('option', { value: val, textContent: label });
    if (val === settings.wheel.motion) opt.selected = true;
    motionSelect.append(opt);
  }
  motionSelect.addEventListener('change', async () => {
    settings.wheel.motion = motionSelect.value as 'system' | 'reduce';
    await api.updateSettings({ wheel: settings.wheel });
  });
  motionRow.append(
    h('span', { className: 'fw-setting-row__label', textContent: 'Motion preference' }),
    motionSelect,
  );
  controls.append(motionLabel, motionRow);

  // Keep wheel on screen
  const keepRow = h('div', { className: 'fw-setting-row' });
  keepRow.append(
    h('span', { className: 'fw-setting-row__label', textContent: 'Keep the wheel on screen' }),
    h('span', { className: 'fw-static-text', textContent: 'Always on' }),
  );
  controls.append(keepRow);

  layout.append(controls, preview);
  content.append(layout);

  // Load preview
  async function refreshPreview() {
    try {
      const data = await api.getPreviewWheelData(settings.wheel.size, settings.wheel.maxWedges);
      clear(preview);
      if (!data.wedges.length) {
        preview.append(h('span', { className: 'fw-wheel-preview__placeholder', textContent: 'No wedges to preview' }));
        return;
      }
      // Render simple wedge preview: show icons/monograms in a circle
      const container = h('div', { style: 'position:relative;width:300px;height:300px;' });
      const cx = 150, cy = 150, r = 110;
      const n = data.wedges.length;
      data.wedges.forEach((w, i) => {
        const angle = (2 * Math.PI * i) / n - Math.PI / 2;
        const x = cx + r * Math.cos(angle) - 24;
        const y = cy + r * Math.sin(angle) - 24;
        const wedgeEl = h('div', {
          style: `position:absolute;left:${x}px;top:${y}px;width:48px;height:48px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;overflow:hidden;background:${w.monogramColor};color:${w.monogramInk};`,
        });
        if (w.iconDataUrl) {
          const img = h('img', { src: w.iconDataUrl, style: 'width:100%;height:100%;object-fit:cover;' });
          wedgeEl.append(img);
        } else {
          wedgeEl.textContent = w.monogram;
        }
        container.append(wedgeEl);
      });
      // Center circle
      const center = h('div', {
        style: `position:absolute;left:${cx - 28}px;top:${cy - 28}px;width:56px;height:56px;border-radius:50%;background:rgba(255,255,255,0.035);border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;`,
      });
      container.append(center);
      preview.append(container);
    } catch {
      clear(preview);
      preview.append(h('span', { className: 'fw-wheel-preview__placeholder', textContent: 'Failed to load preview' }));
    }
  }
  refreshPreview();
}

// ─── APPLICATIONS TAB ───
async function renderApplications() {
  content.append(
    h('h2', { className: 'fw-section-title', textContent: 'Applications' }),
    h('p', { className: 'fw-section-desc', textContent: 'Manage which applications appear on the wheel for each file type.' }),
  );

  const layout = h('div', { className: 'fw-apps-layout' });
  const leftCol = h('div', { className: 'fw-apps-left' });
  const rightCol = h('div', { className: 'fw-apps-right' });

  // Filter input
  const filterInput = h('input', {
    className: 'fw-filter-input',
    type: 'text',
    placeholder: 'Filter file types\u2026',
  }) as HTMLInputElement;
  leftCol.append(filterInput);

  // Extension list
  const extList = h('div', { className: 'fw-ext-list' });
  leftCol.append(extList);

  let allExtensions: ExtensionInfo[] = [];

  async function loadExtensions() {
    allExtensions = await api.getExtensions();
    renderExtList();
  }

  function renderExtList() {
    clear(extList);
    const filter = filterInput.value.toLowerCase();
    const filtered = filter
      ? allExtensions.filter(e => e.ext.toLowerCase().includes(filter) || e.friendlyType.toLowerCase().includes(filter))
      : allExtensions;

    for (const ext of filtered) {
      const item = h('div', {
        className: `fw-ext-item ${selectedExt === ext.ext ? 'fw-ext-item--selected' : ''}`,
      });
      item.append(
        h('span', { textContent: ext.ext }),
        h('span', { className: 'fw-ext-item__count', textContent: String(ext.appCount) }),
      );
      item.addEventListener('click', () => {
        selectedExt = ext.ext;
        renderExtList();
        renderAppList();
      });
      extList.append(item);
    }

    if (!selectedExt && filtered.length > 0) {
      selectedExt = filtered[0].ext;
      renderExtList();
    }
  }

  filterInput.addEventListener('input', () => renderExtList());

  // Right column: app list for selected extension
  async function renderAppList() {
    clear(rightCol);
    if (!selectedExt) {
      rightCol.append(h('p', { className: 'fw-section-desc', textContent: 'Select a file type from the list.' }));
      return;
    }

    const extInfo = allExtensions.find(e => e.ext === selectedExt);
    const header = h('div', { className: 'fw-ext-header' });
    header.append(
      h('span', { className: 'fw-ext-header__title', textContent: selectedExt }),
      h('span', { className: 'fw-ext-header__meta', textContent: extInfo?.friendlyType || '' }),
    );
    rightCol.append(header);

    const apps = await api.getAppsForExtension(selectedExt);
    const appListContainer = h('div');

    let dragSrcIndex: number | null = null;

    function renderAppRows() {
      clear(appListContainer);
      apps.forEach((app, index) => {
        const row = h('div', {
          className: `fw-app-row ${app.isPinned ? 'fw-app-row--pinned' : ''}`,
          draggable: 'true',
        });

        // Drag handle
        const handle = h('div', { className: 'fw-app-row__drag-handle' });
        handle.innerHTML = '<svg width="8" height="14" viewBox="0 0 8 14"><circle cx="2" cy="2" r="1.2" fill="currentColor"/><circle cx="6" cy="2" r="1.2" fill="currentColor"/><circle cx="2" cy="7" r="1.2" fill="currentColor"/><circle cx="6" cy="7" r="1.2" fill="currentColor"/><circle cx="2" cy="12" r="1.2" fill="currentColor"/><circle cx="6" cy="12" r="1.2" fill="currentColor"/></svg>';
        row.append(handle);

        // Icon
        const icon = h('div', { className: 'fw-app-row__icon' });
        if (app.iconDataUrl) {
          icon.append(h('img', { src: app.iconDataUrl, alt: app.name }));
        } else {
          icon.style.background = app.monogramColor;
          icon.style.color = app.monogramInk;
          icon.textContent = app.monogram;
        }
        row.append(icon);

        // Info
        const info = h('div', { className: 'fw-app-row__info' });
        info.append(h('div', { className: 'fw-app-row__name', textContent: app.name }));
        if (app.packageDisplay) {
          info.append(h('div', { className: 'fw-app-row__package', textContent: app.packageDisplay }));
        }
        if (app.tags.length) {
          const tagsEl = h('div', { className: 'fw-app-row__tags' });
          for (const tag of app.tags) {
            tagsEl.append(h('span', { className: `fw-tag fw-tag--${tag.type}`, textContent: tag.label }));
          }
          info.append(tagsEl);
        }
        row.append(info);

        // Action buttons
        const actions = h('div', { className: 'fw-app-row__actions' });

        // Pin button
        const pinBtn = h('button', {
          className: `fw-app-action-btn ${app.isPinned ? 'fw-app-action-btn--active' : ''}`,
          type: 'button',
          title: app.isPinned ? 'Unpin' : 'Pin to top',
          'aria-label': app.isPinned ? 'Unpin' : 'Pin to top',
        });
        pinBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 1v8M4 3l3-2 3 2M3 12h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
        pinBtn.addEventListener('click', async () => {
          await api.pinApp(selectedExt!, app.id, !app.isPinned);
          const updatedApps = await api.getAppsForExtension(selectedExt!);
          apps.splice(0, apps.length, ...updatedApps);
          renderAppRows();
        });
        actions.append(pinBtn);

        // Hide button
        if (app.isHideable) {
          const hideBtn = h('button', {
            className: 'fw-app-action-btn',
            type: 'button',
            title: 'Hide',
            'aria-label': 'Hide',
          });
          hideBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14"><path d="M1 1l12 12M5.5 5.5a2 2 0 002.9 2.9M2.2 4.7C1.4 5.5 1 6.5 1 7s1.8 4 6 4c.8 0 1.5-.1 2.2-.3M12 9.3c.6-.7 1-1.5 1-2.3 0-.5-1.8-4-6-4-.4 0-.8 0-1.2.1" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" fill="none"/></svg>';
          hideBtn.addEventListener('click', async () => {
            await api.hideApp(selectedExt!, app.id);
            const updatedApps = await api.getAppsForExtension(selectedExt!);
            apps.splice(0, apps.length, ...updatedApps);
            renderAppRows();
            renderHiddenApps();
          });
          actions.append(hideBtn);
        }

        row.append(actions);

        // Drag & drop
        row.addEventListener('dragstart', (e) => {
          dragSrcIndex = index;
          row.classList.add('fw-app-row--dragging');
          e.dataTransfer!.effectAllowed = 'move';
        });
        row.addEventListener('dragend', () => {
          row.classList.remove('fw-app-row--dragging');
          dragSrcIndex = null;
        });
        row.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer!.dropEffect = 'move';
        });
        row.addEventListener('drop', async (e) => {
          e.preventDefault();
          if (dragSrcIndex === null || dragSrcIndex === index) return;
          const [moved] = apps.splice(dragSrcIndex, 1);
          apps.splice(index, 0, moved);
          await api.reorderApps(selectedExt!, apps.map(a => a.id));
          renderAppRows();
        });

        appListContainer.append(row);
      });
    }
    renderAppRows();
    rightCol.append(appListContainer);

    // Hidden apps
    const hiddenSection = h('div', { className: 'fw-hidden-section' });
    rightCol.append(hiddenSection);

    async function renderHiddenApps() {
      clear(hiddenSection);
      const hidden = await api.getHiddenAppsForExtension(selectedExt!);
      if (!hidden.length) return;

      hiddenSection.append(h('div', { className: 'fw-hidden-section__title', textContent: 'Hidden' }));
      for (const app of hidden) {
        const row = h('div', { className: 'fw-app-row' });
        const icon = h('div', { className: 'fw-app-row__icon' });
        if (app.iconDataUrl) {
          icon.append(h('img', { src: app.iconDataUrl, alt: app.name }));
        } else {
          icon.style.background = app.monogramColor;
          icon.style.color = app.monogramInk;
          icon.textContent = app.monogram;
        }
        row.append(icon);
        const info = h('div', { className: 'fw-app-row__info' });
        info.append(h('div', { className: 'fw-app-row__name', textContent: app.name }));
        row.append(info);

        const showBtn = h('button', {
          className: 'fw-app-action-btn',
          type: 'button',
          title: 'Show',
          'aria-label': 'Show',
        });
        showBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 3C2.8 3 1 7 1 7s1.8 4 6 4 6-4 6-4-1.8-4-6-4z" stroke="currentColor" stroke-width="1.1" fill="none"/><circle cx="7" cy="7" r="2" stroke="currentColor" stroke-width="1.1" fill="none"/></svg>';
        showBtn.addEventListener('click', async () => {
          await api.showApp(selectedExt!, app.id);
          const updatedApps = await api.getAppsForExtension(selectedExt!);
          apps.splice(0, apps.length, ...updatedApps);
          renderAppRows();
          renderHiddenApps();
        });
        row.append(showBtn);
        hiddenSection.append(row);
      }
    }
    renderHiddenApps();

    // Footer
    const footer = h('div', { className: 'fw-apps-footer' });
    const resetLink = h('button', { className: 'fw-reset-link', type: 'button', textContent: 'Reset to defaults' });
    resetLink.addEventListener('click', async () => {
      const confirmed = await showConfirm(
        'Reset extension?',
        `This will reset all application preferences for ${selectedExt} to their defaults.`,
        'Reset',
      );
      if (confirmed) {
        await api.resetExtension(selectedExt!);
        const updatedApps = await api.getAppsForExtension(selectedExt!);
        apps.splice(0, apps.length, ...updatedApps);
        renderAppRows();
        renderHiddenApps();
      }
    });

    const addBtn = h('button', { className: 'fw-add-app-btn', type: 'button', textContent: 'Add application\u2026' });
    addBtn.addEventListener('click', async () => {
      const result = await api.browseForExe();
      if (result) {
        await api.addApplication({ exePath: result.path, name: result.name, extensions: [selectedExt!] });
        const updatedApps = await api.getAppsForExtension(selectedExt!);
        apps.splice(0, apps.length, ...updatedApps);
        renderAppRows();
      }
    });

    footer.append(resetLink, addBtn);
    rightCol.append(footer);
  }

  layout.append(leftCol, rightCol);
  content.append(layout);

  await loadExtensions();
  if (selectedExt) renderAppList();
}

// ─── HISTORY & PRIVACY TAB ───
async function renderHistory() {
  content.append(
    h('h2', { className: 'fw-section-title', textContent: 'History & privacy' }),
    h('p', { className: 'fw-section-desc', textContent: 'View usage statistics and manage your privacy settings.' }),
  );

  // Stats
  const stats = await api.getHistoryStats();
  const tilesGrid = h('div', { className: 'fw-stat-tiles' });

  const tiles: Array<{ value: string; label: string }> = [
    { value: String(stats.opensRecorded), label: 'Files opened' },
    { value: String(stats.fileTypes), label: 'File types' },
    { value: stats.recordingSince, label: 'Recording since' },
  ];

  for (const t of tiles) {
    const tile = h('div', { className: 'fw-stat-tile' });
    tile.append(
      h('span', { className: 'fw-stat-tile__value', textContent: t.value }),
      h('span', { className: 'fw-stat-tile__label', textContent: t.label }),
    );
    tilesGrid.append(tile);
  }
  content.append(tilesGrid);

  // Reset button
  const resetRow = h('div', { className: 'fw-setting-row' });
  resetRow.append(
    h('span', { className: 'fw-setting-row__label', textContent: 'Reset usage history' }),
  );
  const resetBtn = h('button', { className: 'fw-danger-btn', type: 'button', textContent: 'Reset history' });
  resetBtn.addEventListener('click', async () => {
    const confirmed = await showConfirm(
      'Reset history?',
      'This will permanently delete all recorded usage data. This action cannot be undone.',
      'Reset',
    );
    if (confirmed) {
      await api.resetHistory();
      renderTab(); // re-render to show updated stats
    }
  });
  const resetRight = h('div', { className: 'fw-setting-row__right' });
  resetRight.append(resetBtn);
  resetRow.append(resetRight);
  content.append(resetRow);

  // Privacy section
  content.append(h('h3', { className: 'fw-subsection-title', textContent: 'Privacy' }));

  const privacyItems = [
    'All data is stored locally on this device',
    'No file contents are ever read or transmitted',
    'Only file extensions and application associations are recorded',
    'No analytics or telemetry data is collected',
  ];

  for (const text of privacyItems) {
    const row = h('div', { className: 'fw-privacy-row' });
    const checkSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    checkSvg.setAttribute('class', 'fw-privacy-row__check');
    checkSvg.setAttribute('width', '18');
    checkSvg.setAttribute('height', '18');
    checkSvg.setAttribute('viewBox', '0 0 18 18');
    checkSvg.innerHTML = '<path d="M4 9l3.5 3.5L14 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>';
    row.append(checkSvg, h('span', { className: 'fw-privacy-row__text', textContent: text }));
    content.append(row);
  }

  // Settings file path
  content.append(h('h3', { className: 'fw-subsection-title', textContent: 'Settings file' }));
  const pathRow = h('div', { className: 'fw-path-row' });
  pathRow.append(
    h('span', { className: 'fw-path-row__path', textContent: '%APPDATA%\\Orbit\\settings.json' }),
  );
  const openFolderBtn = h('button', { className: 'fw-path-row__open-btn', type: 'button', textContent: 'Open folder' });
  openFolderBtn.addEventListener('click', () => api.openSettingsFolder());
  pathRow.append(openFolderBtn);
  content.append(pathRow);
}

// ─── Listen for external settings changes ───
api.onSettingsChanged((s) => {
  settings = s;
  updateSidebarStatus(s.paused.until !== null);
  renderTab();
});

api.onHistoryReset(() => {
  if (currentTab === 'history') renderTab();
});

// ─── Init ───
async function init() {
  settings = await api.getSettings();
  const version = await api.getVersion();
  sidebarVersion.textContent = `v${version}`;
  updateSidebarStatus(settings.paused.until !== null);
  renderTab();
}

init();
