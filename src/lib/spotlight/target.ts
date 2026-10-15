// Finding the element a step lights: `[data-spotlight~="key"]`, the first one that is actually on the screen. A key may be on several
// elements (the sidebar link and the phone's menu link share one), so hidden ones (display:none, zero size) are not "there".
// The waiting is written against small injected pieces so it can be tested with a fake clock and a fake page.

export const SPOTLIGHT_ATTRIBUTE = "data-spotlight";

/** How long a step waits for its target before it says it is not there (route changes and server rendering included). */
export const TARGET_WAIT_MS = 6000;

const KEY = /^[A-Za-z0-9][A-Za-z0-9:_-]*$/;

export function isValidKey(key: string): boolean {
  return KEY.test(key);
}

/** The CSS selector for a key. `~=` means a value may hold several keys separated by spaces. */
export function selectorFor(key: string): string {
  if (!isValidKey(key)) throw new Error(`"${key}" is not a valid data-spotlight key`);
  return `[${SPOTLIGHT_ATTRIBUTE}~="${key}"]`;
}

export type WaitDeps<E> = {
  /** The first visible element for the key right now, or null. */
  find: () => E | null;
  /** Calls back whenever the page changes (a MutationObserver in the browser). Returns the way to stop. */
  watch: (onChange: () => void) => () => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

/**
 * Looks for the element now and again after every change of the page until it shows up or `timeoutMs` has passed.
 * `done` is called exactly once (with null when it never appeared). Returns a function that stops the wait without calling `done`.
 */
export function waitForTarget<E>(deps: WaitDeps<E>, done: (found: E | null) => void, timeoutMs: number = TARGET_WAIT_MS): () => void {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let finished = false;
  let stopWatching: (() => void) | null = null;
  let timer: unknown = null;

  const finish = (found: E | null) => {
    if (finished) return;
    finished = true;
    stopWatching?.();
    if (timer !== null) clearTimer(timer);
    done(found);
  };

  const first = deps.find();
  if (first) {
    finish(first);
    return () => {};
  }
  stopWatching = deps.watch(() => {
    const el = deps.find();
    if (el) finish(el);
  });
  // A page that reported a change while the watch was being set up has already finished the wait.
  if (finished) {
    stopWatching();
    return () => {};
  }
  timer = setTimer(() => finish(deps.find()), timeoutMs);
  return () => {
    if (finished) return;
    finished = true;
    stopWatching?.();
    if (timer !== null) clearTimer(timer);
  };
}
