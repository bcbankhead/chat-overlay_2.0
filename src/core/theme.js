// Light/dark theme on <html> as data-tdf-theme. The `theme` setting holds the chosen
// selector, never resolved colours: null follows prefers-color-scheme live until the first
// toggle stores 'light' or 'dark'. Every switch after the first apply cross-fades.

/** @typedef {'light' | 'dark'} ResolvedTheme */

// On <html> while a switch cross-fades; theme.css transitions every colour under it.
export const FADE_CLASS = 'tdf-theme-fading';
// The CSS transition is 300 ms; the class stays a little longer so it ends cleanly.
const FADE_MS = 450;

/**
 * @param {{ win: Window, settings: import('./settings.js').Settings, root: HTMLElement }} deps
 */
export function createTheme({ win, settings, root }) {
  const query = win.matchMedia?.('(prefers-color-scheme: dark)');
  const reduced = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  /** @type {ResolvedTheme | null} */
  let stored = null;
  /** @type {ResolvedTheme | null} */
  let applied = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let fadeTimer;
  /** @type {Set<(theme: ResolvedTheme) => void>} */
  const changed = new Set();

  /** @returns {ResolvedTheme} */
  const resolved = () => stored ?? (query?.matches ? 'dark' : 'light');

  function fade() {
    if (reduced?.matches) return;
    root.classList.add(FADE_CLASS);
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => root.classList.remove(FADE_CLASS), FADE_MS);
  }

  function apply() {
    const next = resolved();
    if (next === applied) return;
    if (applied !== null) fade();
    applied = next;
    root.dataset.tdfTheme = next;
    for (const fn of changed) fn(next);
  }

  const onScheme = () => {
    if (stored === null) apply();
  };
  query?.addEventListener?.('change', onScheme);

  return {
    /** Read the stored choice; anything but 'light' or 'dark' (a legacy 'auto') is none. */
    async load() {
      const value = await settings.get('theme');
      stored = value === 'light' || value === 'dark' ? value : null;
      apply();
    },

    /** Flip the resolved theme and persist the choice. */
    async toggle() {
      stored = resolved() === 'dark' ? 'light' : 'dark';
      apply();
      await settings.set('theme', stored);
    },

    /**
     * @param {(theme: ResolvedTheme) => void} fn called with the resolved theme on each switch
     * @returns {() => void} off
     */
    onChange(fn) {
      changed.add(fn);
      return () => {
        changed.delete(fn);
      };
    },

    /** The applied theme, or null before load. */
    current() {
      return applied;
    },

    /** Stop following the system and fading; for a start that failed. */
    stop() {
      query?.removeEventListener?.('change', onScheme);
      clearTimeout(fadeTimer);
      changed.clear();
    },
  };
}

/** @typedef {ReturnType<typeof createTheme>} Theme */
