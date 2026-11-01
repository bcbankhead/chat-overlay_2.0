// Server-history blocks (TDF-0033.2): where each block starts in the view's flat row list and
// how many rows it has. Pure: the view reads its rows' block ids and places headers from this.

/**
 * One block's position in a row sequence.
 * @typedef {object} BlockHead
 * @property {string} block  the block id (a page load's `backlogBlock`)
 * @property {number} index  the position of the block's first row
 * @property {number} count  how many rows carry the block id
 */

/**
 * Each block's first row and row count, in order of first appearance. Rows with no block id
 * (`undefined` or `''`) belong to none.
 * @param {ReadonlyArray<string | undefined>} blocks  each row's block id, in row order
 * @returns {BlockHead[]}
 */
export function blockHeads(blocks) {
  /** @type {Map<string, BlockHead>} */
  const heads = new Map();
  blocks.forEach((block, index) => {
    if (!block) return;
    const head = heads.get(block);
    if (head) head.count += 1;
    else heads.set(block, { block, index, count: 1 });
  });
  return [...heads.values()];
}

/**
 * The header text for a block of `count` rows.
 * @param {number} count
 * @returns {string}
 */
export function blockLabel(count) {
  return `From the chat's server history (${count})`;
}
