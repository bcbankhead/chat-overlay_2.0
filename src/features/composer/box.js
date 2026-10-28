// The message box's text colour: your chosen colour shifted for the current theme by the same
// rule as messages (ink.js). The engine's changeMessBoxStyle writes textColor straight into the
// box's inline style, so it is wrapped — by this slice alone (TDF-0009 Shared Contract, Single
// wrappers) — and the shift re-applied after it, and on every theme switch. The chosen colour
// is always read from the engine's textColor, never back from the box, so the shown colour is
// never mistaken for the chosen one.

import { adapt, THEME_BG } from '../../core/ink.js';
import { currentTheme, onThemeChange } from '../../core/shell.js';

/** @param {HTMLTextAreaElement} bar */
export function installBox(bar) {
  const win = /** @type {any} */ (window);

  const apply = () => {
    const theme = currentTheme();
    const chosen = win.textColor;
    if (!theme || typeof chosen !== 'string' || !chosen) return;
    // '' is a grey that fails contrast: the theme's own text colour stands in.
    bar.style.color = adapt(chosen, THEME_BG[theme]) || 'var(--tdf-fg)';
  };

  const original = win.changeMessBoxStyle;
  if (typeof original === 'function') {
    win.changeMessBoxStyle = function (/** @type {unknown} */ div, /** @type {unknown[]} */ ...rest) {
      const result = original.call(this, div, ...rest);
      // Private boxes (poptionsBar_*) keep the engine's own styling.
      if (div === bar.id) apply();
      return result;
    };
  }
  onThemeChange(apply);
  apply();
}
