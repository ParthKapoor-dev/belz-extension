/*! belz-singleton: designer/ui/modal-lock */
// Holds module-level state, so it must be bundled exactly once;
// the build fails otherwise. See scripts/check-singletons.mjs.
//
// While any extension modal is open, the page behind it must not scroll, and
// page shortcuts (Run Test, say) must not fire. Every modal takes the lock
// when it opens and releases it when it closes; the lock counts, so nested
// modals (the settings modal over the editor) work.
//
// It also keeps the open modals in order, so only the topmost one answers
// its keys: one Esc closes the settings modal, not the editor under it too.

type SavedStyles = {
  body: Pick<CSSStyleDeclaration, 'overflow' | 'position' | 'top' | 'left' | 'right' | 'width'>;
  htmlOverflow: string;
  scrollY: number;
};

export class ModalLock {
  private count = 0;
  private saved: SavedStyles | null = null;
  /** The modals holding the lock, the most recently opened last. */
  private readonly stack: object[] = [];

  get isLocked(): boolean {
    return this.count > 0;
  }

  /** Take the lock; `owner`, a modal, goes on top of the stack. */
  lock(owner?: object): void {
    this.count += 1;
    if (owner) {
      this.removeOwner(owner);
      this.stack.push(owner);
    }
    if (this.count === 1) this.freezePage();
  }

  /** Release a hold taken by lock(); `owner` leaves the stack. */
  unlock(owner?: object): void {
    if (this.count === 0) return;
    if (owner) this.removeOwner(owner);
    this.count -= 1;
    if (this.count === 0) {
      this.stack.length = 0;
      this.releasePage();
    }
  }

  /** True when `owner` is the most recently opened modal still open. */
  isTopmost(owner: object): boolean {
    return this.stack.length > 0 && this.stack[this.stack.length - 1] === owner;
  }

  private removeOwner(owner: object): void {
    const i = this.stack.indexOf(owner);
    if (i !== -1) this.stack.splice(i, 1);
  }

  private freezePage(): void {
    const body = document.body.style;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    this.saved = {
      body: {
        overflow: body.overflow,
        position: body.position,
        top: body.top,
        left: body.left,
        right: body.right,
        width: body.width
      },
      htmlOverflow: document.documentElement.style.overflow,
      scrollY
    };

    document.documentElement.style.overflow = 'hidden';
    body.overflow = 'hidden';
    body.position = 'fixed';
    body.top = `-${scrollY}px`;
    body.left = '0';
    body.right = '0';
    body.width = '100%';
  }

  private releasePage(): void {
    if (!this.saved) return;
    Object.assign(document.body.style, this.saved.body);
    document.documentElement.style.overflow = this.saved.htmlOverflow;
    window.scrollTo(0, this.saved.scrollY);
    this.saved = null;
  }
}

/** The one lock shared by every modal on the page. */
export const modalLock = new ModalLock();
