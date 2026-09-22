import { describe, expect, test } from 'bun:test';
import { decodeAutofillParam } from '../../../src/designer/features/curl-autofill/index';
import { AUTOFILL_PARAM } from '../../../src/config/endpoints';
import { extractMethodName, extractPageName, extractServiceCategory } from '../../../src/designer/utils/dom';

describe('decodeAutofillParam', () => {
  const encode = (s: string) => `?${AUTOFILL_PARAM}=${encodeURIComponent(btoa(s))}`;

  test('returns the JSON body carried in the URL', () => {
    expect(decodeAutofillParam(encode('{"a":1}'))).toBe('{"a":1}');
  });

  test('absent, not base64, or not JSON -> null', () => {
    expect(decodeAutofillParam('?other=1')).toBeNull();
    expect(decodeAutofillParam(`?${AUTOFILL_PARAM}=%%%`)).toBeNull();
    expect(decodeAutofillParam(encode('not json'))).toBeNull();
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
