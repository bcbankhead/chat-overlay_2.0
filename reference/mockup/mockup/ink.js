// Sender colour adaptation (harness only), replacing the contrast chip. A sender picks a
// colour once; each theme shows it with enough contrast against its own background:
//   1. Enough contrast already (WCAG >= MIN_CONTRAST) -> shown as chosen.
//   2. Otherwise move its OKLab lightness away from the background, keeping hue and
//      chroma, by the smallest amount that passes: dark blue on the dark theme becomes
//      light blue, hot pink on the light theme a deeper pink.
//   3. A grey or black that fails -> the theme's own text colour.
// Chroma is reduced only as far as needed to stay inside sRGB.
window.__ink = (function () {
  var MIN_CONTRAST = 4.5;
  /** Searched-for contrast: a margin over MIN_CONTRAST that survives rounding to hex. */
  var SEARCH_CONTRAST = 4.6;
  /** OKLab chroma below which a colour is treated as grey. */
  var NEUTRAL_CHROMA = 0.02;

  function parse(color) {
    var m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(color);
    if (m) return [+m[1] / 255, +m[2] / 255, +m[3] / 255];
    m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
    if (!m) return null;
    var h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
    return [0, 2, 4].map(function (i) { return parseInt(h.slice(i, i + 2), 16) / 255; });
  }

  function toLinear(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function toGamma(c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }

  function rgbToOklab(rgb) {
    var r = toLinear(rgb[0]), g = toLinear(rgb[1]), b = toLinear(rgb[2]);
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    var m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    var s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  }

  /** OKLab to linear sRGB, unclamped (may fall outside [0, 1]). */
  function oklabToLinear(lab) {
    var l = Math.pow(lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2], 3);
    var m = Math.pow(lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2], 3);
    var s = Math.pow(lab[0] - 0.0894841775 * lab[1] - 1.291485548 * lab[2], 3);
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
  }

  function inGamut(lin) {
    return lin.every(function (c) { return c >= -1e-4 && c <= 1 + 1e-4; });
  }

  /** L, chroma and hue angle to sRGB, shrinking chroma until it fits. */
  function lchToRgb(L, C, h) {
    var lo = 0, hi = C, lin = oklabToLinear([L, C * Math.cos(h), C * Math.sin(h)]);
    if (!inGamut(lin)) {
      for (var i = 0; i < 20; i++) {
        var mid = (lo + hi) / 2;
        if (inGamut(oklabToLinear([L, mid * Math.cos(h), mid * Math.sin(h)]))) lo = mid;
        else hi = mid;
      }
      lin = oklabToLinear([L, lo * Math.cos(h), lo * Math.sin(h)]);
    }
    return lin.map(function (c) { return toGamma(Math.min(1, Math.max(0, c))); });
  }

  function luminance(rgb) {
    var lin = rgb.map(toLinear);
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  }

  function contrast(a, b) {
    var la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  function hex(rgb) {
    return '#' + rgb.map(function (c) { return Math.round(c * 255).toString(16).padStart(2, '0'); }).join('');
  }

  /**
   * The colour to show for `color` on background `bg` (both CSS colours), or '' when the
   * theme's own text colour should be used instead.
   */
  function adapt(color, bg) {
    var fg = parse(color), back = parse(bg);
    if (!fg || !back) return color;
    if (contrast(fg, back) >= MIN_CONTRAST) return color;

    var lab = rgbToOklab(fg);
    var C = Math.hypot(lab[1], lab[2]);
    var h = Math.atan2(lab[2], lab[1]);
    // A grey has no hue to keep; the nearest passing grey reads dimmer than plain text,
    // so it becomes the theme's text colour (black on light is white on dark).
    if (C < NEUTRAL_CHROMA) return '';
    // Move lightness away from the background only as far as contrast needs: the
    // nearest passing L, found by bisection between the chosen L and the far extreme.
    var darkBg = luminance(back) < 0.18;
    var near = lab[0];
    var far = darkBg ? 1 : 0;
    if (contrast(lchToRgb(far, C, h), back) < SEARCH_CONTRAST) return hex(lchToRgb(far, C, h));
    for (var i = 0; i < 24; i++) {
      var mid = (near + far) / 2;
      if (contrast(lchToRgb(mid, C, h), back) >= SEARCH_CONTRAST) far = mid;
      else near = mid;
    }
    return hex(lchToRgb(far, C, h));
  }

  return { adapt: adapt, contrast: function (a, b) { return contrast(parse(a), parse(b)); } };
})();
