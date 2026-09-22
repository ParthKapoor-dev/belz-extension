/*! belz-singleton: designer/features/json-editor/modal */
// Holds module-level state, so it must be bundled exactly once;
// the build fails otherwise. See scripts/check-singletons.mjs.
import { state } from '../../core/state';
import { generateInputJSON } from './types';
import { extractAllInputs } from './extractor';
import { syncJSONToInputs } from './sync';
import { showToast } from '../../ui/toast';
import { EXTENSION_OWNED_ATTR } from '../../../config/namespace';
import { lockModalInteraction, unlockModalInteraction } from '../../ui/modal-lock';
import { T, FONT_MONO, RADIUS } from '../../ui/theme';
import {
  MODAL_OVERLAY, MODAL_DIALOG, MODAL_HEADER, MODAL_FOOTER,
  MODAL_TITLE, MODAL_ICON_BTN
} from '../../ui/modal';
import {
  ICON_BUTTON_STYLE, ICON_BUTTON_HOVER, ICON_BUTTON_UNHOVER,
  PRIMARY_BUTTON_STYLE, PRIMARY_BUTTON_HOVER, PRIMARY_BUTTON_UNHOVER,
  applyHoverEffect
} from '../../ui/styles';
import { createLogger } from '../../../shared/logger';

const log = createLogger('json-editor');

// The JSON input editor: shows the method's inputs as a JSON object, and
// writes an edited object back into the page's test inputs.

/** The modal's own elements, kept from when it was built. */
interface ModalParts {
  overlay: HTMLDivElement;
  title: HTMLHeadingElement;
  textarea: HTMLTextAreaElement;
  loading: HTMLDivElement;
  info: HTMLDivElement;
  errors: HTMLDivElement;
  syncButton: HTMLButtonElement;
}

let parts: ModalParts | null = null;

const INFO_COLORS = {
  background: 'rgba(59, 130, 246, 0.15)',
  borderColor: 'rgba(59, 130, 246, 0.3)',
  color: T.accent
};
const WARNING_COLORS = {
  background: 'rgba(245, 158, 11, 0.15)',
  borderColor: 'rgba(245, 158, 11, 0.3)',
  color: T.warning
};

/**
 * Fill a message box with a bold heading and one line per item. Built with
 * textContent: keys and errors come from the page, so never as HTML.
 */
function showMessage(box: HTMLElement, heading: string, lines: string[], inline = false): void {
  box.replaceChildren();
  const strong = document.createElement('strong');
  strong.textContent = heading;
  box.append(strong);
  if (inline) {
    box.append(` ${lines.join(', ')}`);
  } else {
    for (const line of lines) box.append(document.createElement('br'), `• ${line}`);
  }
  box.style.display = 'block';
}

function iconButton(text: string, label: string, extra: Partial<CSSStyleDeclaration> = {}): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = text;
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
  Object.assign(button.style, MODAL_ICON_BTN, extra);
  button.onmouseenter = () => {
    button.style.background = T.surface2;
    button.style.color = T.fg;
  };
  button.onmouseleave = () => {
    button.style.background = 'transparent';
    button.style.color = T.fgMuted;
  };
  return button;
}

function messageBox(colors: typeof INFO_COLORS, fontSize: string): HTMLDivElement {
  const box = document.createElement('div');
  Object.assign(box.style, {
    marginTop: '12px',
    padding: '12px 16px',
    border: '1px solid',
    borderRadius: RADIUS,
    fontSize,
    display: 'none',
    backdropFilter: 'blur(10px)',
    ...colors
  });
  return box;
}

