// Profile feature entry (auto-discovered by build.mjs): the sidebar's person icon, opening
// your status, eCredits and text style (flyout.js). Registered through the rail's
// registerRailPanel, so it appears whenever the rail mounts. See startProfile in flyout.js.

import { themeInk } from '../../core/ink.js';
import { chat2Off } from '../../core/optOut.js';
import { currentTheme, onThemeChange } from '../../core/shell.js';
import { expectReady } from '../../core/reveal.js';
import { registerRailPanel } from '../rail/api.js';
import { startProfile } from './flyout.js';
import { PROFILE_ICON } from './icon.js';
import css from './profile.css';

// Registers its panel at once; the rail's own readiness covers when the panel shows. The flag
// is read first (startProfile sets it), so a second copy touches nothing past it; turned off
// (TDF-0037), nothing starts.
if (!(/** @type {any} */ (window).__tdfChat2Profile) && !chat2Off(window)) {
  const done = expectReady('profile');
  try {
    startProfile({
      win: window,
      doc: document,
      css,
      icon: PROFILE_ICON,
      register: registerRailPanel,
      currentTheme,
      onThemeChange,
      shift: themeInk,
    });
  } finally {
    done();
  }
}
