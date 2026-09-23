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
import {
  MODAL_DIALOG,
  MODAL_FOOTER,
  MODAL_HEADER,
  MODAL_ICON_BTN,
  MODAL_OVERLAY,
  MODAL_TITLE
} from '../../ui/modal';

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
  /** Set while open: repaints the rows when the settings change elsewhere (another tab). */
  private unsubscribe: (() => void) | null = null;

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
    this.unsubscribe?.();
    this.unsubscribe = null;
    modalLock.unlock(this);
  }

  /** Close, and remove the modal's DOM and listener. The next open rebuilds it. */
  dispose(): void {
    this.close();
    document.removeEventListener('keydown', this.onEscape, true);
    this.overlay?.remove();
    this.overlay = null;
  }

  // Only the topmost modal answers Esc (it may be open over the large editor
  // or the JSON editor), and only once: the event is marked handled.
  private readonly onEscape = (event: KeyboardEvent): void => {
    if (!this.isOpen || event.key !== 'Escape') return;
    if (event.defaultPrevented || !modalLock.isTopmost(this)) return;
    event.preventDefault();
    event.stopPropagation();
    this.close();
  };

  private ensureOverlay(): HTMLDivElement {
    // The host app can wipe and re-render the body, taking the modal with it.
    // Drop the detached one (its listener, subscription and the modal lock if
    // it was open) and build afresh.
    if (this.overlay && !this.overlay.isConnected) this.dispose();
    if (this.overlay) return this.overlay;

    const overlay = document.createElement('div');
    overlay.id = SETTINGS_MODAL_ID;
    overlay.setAttribute(EXTENSION_OWNED_ATTR, 'true');
    Object.assign(overlay.style, MODAL_OVERLAY, { zIndex: '1000002' });

    const dialog = document.createElement('div');
    Object.assign(dialog.style, MODAL_DIALOG, {
      width: '560px',
      maxWidth: 'calc(100vw - 30px)',
      maxHeight: 'calc(100vh - 40px)'
    });

    const header = document.createElement('div');
    Object.assign(header.style, MODAL_HEADER);

    const title = document.createElement('h2');
    title.textContent = 'Extension Settings';
    Object.assign(title.style, MODAL_TITLE);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close';
    closeBtn.setAttribute('aria-label', 'Close settings');
    Object.assign(closeBtn.style, MODAL_ICON_BTN, { fontSize: '18px' });
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
    Object.assign(footer.style, MODAL_FOOTER);

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

  /**
   * Open the modal showing the current settings, and keep it current while
   * open: a change made in another tab (or by a shortcut) repaints the rows.
   */
  open(): void {
    const overlay = this.ensureOverlay();
    const wasOpen = this.isOpen;
    overlay.style.display = 'flex';
    // subscribe() calls back at once, which paints the current settings.
    this.unsubscribe ??= settings.subscribe(() => this.refresh());
    if (!wasOpen) modalLock.lock(this);
  }
}

/** The page's settings modal. */
export const settingsModal = new SettingsModal();
