/*! belz-singleton: designer/core/state */
// Holds module-level state, so it must be bundled exactly once;
// the build fails otherwise. See scripts/check-singletons.mjs.
// Global state management
export const state = {
  lastMethodName: null,
  toastEl: null,
  toastTimeout: null,
  modalEl: null,
  jsonButtonEl: null,
  textareaEditorModalEl: null,
  textareaEditorSourceEl: null,
  cachedInputs: null,
  lastInputScanTime: 0
};
