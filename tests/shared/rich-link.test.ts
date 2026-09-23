import { describe, expect, test } from 'bun:test';
import { escapeHtml, richLink } from '../../src/shared/rich-link';

describe('richLink', () => {
  test('an HTML link and a Markdown link to the same place', () => {
    expect(richLink('Users::getUser', 'https://site.test/automation-designer/Users/u1')).toEqual({
      html: '<a href="https://site.test/automation-designer/Users/u1">Users::getUser</a>',
      plain: '[Users::getUser](https://site.test/automation-designer/Users/u1)'
    });
  });

  test('a label or URL from the page cannot inject markup', () => {
    const { html } = richLink('<img src=x onerror=alert(1)>', 'https://site.test/a"b<c');
    expect(html).toBe('<a href="https://site.test/a&quot;b&lt;c">&lt;img src=x onerror=alert(1)&gt;</a>');
  });

  test('a URL that is not a web link is not made a link', () => {
    expect(richLink('x', 'javascript:alert(1)')).toEqual({ html: 'x', plain: 'x' });
  });
});

describe('escapeHtml', () => {
  test('escapes the five significant characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});
