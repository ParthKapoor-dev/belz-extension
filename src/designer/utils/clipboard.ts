import { EXTENSION_OWNED_ATTR } from '../../config/namespace';
import { createLogger } from '../../shared/logger';

const log = createLogger('clipboard');

export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      log.debug('Navigator clipboard copy failed, using fallback:', error);
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute(EXTENSION_OWNED_ATTR, 'true');

  Object.assign(textarea.style, {
    position: 'fixed',
    top: '-1000px',
    left: '-1000px',
    opacity: '0'
  });

  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch (error) {
    log.error('Clipboard fallback copy failed:', error);
  }

  textarea.remove();
  return copied;
}
