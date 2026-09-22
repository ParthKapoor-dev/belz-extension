/*! belz-singleton: designer/features/settings/modal */
// Holds module-level state, so it must be bundled exactly once;
// the build fails otherwise. See scripts/check-singletons.mjs.
//
// The settings modal: one row per setting of config/settings.ts, written
// straight to the settings store as they change.
import { settings } from '../../core/settings';
import {
  settingsIn,
  type SelectSpec,
  type SettingKey,
  type SettingSection,
  type ToggleSpec
} from '../../../config/settings';
import { EXTENSION_OWNED_ATTR, ns, nsAttr } from '../../../config/namespace';
import { modalLock } from '../../ui/modal-lock';
import { T, RADIUS } from '../../ui/theme';

const SETTINGS_MODAL_ID = ns('SettingsModal');
const CONTENT_ID = ns('SettingsContent');
const CHECKBOX_ATTR = nsAttr('setting-key');
const SELECT_ATTR = nsAttr('setting-select-key');
const SWITCH_TRACK_ATTR = nsAttr('setting-switch-track');
const SWITCH_THUMB_ATTR = nsAttr('setting-switch-thumb');

/** Paint the switch of setting `settingKey`, found under `root`. */
function syncSwitchVisual(root: ParentNode, settingKey: string, isEnabled: boolean): void {
  const track = root.querySelector<HTMLElement>(`[${SWITCH_TRACK_ATTR}="${settingKey}"]`);
  const thumb = root.querySelector<HTMLElement>(`[${SWITCH_THUMB_ATTR}="${settingKey}"]`);
  if (!track || !thumb) return;

  track.style.background = isEnabled
    ? T.accent
    : 'rgba(100, 116, 139, 0.5)';
  track.style.borderColor = isEnabled
    ? 'rgba(59, 130, 246, 0.65)'
    : 'rgba(148, 163, 184, 0.5)';
  thumb.style.transform = isEnabled ? 'translateX(18px)' : 'translateX(0)';
}

function createSettingRow(key: SettingKey, definition: ToggleSpec): HTMLLabelElement {
  const row = document.createElement('label');
  row.setAttribute(CHECKBOX_ATTR, key);
  Object.assign(row.style, {
    position: 'relative',
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: '10px',
    padding: '10px 12px',
    border: '1px solid rgba(148, 163, 184, 0.22)',
    borderRadius: RADIUS,
    background: 'rgba(15, 23, 42, 0.46)',
    cursor: 'pointer'
  });

  const textWrap = document.createElement('div');

  const title = document.createElement('div');
  title.textContent = definition.label;
  Object.assign(title.style, {
    color: T.fg,
    fontSize: '13px',
    fontWeight: '600'
  });

  const description = document.createElement('div');
  description.textContent = definition.description;
  Object.assign(description.style, {
    color: T.fgMuted,
    fontSize: '12px',
    marginTop: '2px'
  });

  textWrap.appendChild(title);
  textWrap.appendChild(description);

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.setAttribute(CHECKBOX_ATTR, key);
  Object.assign(checkbox.style, {
    position: 'absolute',
    opacity: '0',
    width: '1px',
    height: '1px',
    pointerEvents: 'none'
  });

  const switchTrack = document.createElement('span');
  switchTrack.setAttribute(SWITCH_TRACK_ATTR, key);
  Object.assign(switchTrack.style, {
    width: '42px',
    height: '24px',
    borderRadius: RADIUS,
    border: '1px solid rgba(148, 163, 184, 0.5)',
    background: 'rgba(100, 116, 139, 0.5)',
    position: 'relative',
    transition: 'all 150ms ease'
  });

  const switchThumb = document.createElement('span');
  switchThumb.setAttribute(SWITCH_THUMB_ATTR, key);
  Object.assign(switchThumb.style, {
    position: 'absolute',
    top: '2px',
    left: '2px',
    width: '18px',
    height: '18px',
    borderRadius: RADIUS,
    background: T.fg,
    boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
    transition: 'transform 150ms ease'
  });
  switchTrack.appendChild(switchThumb);

  checkbox.onchange = () => {
    syncSwitchVisual(row, key, checkbox.checked);
    settings.set(key, checkbox.checked);
  };

  row.appendChild(textWrap);
  row.appendChild(switchTrack);
  row.appendChild(checkbox);
  return row;
}

function createSelectRow(key: SettingKey, definition: SelectSpec): HTMLDivElement {
  const row = document.createElement('div');
  row.setAttribute(SELECT_ATTR, key);
  Object.assign(row.style, {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: '12px',
    alignItems: 'center',
    padding: '10px 12px',
    border: '1px solid rgba(148, 163, 184, 0.22)',
    borderRadius: RADIUS,
    background: 'rgba(15, 23, 42, 0.46)'
  });

  const textWrap = document.createElement('div');

  const title = document.createElement('div');
  title.textContent = definition.label;
  Object.assign(title.style, {
    color: T.fg,
    fontSize: '13px',
    fontWeight: '600'
  });

  const description = document.createElement('div');
  description.textContent = definition.description;
  Object.assign(description.style, {
    color: T.fgMuted,
    fontSize: '12px',
    marginTop: '2px'
  });

  textWrap.appendChild(title);
  textWrap.appendChild(description);

  const select = document.createElement('select');
  select.setAttribute(SELECT_ATTR, key);
  Object.assign(select.style, {
    minWidth: '120px',
    background: 'rgba(15, 23, 42, 0.75)',
    color: T.fgMuted,
    border: '1px solid rgba(148, 163, 184, 0.4)',
    borderRadius: RADIUS,
    padding: '6px 8px',
    fontSize: '12px',
    outline: 'none',
    cursor: 'pointer'
  });

  for (const option of definition.options) {
    const optionEl = document.createElement('option');
    optionEl.value = String(option.value);
    optionEl.textContent = option.label;
    select.appendChild(optionEl);
  }

  // The store turns the option's text back into the setting's value type.
  select.onchange = () => settings.set(key, select.value);

  row.appendChild(textWrap);
  row.appendChild(select);
  return row;
}

