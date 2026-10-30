import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { TILE_SLOTS, initials, tileSlot } from '../src/core/initials.js';
import { adapt } from '../src/core/ink.js';

test('initials take the first letter and the first capital after it, else the second letter', () => {
  assert.equal(initials('bobSmith'), 'BS');
  assert.equal(initials('Alice'), 'AL');
  assert.equal(initials('alice'), 'AL');
  assert.equal(initials('ChatUser2'), 'CU');
  assert.equal(initials('BatteriesNotIncluded'), 'BN');
});

test('initials skip non-letters, and decode an encoded name first', () => {
  assert.equal(initials('Cobra 666'), 'CO');
  assert.equal(initials('_x'), 'X');
  assert.equal(initials('Dick%20Vicious'), 'DV');
  assert.equal(initials('élodie'), 'ÉL');
});

test('a name with no letters, or none at all, shows ?', () => {
  assert.equal(initials(''), '?');
  assert.equal(initials('1234 _-'), '?');
});

test('the tile slot is stable for a name and within the palette', () => {
  assert.equal(tileSlot('bobSmith'), tileSlot('bobSmith'));
  assert.equal(tileSlot('Dick%20Vicious'), tileSlot('Dick Vicious'));
  const slots = new Set();
  for (const name of ['a', 'b', 'c', 'bobSmith', 'Alice', 'alice', 'Siliconeman', 'SoloBang76', 'introvert2018', 'x']) {
    const slot = tileSlot(name);
    assert.ok(Number.isInteger(slot) && slot >= 0 && slot < TILE_SLOTS, name);
    slots.add(slot);
  }
  assert.ok(slots.size > 1, 'names spread over the palette');
});

// Drift test (Vector 18): TILE_SLOTS and theme.css's palette are two copies of one count.
test('theme.css defines every tile slot in both themes, each readable under white text', () => {
  const css = readFileSync(new URL('../src/core/theme.css', import.meta.url), 'utf8');
  for (const theme of ['light', 'dark']) {
    const block = new RegExp(`:root\\[data-tdf-theme="${theme}"\\] \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    for (let slot = 0; slot < TILE_SLOTS; slot += 1) {
      const color = new RegExp(`--tdf-tile-${slot}: (#[0-9a-f]{6});`, 'i').exec(block)?.[1];
      assert.ok(color, `${theme} defines --tdf-tile-${slot}`);
      // adapt leaves a colour unchanged only when it already meets the 4.5 contrast floor.
      assert.equal(adapt(color, '#ffffff'), color, `${theme} --tdf-tile-${slot} ${color} contrast under white`);
    }
    assert.equal(new RegExp(`--tdf-tile-${TILE_SLOTS}:`).test(block), false, `${theme} has no slot past the palette`);
  }
  for (let slot = 0; slot < TILE_SLOTS; slot += 1) {
    assert.ok(css.includes(`.tdf-tile[data-tile="${slot}"] { background: var(--tdf-tile-${slot}); }`), `rule for slot ${slot}`);
  }
});
