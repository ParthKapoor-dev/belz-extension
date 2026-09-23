import { describe, expect, test } from 'bun:test';
import { parseAutofillFragment } from '../../../src/designer/features/curl-autofill/index';
import { AUTOFILL_FRAGMENT_PARAM } from '../../../src/config/namespace';
import { extractMethodName, extractPageName, extractServiceCategory } from '../../../src/designer/utils/dom';

describe('parseAutofillFragment', () => {
  const P = AUTOFILL_FRAGMENT_PARAM;

  test('finds the handoff id and leaves nothing behind when it was alone', () => {
    expect(parseAutofillFragment(`#${P}=abc`)).toEqual({ id: 'abc', rest: '' });
  });

  test('removes only its own parameter, keeping the rest of the fragment in order', () => {
    expect(parseAutofillFragment(`#tab=2&${P}=abc&x=1`)).toEqual({ id: 'abc', rest: '#tab=2&x=1' });
  });

  test('no marker: no id, and the fragment untouched', () => {
    expect(parseAutofillFragment('#tab=2')).toEqual({ id: null, rest: '#tab=2' });
    expect(parseAutofillFragment('')).toEqual({ id: null, rest: '' });
  });

  test('an empty id is no id', () => {
    expect(parseAutofillFragment(`#${P}=`).id).toBeNull();
  });
});

describe('page name helpers', () => {
  test('AD method name and category', () => {
    document.body.innerHTML =
      '<input id="SD1_MethodName" value="  getUser "><div class="block_sub_head"> Users </div>';
    expect(extractMethodName()).toBe('getUser');
    expect(extractServiceCategory()).toBe('Users');
  });

  test('PD page title, falling back to a symbol title', () => {
    document.body.innerHTML = '<div class="symbol_title"> header </div>';
    expect(extractPageName()).toBe('header');
    document.body.innerHTML = '<div class="page_title">Home</div><div class="symbol_title">x</div>';
    expect(extractPageName()).toBe('Home');
  });

  test('nothing on the page -> null', () => {
    document.body.innerHTML = '';
    expect(extractMethodName()).toBeNull();
    expect(extractPageName()).toBeNull();
    expect(extractServiceCategory()).toBeNull();
  });
});
