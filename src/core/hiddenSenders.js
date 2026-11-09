// Hidden senders (TDF-0082): Settings' Hide messages by user is a reversible filter, not a
// deletion. The set holds raw stored senders, the value the messages store's user index holds,
// and is stored as the `hiddenSenders` setting. `hidesLine` is the one predicate deciding whether
// a line is hidden; the view applies it to every row it renders. Saved lines are kept.

/** Kinds a hidden sender's lines are hidden for; entry and exit lines stay. */
const HIDDEN_KINDS = new Set(['public', 'whisper']);

/**
 * The list with `user` added when absent, or removed when present: a new array, sorted and
 * deduplicated. The given list is not changed.
 * @param {readonly string[]} list
 * @param {string} user  the raw stored sender
 * @returns {string[]}
 */
export function toggleHidden(list, user) {
  const set = new Set(list);
  if (set.has(user)) set.delete(user);
  else set.add(user);
  return [...set].sort();
}

/**
 * Whether a line is hidden: a public message or whisper whose sender is in the set.
 * @param {{ kind: string, user: string }} record
 * @param {ReadonlySet<string>} hidden
 */
export function hidesLine(record, hidden) {
  return HIDDEN_KINDS.has(record.kind) && hidden.has(record.user);
}

/**
 * A stored setting value as a list of senders: anything but an array of strings reads as none.
 * @param {unknown} value
 * @returns {string[]}
 */
export function parseHidden(value) {
  return Array.isArray(value) ? value.filter((user) => typeof user === 'string') : [];
}

/**
 * @typedef {{ user: string, count: number, hidden: boolean }} PickerEntry
 */

/**
 * The sender picker's entries: every sender with saved lines, plus every hidden sender with
 * none (count 0), each flagged `hidden`. Senders keep their given order; hidden senders with no
 * lines follow, sorted.
 * @param {ReadonlyArray<{ user: string, count: number }>} senders
 * @param {ReadonlySet<string>} hidden
 * @returns {PickerEntry[]}
 */
export function pickerEntries(senders, hidden) {
  /** @type {PickerEntry[]} */
  const out = senders.map(({ user, count }) => ({ user, count, hidden: hidden.has(user) }));
  const listed = new Set(senders.map((s) => s.user));
  for (const user of [...hidden].sort()) {
    if (!listed.has(user)) out.push({ user, count: 0, hidden: true });
  }
  return out;
}
