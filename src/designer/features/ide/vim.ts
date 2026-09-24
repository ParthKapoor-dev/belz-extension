/*! belz-singleton: designer/features/ide/vim */
// Holds module-level state, so it must be bundled exactly once;
// the build fails otherwise. See scripts/check-singletons.mjs.
//
// Vim mode for the IDE (the IDE Vim Mode setting): @replit/codemirror-vim and
// what ties it to the IDE. Its own chunk: modal.ts reaches it only through
// import('./vim'), and only while the setting is on, so with the setting off
// this code is never fetched.
//
// The library keeps one global Vim state per page (registers, ex commands,
// options). This module adds to it once, on first load: the IDE's ex commands
// (:w, :q, :q!, :wq, :x) and the clipboard sync of the unnamed register.
// Which IDE an ex command or a yank belongs to is looked up by its view.
import { Vim, getCM, vim } from '@replit/codemirror-vim';
import { EditorView, ViewPlugin, drawSelection } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { T } from '../../ui/theme';

/** What Vim mode needs from the IDE that owns a view. */
export interface VimHost {
  /** `:w`: write the text back to the source, and stay open. */
  write(): void;
  /** `:q`: close, asking first when there are unsaved changes (like Esc). */
  quit(): void;
  /** `:q!`: close, dropping unsaved changes. */
  quitDiscarding(): void;
  /** `:wq`: write and close. */
  writeQuit(): void;
  /** `:x`: write and close when there are unsaved changes, else just close. */
  exit(): void;
  /** Text Vim put in its unnamed register, for the system clipboard. */
  copy(text: string): void;
  /** The mode line changed (`-- NORMAL --`, `-- INSERT --`, …, plus pending keys). */
  modeChanged(line: string): void;
}

/** A Vim state the IDE can read: what Esc should do. */
export interface VimKeyState {
  /** Insert or replace mode. */
  insert: boolean;
  visual: boolean;
  /** A count, register, operator or partial command is typed but not done. */
  pending: boolean;
  /** The `:` or `/` prompt is open. */
  prompt: boolean;
}

/** The IDE of each view with Vim on. */
const hosts = new WeakMap<EditorView, VimHost>();
/** The IDEs with a Vim view now (one per page), for register writes, which belong to no view. */
const liveHosts = new Set<VimHost>();

type CodeMirrorAdapter = NonNullable<ReturnType<typeof getCM>>;
type VimState = CodeMirrorAdapter['state']['vim'];

function hostOf(cm: CodeMirrorAdapter): VimHost | undefined {
  return hosts.get(cm.cm6);
}

/**
 * Ex commands run from inside the library's own key handling, which still
 * uses the editor after the command returns: close the IDE (and destroy the
 * view) only once it has finished.
 */
function later(action: () => void): void {
  queueMicrotask(action);
}

/** `:q!` and the like: an argument that is just a bang. */
function hasBang(params: { argString?: string }): boolean {
  return (params.argString ?? '').trim().startsWith('!');
}

// The IDE's ex commands. `:w` replaces the library's own (which saves a
// CodeMirror 5 textarea the IDE does not have); the others are new.
Vim.defineEx('write', 'w', (cm) => {
  const host = hostOf(cm);
  if (host) later(() => host.write());
});
Vim.defineEx('quit', 'q', (cm, params) => {
  const host = hostOf(cm);
  if (host) later(() => (hasBang(params) ? host.quitDiscarding() : host.quit()));
});
Vim.defineEx('wq', 'wq', (cm) => {
  const host = hostOf(cm);
  if (host) later(() => host.writeQuit());
});
Vim.defineEx('xit', 'x', (cm) => {
  const host = hostOf(cm);
  if (host) later(() => host.exit());
});

type RegisterController = ReturnType<typeof Vim.getRegisterController>;

/** The register controller whose writes go to the clipboard. */
const syncedControllers = new WeakSet<RegisterController>();

/**
 * Should a write to Vim's registers also go to the system clipboard? Like
 * Vim's `clipboard=unnamedplus`: every yank, delete and change that names no
 * register (y, yy, yiw, visual y, d, dd, x, c, s, …), and `:yank` (which
 * names register 0 itself). Not the black hole `"_`, not a named register
 * (`"ay`), and not `"+`, which the library already writes to the clipboard
 * itself.
 */
