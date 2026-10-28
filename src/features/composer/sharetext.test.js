import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shareRefusal } from './sharetext.js';

test('shareRefusal names a failing status', () => {
  assert.equal(shareRefusal(500, 'oops'), 'Upload failed (HTTP 500)');
  assert.equal(shareRefusal(404, ''), 'Upload failed (HTTP 404)');
});

test('shareRefusal treats a redirect, opaque or not, as a refusal', () => {
  const redirected = 'Upload refused: the Share Files plugin redirected (signed out of the chat?)';
  assert.equal(shareRefusal(0, ''), redirected);
  assert.equal(shareRefusal(302, ''), redirected);
  assert.equal(shareRefusal(399, ''), redirected);
  assert.equal(shareRefusal(400, ''), 'Upload failed (HTTP 400)');
});

test("shareRefusal treats the plugin's 'no access' page as a refusal", () => {
  assert.equal(shareRefusal(200, 'no access<div></div>'), 'Upload refused: not signed in to the chat');
  assert.equal(shareRefusal(200, '  No Access'), 'Upload refused: not signed in to the chat');
});

test('shareRefusal passes any other 2xx response', () => {
  assert.equal(shareRefusal(200, '<form>…</form>'), null);
  assert.equal(shareRefusal(200, 'File shared, no access problems'), null, 'only a leading "no access" is the refusal page');
  assert.equal(shareRefusal(204, ''), null);
});
