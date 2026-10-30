// Floating-scrollbar thumb geometry: pure, so shell.js only measures and draws.

/**
 * Where the thumb sits within a scroll area, or null when nothing overflows. `offset` is
 * from the top of the visible area; the caller adds scrollTop when the thumb lives inside
 * the scrolled content.
 * @param {{ view: number, total: number, scrollTop: number, inset: number, min: number }} area
 * @returns {{ height: number, offset: number } | null}
 */
export function thumbGeometry({ view, total, scrollTop, inset, min }) {
  if (total <= view + 1) return null;
  const track = view - inset * 2;
  const height = Math.min(track, Math.max(min, (track * view) / total));
  const progress = Math.min(1, Math.max(0, scrollTop / (total - view)));
  return { height, offset: inset + (track - height) * progress };
}