export function copiesToClipboard(registerName: string | null | undefined, operator: string): boolean {
  if (operator !== 'yank' && operator !== 'delete' && operator !== 'change') return false;
  return !registerName || (operator === 'yank' && registerName === '0');
}

/**
 * Send register writes to the clipboard. The library has no hook for this:
 * defineRegister() cannot replace the unnamed register (it refuses a name
 * that exists), so the one write path every operator goes through, the
 * controller's pushText(), is wrapped on the instance the public
 * Vim.getRegisterController() returns. The text copied is what the unnamed
 * register then holds, so the clipboard gets exactly what `p` would paste
 * (a linewise yank ends in a newline).
 */
function syncClipboard(): void {
  const controller = Vim.getRegisterController();
  if (syncedControllers.has(controller)) return;
  syncedControllers.add(controller);
  const pushText = controller.pushText.bind(controller);
  controller.pushText = (registerName, operator, text, linewise, blockwise) => {
    pushText(registerName, operator, text, linewise, blockwise);
    if (!copiesToClipboard(registerName, operator)) return;
    // The registers belong to the page, not to a view: the copy goes
    // through the IDE that has Vim on (there is one IDE per page).
    const copied = controller.unnamedRegister.toString();
    for (const host of liveHosts) {
      host.copy(copied);
      break;
    }
  };
}

/** The mode line for a Vim state: `-- NORMAL --`, `-- VISUAL LINE --`, plus pending keys. */
export function modeLine(state: VimState | undefined): string {
  if (!state) return '';
  const mode = (state.mode || 'normal').toUpperCase();
  const pending = state.insertMode ? '' : (state.status || '').trim();
  return pending ? `-- ${mode} --  ${pending}` : `-- ${mode} --`;
}

/** What Esc should do in `view`: null when Vim is not on in it. */
export function vimKeyState(view: EditorView): VimKeyState | null {
  const cm = getCM(view);
  const state = cm?.state.vim;
  if (!cm || !state) return null;
  const input = state.inputState;
  const pending = !!input && (
    input.keyBuffer.length > 0
    || input.prefixRepeat.length > 0
    || input.motionRepeat.length > 0
    || !!input.operator
    || !!input.registerName
  );
  return {
    insert: !!state.insertMode,
    visual: !!state.visualMode,
    pending,
    prompt: !!cm.state.dialog
  };
}

/** Follows one view's Vim state: registers its host, and reports mode changes. */
class VimBridge {
  private readonly cm: CodeMirrorAdapter | null;
  private readonly report = (): void => {
    this.host.modeChanged(modeLine(this.cm?.state.vim));
  };

  constructor(private readonly view: EditorView, private readonly host: VimHost) {
    // vim() comes first in the extension list, so its plugin (and the
    // adapter getCM returns) exists by the time this one is built.
    this.cm = getCM(view);
    hosts.set(view, host);
    liveHosts.add(host);
    syncClipboard();
    if (!this.cm) return;
    this.cm.on('vim-mode-change', this.report);
    this.cm.on('vim-keypress', this.report);
    this.cm.on('vim-command-done', this.report);
    this.report();
  }

  destroy(): void {
    this.cm?.off('vim-mode-change', this.report);
    this.cm?.off('vim-keypress', this.report);
    this.cm?.off('vim-command-done', this.report);
    hosts.delete(this.view);
    liveHosts.delete(this.host);
    this.host.modeChanged('');
  }
}

/**
 * The block cursor in the IDE's colours: the library's pink one is hard to
 * read over light text. The letter under it keeps its own colour.
 */
const cursorTheme = EditorView.theme({
  '.cm-fat-cursor': {
    background: `${T.accent} !important`
  },
  '&:not(.cm-focused) .cm-fat-cursor': {
    background: 'none !important',
    outline: `solid 1px ${T.accent} !important`
  }
});

/**
 * Vim mode for one IDE view. Goes first in the view's extensions (the
 * library needs its keys handled before any other keymap). drawSelection()
 * is part of it because Vim mode hides the browser's own selection, so a
 * visual selection must be drawn.
 */
export function vimExtension(host: VimHost): Extension {
  return [
    vim(),
    drawSelection(),
    cursorTheme,
    ViewPlugin.define((view) => new VimBridge(view, host))
  ];
}
