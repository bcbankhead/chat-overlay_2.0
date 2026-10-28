// Sender colour adaptation, replacing the contrast chip. A sender picks a colour once; each
// theme shows it with enough contrast against its own background:
//   1. Enough contrast already (WCAG >= MIN_CONTRAST) -> shown as chosen.
//   2. Otherwise move its OKLab lightness away from the background, keeping hue and chroma,
//      by the smallest amount that passes: dark blue on the dark theme becomes light blue,
//      hot pink on the light theme a deeper pink.
//   3. A grey or black that fails -> the theme's own text colour.
// Chroma is reduced only as far as needed to stay inside sRGB.

/** @typedef {[number, number, number]} Triple */

export const MIN_CONTRAST = 4.5;
/** Searched-for contrast: a margin over MIN_CONTRAST that survives rounding to hex. */
export const SEARCH_CONTRAST = 4.6;
/** OKLab chroma below which a colour is treated as grey. */
export const NEUTRAL_CHROMA = 0.02;

/**
 * Each theme's `--tdf-bg`, as `theme.css` defines it. Duplicated because the shift is
 * computed in JS; `test/ink.test.js` fails when the two diverge.
 */
export const THEME_BG = /** @type {const} */ ({ light: '#ffffff', dark: '#16191d' });

/**
 * A `#rgb`, `#rrggbb` or `rgb()` colour as sRGB channels in [0, 1], or null. An `rgb()`
 * channel above 255 is clamped, as the browser clamps it when it paints the colour.
 * @param {string} color
 * @returns {Triple | null}
 */
export function parseColor(color) {
  const text = String(color).trim();
  const fn = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(text);
  if (fn) return /** @type {Triple} */ (fn.slice(1, 4).map((v) => Math.min(Number(v), 255) / 255));
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (!hex) return null;
  const h = hex[1].length === 3 ? hex[1].replace(/./g, '$&$&') : hex[1];
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

/** @param {number} c */
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** @param {number} c */
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/**
 * @param {Triple} rgb
 * @returns {Triple}
 */
function rgbToOklab(rgb) {
  const [r, g, b] = /** @type {Triple} */ (rgb.map(toLinear));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/**
 * OKLab to linear sRGB, unclamped (may fall outside [0, 1]).
 * @param {Triple} lab
 * @returns {Triple}
 */
function oklabToLinear([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** @param {Triple} lin */
const inGamut = (lin) => lin.every((c) => c >= -1e-4 && c <= 1 + 1e-4);

/**
 * OKLab lightness, chroma and hue angle to sRGB, shrinking chroma until it fits.
 * @param {number} L
 * @param {number} C
 * @param {number} h
 * @returns {Triple}
 */
function lchToRgb(L, C, h) {
  /** @param {number} c */
  const lab = (c) => oklabToLinear([L, c * Math.cos(h), c * Math.sin(h)]);
  let lin = lab(C);
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(lab(mid))) lo = mid;
      else hi = mid;
    }
    lin = lab(lo);
  }
  return /** @type {Triple} */ (lin.map((c) => toGamma(Math.min(1, Math.max(0, c)))));
}

/**
 * WCAG relative luminance of sRGB channels in [0, 1].
 * @param {Triple} rgb
 */
export function luminance(rgb) {
  const [r, g, b] = rgb.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG contrast ratio of two colours as parsed by `parseColor`.
 * @param {Triple} a
 * @param {Triple} b
 */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** @param {Triple} rgb */
const toHex = (rgb) => `#${rgb.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`;

/**
 * The colour to show for `color` on background `bg`, or '' when the theme's own text
 * colour should be used instead. A colour that does not parse is returned unchanged.
 * @param {string} color
 * @param {string} bg
 * @returns {string}
 */
export function adapt(color, bg) {
  const fg = parseColor(color);
  const back = parseColor(bg);
  if (!fg || !back) return color;
  if (contrastRatio(fg, back) >= MIN_CONTRAST) return color;

  const [L, a, b] = rgbToOklab(fg);
  const C = Math.hypot(a, b);
  const h = Math.atan2(b, a);
  // A grey has no hue to keep; the nearest passing grey reads dimmer than plain text, so it
  // becomes the theme's text colour (black on light is white on dark).
  if (C < NEUTRAL_CHROMA) return '';
  // Move lightness away from the background only as far as contrast needs: the nearest
  // passing L, found by bisection between the chosen L and the far extreme. Where even the
  // extreme falls short, `far` never moves and the extreme is the best there is.
  let near = L;
  let far = luminance(back) < 0.18 ? 1 : 0;
  for (let i = 0; i < 24; i++) {
    const mid = (near + far) / 2;
    if (contrastRatio(lchToRgb(mid, C, h), back) >= SEARCH_CONTRAST) far = mid;
    else near = mid;
  }
  return toHex(lchToRgb(far, C, h));
}
