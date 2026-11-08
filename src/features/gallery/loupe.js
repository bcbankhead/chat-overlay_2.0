// The media popover's magnifier geometry (TDF-0071): where the loupe sits and which part of the
// image it shows, from the cursor and the displayed image's rect. Pure: lightbox.js measures and
// draws. The loupe shows the image at its natural size (1:1), centred on the point under the
// cursor, and past the image's edge it shows the loupe's own fill rather than clamping.

/** The loupe's side, in CSS pixels. */
export const LOUPE_SIZE = 200;

/**
 * @typedef {object} Box
 * @property {number} left
 * @property {number} top
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {object} LoupeInput
 * @property {number} clientX  the cursor, in viewport pixels
 * @property {number} clientY
 * @property {Box} rect  the displayed image's rect, in viewport pixels
 * @property {{ width: number, height: number }} natural  the image's natural pixel size
 * @property {{ left: number, top: number }} origin  the loupe's containing block, in viewport pixels
 */

/**
 * @typedef {object} LoupeFrame
 * @property {number} left  the loupe's top-left, relative to `origin`
 * @property {number} top
 * @property {number} bgX  the background's position inside the loupe
 * @property {number} bgY
 * @property {number} bgW  the background's size: the image's natural size
 * @property {number} bgH
 */

/**
 * The loupe's frame for a cursor over the image, or null when the cursor is not over it or the
 * image has no measurable size.
 * @param {LoupeInput} input
 * @returns {LoupeFrame | null}
 */
export function loupeFrame({ clientX, clientY, rect, natural, origin }) {
  if (!(rect.width > 0 && rect.height > 0 && natural.width > 0 && natural.height > 0)) return null;
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
  const nx = (x * natural.width) / rect.width;
  const ny = (y * natural.height) / rect.height;
  const half = LOUPE_SIZE / 2;
  return {
    left: clientX - origin.left - half,
    top: clientY - origin.top - half,
    bgX: half - nx,
    bgY: half - ny,
    bgW: natural.width,
    bgH: natural.height,
  };
}
