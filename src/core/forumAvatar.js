// The phpBB forum side of the avatar fallback (TDF-0013): where a user's profile page is and
// which picture it shows. Pure: the fetch and the cache are avatarResolver.js's.
// Markup is phpBB's prosilver profile (memberlist_view.html): a `#viewprofile` form, the
// picture as `img.avatar` inside `.profile-avatar`; some styles show `no_avatar.*` for none.

/**
 * A user's profile URL on the forum: `u=<userID>` when the id is known, otherwise
 * `un=<name>`, on the engine's own `profileUrl` (`memberlist.php?mode=viewprofile&u=`).
 * Null when `profileUrl` is missing or no id or name is given.
 * @param {unknown} profileUrl the engine global, e.g. `https://…/memberlist.php?mode=viewprofile&u=`
 * @param {string} base        the page URL relative URLs resolve against
 * @param {{ userID?: string, name?: string }} who the name decoded
 * @returns {string | null}
 */
export function profileUrlFor(profileUrl, base, { userID = '', name = '' }) {
  if (typeof profileUrl !== 'string' || !profileUrl) return null;
  /** @type {URL} */
  let url;
  try {
    url = new URL(profileUrl, base);
  } catch {
    return null;
  }
  url.searchParams.set('mode', 'viewprofile');
  if (userID) {
    url.searchParams.delete('un');
    url.searchParams.set('u', userID);
  } else if (name) {
    url.searchParams.delete('u');
    url.searchParams.set('un', name);
  } else {
    return null;
  }
  return url.href;
}

/**
 * The picture a fetched profile page shows: its absolute URL, null when the profile has
 * none, or undefined when the page is not a profile at all (a login page, an error page),
 * which is a failed lookup rather than an answer.
 * @param {Document} doc the parsed profile page
 * @param {string} pageUrl the URL it was fetched from, for resolving the picture's src
 * @returns {string | null | undefined}
 */
export function parseProfileAvatar(doc, pageUrl) {
  const profile = doc.querySelector('#viewprofile');
  if (!profile) return undefined;
  // Only inside the profile: every forum page's header carries the viewer's own img.avatar.
  const img = profile.querySelector('.profile-avatar img') ?? profile.querySelector('img.avatar');
  const src = img?.getAttribute('src')?.trim();
  if (!src || /(?:^|[/_])no_avatar\b/i.test(src)) return null;
  try {
    const url = new URL(src, pageUrl);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}
