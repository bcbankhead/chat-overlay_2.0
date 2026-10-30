import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { whenDomReady } from '../src/core/ready.js';

/** A document reporting the given readyState. */
const docAt = (state) => {
  const { document } = new Window();
  Object.defineProperty(document, 'readyState', { value: state, configurable: true });
  return document;
};

test('while the document is loading, the call waits for DOMContentLoaded and runs once', () => {
  const doc = docAt('loading');
  let calls = 0;
  whenDomReady(doc, () => (calls += 1));
  assert.equal(calls, 0);
  doc.dispatchEvent(new doc.defaultView.Event('DOMContentLoaded'));
  assert.equal(calls, 1);
  doc.dispatchEvent(new doc.defaultView.Event('DOMContentLoaded'));
  assert.equal(calls, 1);
});

for (const state of ['interactive', 'complete']) {
  test(`once the document is ${state}, the call runs right away`, () => {
    let calls = 0;
    whenDomReady(docAt(state), () => (calls += 1));
    assert.equal(calls, 1);
  });
}
