// Shift+L on Automation Designer pages: copy a `category::method` link to the
// open method, which pastes as a clickable link in Slack and docs.
import { copyRichLink } from '../../../shared/rich-link';
import { extractMethodName, extractServiceCategory } from '../../utils/dom';
import { toast } from '../../ui/toast';

export async function copyAdRichLink(): Promise<void> {
  const label = [extractServiceCategory(), extractMethodName()].filter(Boolean).join('::');
  try {
    const kind = await copyRichLink(label, window.location.href);
    toast.show(kind === 'rich' ? `Copied: ${label}` : 'Copied link (plain)');
  } catch {
    toast.show('Failed to copy link');
  }
}