function buildModal(): ModalParts {
  const overlay = document.createElement('div');
  overlay.setAttribute(EXTENSION_OWNED_ATTR, 'true');
  Object.assign(overlay.style, MODAL_OVERLAY, { zIndex: '999998' });

  const container = document.createElement('div');
  Object.assign(container.style, MODAL_DIALOG, {
    width: '90%',
    maxWidth: '700px',
    maxHeight: '80vh'
  });

  // Header: title + refresh on the left, close on the right.
  const header = document.createElement('div');
  Object.assign(header.style, MODAL_HEADER);

  const titleContainer = document.createElement('div');
  Object.assign(titleContainer.style, { display: 'flex', alignItems: 'center', gap: '12px' });

  const title = document.createElement('h2');
  title.textContent = 'Edit Input JSON';
  Object.assign(title.style, MODAL_TITLE);

  const refreshBtn = iconButton('⟳', 'Refresh inputs from page');
  refreshBtn.onclick = () => loadInputsIntoModal(true);

  const closeBtn = iconButton('×', 'Close', { fontSize: '18px' });
  closeBtn.onclick = closeModal;

  titleContainer.append(title, refreshBtn);
  header.append(titleContainer, closeBtn);

  // Content: loading indicator, the JSON textarea, info and error boxes.
  const content = document.createElement('div');
  Object.assign(content.style, { padding: '24px', flex: '1', overflow: 'auto', position: 'relative' });

  const loading = document.createElement('div');
  Object.assign(loading.style, {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    textAlign: 'center',
    color: T.fgMuted,
    fontSize: '14px',
    display: 'none'
  });
  const hourglass = document.createElement('div');
  Object.assign(hourglass.style, { fontSize: '24px', marginBottom: '8px' });
  hourglass.textContent = '⏳';
  loading.append(hourglass, 'Loading inputs...');

  const textarea = document.createElement('textarea');
  Object.assign(textarea.style, {
    width: '100%',
    minHeight: '300px',
    padding: '12px',
    fontFamily: FONT_MONO,
    fontSize: '13px',
    border: `1px solid ${T.line2}`,
    borderRadius: RADIUS,
    resize: 'vertical',
    outline: 'none',
    background: T.ink,
    color: T.fg,
    transition: 'border-color 140ms ease'
  });
  textarea.addEventListener('focus', () => { textarea.style.borderColor = T.accent; });
  textarea.addEventListener('blur', () => { textarea.style.borderColor = T.line2; });

  const textareaContainer = document.createElement('div');
  textareaContainer.style.position = 'relative';
  textareaContainer.append(textarea);

  const info = messageBox(INFO_COLORS, '12px');
  const errors = messageBox({
    background: 'rgba(239, 68, 68, 0.15)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
    color: T.danger
  }, '13px');

  content.append(loading, textareaContainer, info, errors);

  // Footer: hint on the left, Cancel + Sync on the right.
  const footer = document.createElement('div');
  Object.assign(footer.style, MODAL_FOOTER);

  const helpText = document.createElement('div');
  Object.assign(helpText.style, { fontSize: '12px', color: T.fgFaint });
  helpText.textContent = 'Keys marked with * are mandatory';

  const buttonGroup = document.createElement('div');
  Object.assign(buttonGroup.style, { display: 'flex', gap: '8px' });

  const TEXT_BTN = { width: 'auto', height: 'auto', padding: '7px 16px', fontSize: '13px' };

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  Object.assign(cancelBtn.style, ICON_BUTTON_STYLE, TEXT_BTN);
  applyHoverEffect(cancelBtn, ICON_BUTTON_HOVER, ICON_BUTTON_UNHOVER);
  cancelBtn.onclick = closeModal;

  const syncButton = document.createElement('button');
  syncButton.textContent = 'Sync';
  Object.assign(syncButton.style, PRIMARY_BUTTON_STYLE, TEXT_BTN);
  applyHoverEffect(syncButton, PRIMARY_BUTTON_HOVER, PRIMARY_BUTTON_UNHOVER);
  syncButton.onclick = handleSyncClick;

  buttonGroup.append(cancelBtn, syncButton);
  footer.append(helpText, buttonGroup);

  container.append(header, content, footer);
  overlay.append(container);

  // Click outside to close.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  // One Escape listener for the modal's lifetime. It used to be added on every
  // open and removed only by an Escape press, so each open closed with Cancel
  // left one more listener behind.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) closeModal();
  });

  document.body.appendChild(overlay);
  state.modalEl = overlay;
  return { overlay, title, textarea, loading, info, errors, syncButton };
}

