// A link that pastes as a clickable label in Slack and docs (text/html), and
// as Markdown where only plain text is accepted. Used by the Shift+L shortcut
// on AD pages and by the AD Network panel's "Copy Slack link".
//
// The label comes from the page or the platform API (a method or category
// name), so it is escaped before it goes into HTML: a name like
// `<img onerror=…>` must paste as text, not markup.

/** `text` with the five HTML-significant characters escaped. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The two clipboard forms of a link to `url` labelled `label`. */
export function richLink(label: string, url: string): { html: string; plain: string } {
  // Only web links: anything else (javascript:, data:) is written as text.
  const safeUrl = /^https?:\/\//i.test(url) ? url : '';
  const html = safeUrl
    ? `<a href="${escapeHtml(safeUrl)}">${escapeHtml(label)}</a>`
    : escapeHtml(label);
  return { html, plain: safeUrl ? `[${label}](${safeUrl})` : label };
}

/**
 * Put the link on the clipboard: both forms where the browser allows it,
 * else the Markdown form. Resolves 'rich' or 'plain' for what was written;
 * rejects when neither could be.
 */
export async function copyRichLink(label: string, url: string): Promise<'rich' | 'plain'> {
  const { html, plain } = richLink(label, url);
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' })
      })
    ]);
    return 'rich';
  } catch {
    await navigator.clipboard.writeText(plain);
    return 'plain';
  }
}
