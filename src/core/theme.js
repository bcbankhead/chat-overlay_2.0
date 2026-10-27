// Light/dark theme: `auto` follows prefers-color-scheme; the toggle cycles
// auto → light → dark and persists the `theme` setting.

const MODES = /** @type {const} */ (['auto', 'light', 'dark']);

/** @typedef {(typeof MODES)[number]} ThemeMode */

/**
 * @param {{ win: Window, settings: import('./settings.js').Settings }} deps
 */
export function createTheme({ win, settings }) {
  const query = win.matchMedia?.('(prefers-color-scheme: dark)');
  /** @type {ThemeMode} */
  let mode = 'auto';
  /** @type {HTMLElement | null} */
  let root = null;
  /** @type {Set<(mode: ThemeMode) => void>} */
  const changed = new Set();

  function apply() {
    if (!root) return;
    const resolved = mode === 'auto' ? (query?.matches ? 'dark' : 'light') : mode;
    root.dataset.theme = resolved;
    for (const fn of changed) fn(mode);
  }

  query?.addEventListener?.('change', () => {
    if (mode === 'auto') apply();
  });

  return {
    /** Read the persisted mode. */
    async load() {
      const stored = await settings.get('theme');
      mode = MODES.includes(stored) ? stored : 'auto';
      apply();
    },

    /** @param {HTMLElement} el the element carrying the theme tokens */
    attach(el) {
      root = el;
      apply();
    },

    /** @param {(mode: ThemeMode) => void} fn */
    onChange(fn) {
      changed.add(fn);
    },

    /** Advance auto → light → dark → auto and persist. */
    async cycle() {
      mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
      apply();
      await settings.set('theme', mode);
    },
  };
}

/** @typedef {ReturnType<typeof createTheme>} Theme */
