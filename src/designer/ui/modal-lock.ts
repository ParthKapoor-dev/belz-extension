/*! belz-singleton: designer/ui/modal-lock */
// Holds module-level state, so it must be bundled exactly once;
// the build fails otherwise. See scripts/check-singletons.mjs.
let lockCount = 0;
let lockedScrollY = 0;
interface SavedBodyStyles {
  overflow: string;
  position: string;
  top: string;
  left: string;
  right: string;
  width: string;
}

let previousBodyStyles: SavedBodyStyles | null = null;
let previousHtmlOverflow = '';

function applyLock(): void {
  const bodyStyle = document.body.style;
  previousBodyStyles = {
    overflow: bodyStyle.overflow,
    position: bodyStyle.position,
    top: bodyStyle.top,
    left: bodyStyle.left,
    right: bodyStyle.right,
    width: bodyStyle.width
  };
  previousHtmlOverflow = document.documentElement.style.overflow;

  lockedScrollY = window.scrollY || window.pageYOffset || 0;

  document.documentElement.style.overflow = 'hidden';
  bodyStyle.overflow = 'hidden';
  bodyStyle.position = 'fixed';
  bodyStyle.top = `-${lockedScrollY}px`;
  bodyStyle.left = '0';
  bodyStyle.right = '0';
  bodyStyle.width = '100%';
}

function releaseLock(): void {
  const bodyStyle = document.body.style;
  if (previousBodyStyles) {
    bodyStyle.overflow = previousBodyStyles.overflow;
    bodyStyle.position = previousBodyStyles.position;
    bodyStyle.top = previousBodyStyles.top;
    bodyStyle.left = previousBodyStyles.left;
    bodyStyle.right = previousBodyStyles.right;
    bodyStyle.width = previousBodyStyles.width;
  }

  document.documentElement.style.overflow = previousHtmlOverflow;
  window.scrollTo(0, lockedScrollY);
}

export function lockModalInteraction(): void {
  lockCount += 1;
  if (lockCount === 1) {
    applyLock();
  }
}

export function unlockModalInteraction(): void {
  if (lockCount === 0) return;
  lockCount -= 1;

  if (lockCount === 0) {
    releaseLock();
  }
}

export function isModalInteractionLocked(): boolean {
  return lockCount > 0;
}