function ensureModal(): ModalParts {
  if (!parts) parts = buildModal();
  return parts;
}

function isOpen(): boolean {
  return Boolean(parts && parts.overlay.style.display === 'flex');
}

export function loadInputsIntoModal(forceRefresh = false): void {
  const { textarea, errors, info, loading, title } = ensureModal();

  loading.style.display = 'block';
  textarea.style.display = 'none';
  errors.style.display = 'none';
  info.style.display = 'none';
  Object.assign(info.style, INFO_COLORS);

  // Small delay to show loading state
  setTimeout(() => {
    try {
      const inputs = extractAllInputs(forceRefresh);

      if (inputs.length === 0) {
        showMessage(errors, 'Error:', ['No inputs found on this page. Make sure you are on Step 2.'], true);
        textarea.value = '{}';
        title.textContent = 'Edit Input JSON (0 inputs)';
      } else {
        textarea.value = JSON.stringify(generateInputJSON(inputs), null, 2);
        errors.style.display = 'none';

        const mandatoryKeys = inputs.filter((i) => i.mandatory).map((i) => i.key);
        if (mandatoryKeys.length > 0) {
          showMessage(info, `Mandatory fields (${mandatoryKeys.length}):`, mandatoryKeys, true);
        } else {
          info.style.display = 'none';
        }

        title.textContent = `Edit Input JSON (${inputs.length} input${inputs.length !== 1 ? 's' : ''})`;
        log.debug(`Loaded ${inputs.length} inputs into modal`);
      }
    } catch (error) {
      log.error('Error loading inputs into modal:', error);
      showMessage(errors, 'Error:', [error instanceof Error ? error.message : String(error)], true);
    }
    textarea.style.display = 'block';
    loading.style.display = 'none';
  }, 100);
}

export function showModal(): void {
  const { overlay, textarea } = ensureModal();
  loadInputsIntoModal(false);

  const wasOpen = isOpen();
  overlay.style.display = 'flex';
  if (!wasOpen) lockModalInteraction();

  // Focus the textarea once it is shown.
  setTimeout(() => textarea.focus(), 200);
}

export function closeModal(): void {
  if (parts && parts.overlay.style.display !== 'none') {
    parts.overlay.style.display = 'none';
    unlockModalInteraction();
  }
}

export function handleSyncClick(): void {
  const { textarea, errors, info, syncButton } = ensureModal();
  const jsonString = textarea.value;

  const originalText = syncButton.textContent;
  syncButton.textContent = 'Syncing...';
  syncButton.disabled = true;
  errors.style.display = 'none';
  info.style.display = 'none';
  Object.assign(info.style, INFO_COLORS);

  const restoreButton = () => {
    syncButton.textContent = originalText;
    syncButton.disabled = false;
  };

  // Small delay to show loading state
  setTimeout(async () => {
    try {
      const result = await syncJSONToInputs(jsonString);
      restoreButton();

      if (!result.success) {
        showMessage(errors, 'Error:', result.errors || ['Unknown error']);
        return;
      }

      errors.style.display = 'none';
      showToast(result.message || 'Inputs synced successfully!');

      if (result.warnings && result.warnings.length > 0) {
        // Partial success: keep the modal open so the warnings can be read.
        Object.assign(info.style, WARNING_COLORS);
        showMessage(info, 'Warning:', result.warnings);
      } else {
        closeModal();
      }
    } catch (error) {
      restoreButton();
      showMessage(errors, 'Error:', [error instanceof Error ? error.message : 'Unknown error']);
    }
  }, 100);
}
