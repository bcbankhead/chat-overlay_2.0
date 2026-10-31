import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countLikes, deriveTags } from './infer.js';
import { SMILIE_CODES_FIXTURE as CODES } from './smilieCodes.fixture.js';

const A = '100000000111111';
const B = '100000000222222';
const img = (/** @type {string} */ id) => `[[img src="plugins/share/view.php?id=${id}"]]`;

let at = 0;
/**
 * @param {string} user
 * @param {string} text
 * @param {Partial<import('./infer.js').InferMessage>} [over]
 * @returns {import('./infer.js').InferMessage}
 */
const msg = (user, text, over = {}) => ({
  id: String(++at),
  roomID: '1',
  mTime: '',
  user,
  kind: 'public',
  text,
  receivedAt: at,
  ...over,
});

/** @param {import('./infer.js').Tag[]} tags */
const brief = (tags) => tags.map((t) => `${t.imageId.slice(-6)} ${t.code} ${t.sender}${t.certain ? ' certain' : ''}`);

test('a bare reaction directly after an image tags it; yours is certain', () => {
  const tags = deriveTags([msg('alice', img(A)), msg('bob', ':h'), msg('me', img(B)), msg('me', ':L')], 'me', CODES);
  assert.deepEqual(brief(tags), ['111111 :h bob', '222222 :L me certain']);
  assert.equal(tags[0].sourceMessageId, String(at - 2));
});

test('a bare reaction tags only the message directly before it', () => {
  const tags = deriveTags([msg('alice', img(A)), msg('carol', 'nice'), msg('bob', ':h')], 'me', CODES);
  assert.deepEqual(tags, []);
});

test('a message with text beside the reaction produces no tag', () => {
  assert.deepEqual(deriveTags([msg('alice', img(A)), msg('bob', ':h so cute')], 'me', CODES), []);
});

test('a token tags the nearest earlier image with that suffix, anywhere later', () => {
  const older = '900000000111111';
  const tags = deriveTags(
    [msg('x', img(older)), msg('alice', img(A)), msg('carol', 'hi'), msg('dave', 'yo'), msg('bob', ':h ^111111')],
    'me',
    CODES,
  );
  assert.deepEqual(tags.map((t) => t.imageId), [A]);
});

test('a token with no matching earlier image produces no tag', () => {
  assert.deepEqual(deriveTags([msg('bob', ':h ^111111'), msg('alice', img(A))], 'me', CODES), []);
});

test('a retraction removes the same sender\'s reaction only', () => {
  const tags = deriveTags(
    [msg('alice', img(A)), msg('bob', ':h ^111111'), msg('me', ':h ^111111'), msg('bob', '-:h ^111111')],
    'me',
    CODES,
  );
  assert.deepEqual(brief(tags), ['111111 :h me certain']);
  // Reacting again after a retraction counts again.
  const again = deriveTags(
    [msg('alice', img(A)), msg('bob', ':h ^111111'), msg('bob', '-:h ^111111'), msg('bob', ':h ^111111')],
    'me',
    CODES,
  );
  assert.deepEqual(brief(again), ['111111 :h bob']);
});

test('whispers count neither as images nor as reactions, and do not break adjacency', () => {
  const tags = deriveTags(
    [
      msg('alice', img(A), { kind: 'whisper' }),
      msg('bob', ':h'),
      msg('alice', img(B)),
      msg('carol', 'psst', { kind: 'whisper' }),
      msg('bob', ':L'),
      msg('dave', ':h ^222222', { kind: 'whisper' }),
    ],
    'me',
    CODES,
  );
  assert.deepEqual(brief(tags), ['222222 :L bob']);
});

test('an unconfirmed own message counts for nothing; a pending one counts', () => {
  const failed = deriveTags([msg('alice', img(A)), msg('me', ':h ^111111', { confirm: 'unconfirmed' })], 'me', CODES);
  assert.deepEqual(failed, []);
  const pending = deriveTags([msg('alice', img(A)), msg('me', ':h ^111111', { confirm: 'pending' })], 'me', CODES);
  assert.deepEqual(brief(pending), ['111111 :h me certain']);
});

test('duplicates collapse to one tag per image, code and sender, kept from the first', () => {
  const image = msg('alice', img(A));
  const first = msg('bob', ':h');
  const tags = deriveTags(
    [image, first, msg('bob', ':h ^111111'), msg('bob', ':h ^111111')],
    'me',
    CODES,
  );
  assert.equal(tags.length, 1);
  assert.equal(tags[0].sourceMessageId, first.id);
});

test('messages are ordered by message time, then receivedAt, then id, not by array order', () => {
  const image = msg('alice', img(A), { id: 'b', receivedAt: 5 });
  const reaction = msg('bob', ':h', { id: 'local-1', receivedAt: 6 });
  const between = msg('carol', 'hi', { id: 'a', receivedAt: 5 });
  // `a` sorts before `b` at the same receivedAt, so the image is directly before the reaction.
  assert.deepEqual(brief(deriveTags([reaction, image, between], 'me', CODES)), ['111111 :h bob']);
});

test('a backlog message stored late keeps its message-time place, so a reaction keeps its image', () => {
  const image = msg('alice', img(A), { mTime: '100', receivedAt: 1_000 });
  const reaction = msg('bob', ':h', { mTime: '101', receivedAt: 2_000 });
  // An older message first stored between the two: by receipt it would split them; by mTime
  // it comes first.
  const late = msg('carol', 'hi', { mTime: '99', receivedAt: 1_500 });
  assert.deepEqual(brief(deriveTags([image, reaction, late], 'me', CODES)), ['111111 :h bob']);
});

test('two installs on the same messages derive the same tags', () => {
  const messages = [
    msg('alice', img(A)),
    msg('bob', ':h'),
    msg('carol', img(B)),
    msg('alice', ':d ^111111'),
    msg('bob', '8) ^222222'),
    msg('alice', '-:d ^111111'),
  ];
  /** @param {import('./infer.js').Tag[]} tags */
  const shared = (tags) => tags.map(({ certain: _c, ...rest }) => rest);
  const alice = deriveTags(messages, 'alice', CODES);
  const bob = deriveTags([...messages].reverse(), 'bob', CODES);
  assert.deepEqual(shared(alice), shared(bob));
  assert.deepEqual(alice.map((t) => t.certain), [false, false]);
  assert.deepEqual(bob.map((t) => t.certain), [true, true]);
});

test('countLikes counts distinct senders across every smilie, with your own marked', () => {
  const tags = deriveTags(
    [
      msg('alice', img(A)),
      msg('bob', ':h ^111111'),
      msg('me', ':h ^111111'),
      msg('carol', ':L ^111111'),
      msg('bob', ':d ^111111'),
    ],
    'me',
    CODES,
  );
  assert.deepEqual(countLikes(tags, A), { count: 3, mine: true }, 'bob counts once across two smilies');
  assert.deepEqual(countLikes(tags, B), { count: 0, mine: false });
});

test('a span- or font-wrapped token tags the image as the plain one does', () => {
  const tags = deriveTags(
    [
      msg('alice', img(A)),
      msg('bob', ':h [[span style=color:#f2f2f2]]^111111[[/span]]'),
      msg('carol', ":L [[font color='#f2f2f2']]^111111[[/font]]"),
    ],
    'me',
    CODES,
  );
  assert.deepEqual(brief(tags), ['111111 :h bob', '111111 :L carol']);
  assert.equal(countLikes(tags, A).count, 2);
});
