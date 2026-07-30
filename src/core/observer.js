import { OBSERVER_OPTIONS } from '../config/constants.js';

// The MutationObserver only watches document.body, so changes inside a shadow
// root never reach it. The poll is the safety net for those — but it used to
// run every subscriber unconditionally once a second, which on a large method
// meant re-scanning the whole page forever, even while the user did nothing.
//
// It now checks a cheap fingerprint first and skips the work when the DOM has
// not actually changed, on a longer interval since it is only a fallback.
const POLL_FALLBACK_MS = 2000;

let observer = null;
let pollTimer = null;
let lastFingerprint = -1;
const subscribers = new Set();

function fireAll() {
  for (const callback of subscribers) {
    try {
      callback();
    } catch (error) {
      console.error('Observer subscriber failed:', error);
    }
  }
}

// Reading the length of the live "all elements" collection is far cheaper than
// querySelectorAll('*'), which materialises an array of every node. It misses
// same-size swaps, which is acceptable for a fallback: the MutationObserver
// already covers the light DOM, and a shadow-root edit that leaves the element
// count identical is picked up by the next structural change.
function domFingerprint() {
  try {
    return document.getElementsByTagName('*').length;
  } catch {
    return -1;
  }
}

function pollTick() {
  const fingerprint = domFingerprint();
  if (fingerprint === lastFingerprint) return;
  lastFingerprint = fingerprint;
  fireAll();
}

// Keep the fingerprint current so the poll does not redo work the observer has
// already triggered.
function onMutations() {
  lastFingerprint = domFingerprint();
  fireAll();
}

export function subscribeObserver(callback) {
  subscribers.add(callback);

  if (!observer) {
    observer = new MutationObserver(onMutations);
    observer.observe(document.body, OBSERVER_OPTIONS);
  }

  if (!pollTimer) {
    lastFingerprint = domFingerprint();
    pollTimer = setInterval(pollTick, POLL_FALLBACK_MS);
  }

  try {
    callback();
  } catch (error) {
    console.error('Observer subscriber failed on initial call:', error);
  }

  return () => unsubscribeObserver(callback);
}

export function unsubscribeObserver(callback) {
  subscribers.delete(callback);

  if (subscribers.size === 0) {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }
}
