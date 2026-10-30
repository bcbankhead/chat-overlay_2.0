import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { parseProfileAvatar, profileUrlFor } from '../src/core/forumAvatar.js';

const PROFILE_URL = 'https://dollforum.com/forum/memberlist.php?mode=viewprofile&u=';
const PAGE = 'https://dollforum.com/forum/memberlist.php?mode=viewprofile&u=42';
const win = new Window();
const parse = (html) => new win.DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html');

// The shape seen live (2026-10-29): the viewer's own img.avatar in the header, notification
// avatars, then the profile's own picture inside #viewprofile.
const header = `<div id="page-header"><a class="header-avatar"><img class="avatar" src="./download/file.php?avatar=1_viewer.jpg"></a>
  <ul id="notification_list"><li><a class="notification-block"><img class="avatar" src="./download/file.php?avatar=9_n.jpg"></a></li></ul></div>`;
const profile = (inner) => `${header}<div id="page-body"><form id="viewprofile"><dl class="left-box">${inner}</dl></form></div>`;

test('profileUrlFor uses u= when the forum id is known', () => {
  assert.equal(profileUrlFor(PROFILE_URL, PAGE, { userID: '42', name: 'Bob' }), PAGE);
});

test('profileUrlFor looks a user up by name when the id is not known', () => {
  assert.equal(
    profileUrlFor(PROFILE_URL, PAGE, { name: 'Dick Vicious' }),
    'https://dollforum.com/forum/memberlist.php?mode=viewprofile&un=Dick+Vicious',
  );
});

test('profileUrlFor resolves a relative profileUrl and refuses what it cannot build', () => {
  assert.equal(
    profileUrlFor('../memberlist.php?mode=viewprofile&u=', 'https://dollforum.com/forum/chat/', { userID: '7' }),
    'https://dollforum.com/forum/memberlist.php?mode=viewprofile&u=7',
  );
  assert.equal(profileUrlFor(undefined, PAGE, { userID: '7' }), null);
  assert.equal(profileUrlFor('', PAGE, { userID: '7' }), null);
  assert.equal(profileUrlFor(PROFILE_URL, PAGE, {}), null);
});

test('a profile with a picture answers its absolute URL, not the viewer\'s header avatar', () => {
  const doc = parse(profile('<dt class="profile-avatar"><img class="avatar" src="./download/file.php?avatar=42_x.jpg"></dt>'));
  assert.equal(parseProfileAvatar(doc, PAGE), 'https://dollforum.com/forum/download/file.php?avatar=42_x.jpg');
});

test('a profile with no picture answers null, never the viewer\'s header avatar', () => {
  assert.equal(parseProfileAvatar(parse(profile('<dt>Bob</dt>')), PAGE), null);
  assert.equal(parseProfileAvatar(parse(profile('<dt class="profile-avatar"></dt>')), PAGE), null);
});

test('a no_avatar placeholder is no picture', () => {
  const doc = parse(profile('<dt class="profile-avatar"><img class="avatar" src="./styles/prosilver/theme/images/no_avatar.gif"></dt>'));
  assert.equal(parseProfileAvatar(doc, PAGE), null);
});

test('a page that is not a profile (an unknown name, a login page) is not an answer', () => {
  assert.equal(parseProfileAvatar(parse(`${header}<div id="message">The requested user does not exist.</div>`), PAGE), undefined);
});

test('a picture on a non-http scheme is not used', () => {
  const doc = parse(profile('<dt class="profile-avatar"><img src="javascript:alert(1)"></dt>'));
  assert.equal(parseProfileAvatar(doc, PAGE), null);
});
