/*! belz-singleton: designer/core/state */
// Holds module-level state, so it must be bundled exactly once;
// the build fails otherwise. See scripts/check-singletons.mjs.
// Global state management
import type { ExtractedInput } from '../features/json-editor/types';

interface DesignerState {
  /** The last name the title updater wrote, so it only writes on change. */
  lastMethodName: string | null;
  toastEl: HTMLDivElement | null;
  toastTimeout: ReturnType<typeof setTimeout> | null;
  /** The JSON input editor's overlay. */
  modalEl: HTMLDivElement | null;
  jsonButtonEl: HTMLButtonElement | null;
  textareaEditorModalEl: HTMLDivElement | null;
  /** The page textarea the large editor is editing. */
  textareaEditorSourceEl: HTMLTextAreaElement | null;
  cachedInputs: ExtractedInput[] | null;
  lastInputScanTime: number;
}

export const state: DesignerState = {
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