function sectionTitle(text: string): HTMLDivElement {
  const title = document.createElement('div');
  title.textContent = text;
  Object.assign(title.style, {
    color: T.accent,
    fontSize: '12px',
    fontWeight: '600',
    letterSpacing: '0.4px',
    marginTop: '6px',
    textTransform: 'uppercase'
  });
  return title;
}

/** One row per setting of `section` (see config/settings.ts), under an optional title. */
function appendSection(content: HTMLElement, section: SettingSection, title: string | null): void {
  if (title) content.appendChild(sectionTitle(title));
  for (const [key, spec] of settingsIn(section)) {
    content.appendChild(spec.kind === 'toggle' ? createSettingRow(key, spec) : createSelectRow(key, spec));
  }
}

export class SettingsModal {
  private overlay: HTMLDivElement | null = null;

  private refresh(): void {
    if (!this.overlay) return;
    const current = settings.get();

    for (const checkbox of this.overlay.querySelectorAll<HTMLInputElement>(`input[${CHECKBOX_ATTR}]`)) {
      const key = checkbox.getAttribute(CHECKBOX_ATTR) as SettingKey;
      checkbox.checked = Boolean(current[key]);
      syncSwitchVisual(this.overlay, key, checkbox.checked);
    }

    for (const select of this.overlay.querySelectorAll<HTMLSelectElement>(`select[${SELECT_ATTR}]`)) {
      const key = select.getAttribute(SELECT_ATTR) as SettingKey;
      select.value = String(current[key]);
    }
  }

  get isOpen(): boolean {
    return this.overlay?.style.display === 'flex';
  }

  close(): void {
    if (!this.overlay || this.overlay.style.display === 'none') return;
    this.overlay.style.display = 'none';
    modalLock.unlock();
  }

  private readonly onEscape = (event: KeyboardEvent): void => {
    if (!this.isOpen || event.key !== 'Escape') return;
    event.preventDefault();
    this.close();
  };

  private ensureOverlay(): HTMLDivElement {
    if (this.overlay) return this.overlay;

    const overlay = document.createElement('div');
    overlay.id = SETTINGS_MODAL_ID;
    overlay.setAttribute(EXTENSION_OWNED_ATTR, 'true');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '1000002',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(2, 6, 23, 0.72)',
      backdropFilter: 'blur(4px)',
      padding: '20px'
    });

    const dialog = document.createElement('div');
    Object.assign(dialog.style, {
      width: '560px',
      maxWidth: 'calc(100vw - 30px)',
      maxHeight: 'calc(100vh - 40px)',
      overflow: 'hidden',
      borderRadius: RADIUS,
      border: '1px solid rgba(148, 163, 184, 0.3)',
      background: T.surface,
      boxShadow: '0 30px 70px rgba(0,0,0,0.45)',
      display: 'flex',
      flexDirection: 'column'
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '14px 16px',
      borderBottom: '1px solid rgba(148, 163, 184, 0.22)'
    });

    const title = document.createElement('h2');
    title.textContent = 'Extension Settings';
    Object.assign(title.style, {
      margin: '0',
      color: T.fg,
      fontSize: '16px'
    });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close settings');
    Object.assign(closeBtn.style, {
      width: '30px',
      height: '30px',
      borderRadius: RADIUS,
      border: '1px solid rgba(248, 113, 113, 0.45)',
      background: 'rgba(248, 113, 113, 0.14)',
      color: T.danger,
      fontSize: '20px',
      cursor: 'pointer',
      lineHeight: '1'
    });
    closeBtn.onclick = () => this.close();

    header.appendChild(title);
    header.appendChild(closeBtn);

    const content = document.createElement('div');
    content.id = CONTENT_ID;
    Object.assign(content.style, {
      padding: '14px 16px',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px'
    });

    appendSection(content, 'features', null);
    appendSection(content, 'editor', 'Textarea Editor Defaults');
    appendSection(content, 'advanced', 'Advanced');

    const footer = document.createElement('div');
    Object.assign(footer.style, {
      borderTop: '1px solid rgba(148, 163, 184, 0.22)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '10px',
      padding: '12px 16px'
    });

    const hint = document.createElement('div');
    hint.textContent = 'Settings apply immediately and are persisted in this browser.';
    Object.assign(hint.style, {
      fontSize: '12px',
      color: T.fgMuted
    });

    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.textContent = 'Done';
    Object.assign(doneBtn.style, {
      border: '1px solid rgba(96, 165, 250, 0.45)',
      background: T.accent,
      color: T.fg,
      borderRadius: RADIUS,
      padding: '8px 14px',
      cursor: 'pointer'
    });
    doneBtn.onclick = () => this.close();

    footer.appendChild(hint);
    footer.appendChild(doneBtn);

    dialog.appendChild(header);
    dialog.appendChild(content);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        this.close();
      }
    });

    document.addEventListener('keydown', this.onEscape, true);
    document.body.appendChild(overlay);

    this.overlay = overlay;
    return overlay;
  }

  /** Open the modal showing the current settings. */
  open(): void {
    const wasOpen = this.isOpen;
    const overlay = this.ensureOverlay();
    this.refresh();
    overlay.style.display = 'flex';
    if (!wasOpen) modalLock.lock();
  }
}

/** The page's settings modal. */
export const settingsModal = new SettingsModal();
