'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const db = fs.readFileSync(path.join(root, 'db.js'), 'utf8');

assert.match(html, /id="bs-group-rail"/, 'the bookshelf needs a group rail wrapper');
assert.match(html, /id="bs-group-prev"/, 'an overflowing group rail needs a previous control');
assert.match(html, /id="bs-group-next"/, 'an overflowing group rail needs a next control');
assert.match(html, /id="bs-groups"/, 'the bookshelf needs a group navigation mount point');
assert.match(app, /activeGroupId/, 'the shelf needs an active group selection');
assert.match(app, /function renderGroupBar\(/, 'group navigation should be rendered from bookshelf state');
assert.match(app, /function createGroup\(/, 'groups need a persisted creation path');
assert.match(app, /function deleteGroup\(/, 'groups need a deletion path that can release its books');
assert.match(app, /groupId/, 'series records need a group association');
assert.match(app, /move-group/, 'series actions need a move-to-group flow');
assert.match(app, /saveSetting\('groups'/, 'group changes should persist through settings');
assert.match(app, /contextmenu/, 'custom groups should expose rename/delete from their context menu');
assert.doesNotMatch(app, /data-group-menu/, 'custom groups should not render a separate management button');
assert.doesNotMatch(html, /class="bs-group-more"/, 'custom groups should not render overlapping management buttons');
assert.match(app, /updateGroupRail\(/, 'the group rail should update overflow controls');
assert.match(html, /\.bs-group-rail\{[^}]*position:relative/,
  'group overflow controls should stay anchored to the visible rail edges');
assert.match(html, /\.bs-group-rail\.has-overflow \.bs-groups\{[^}]*padding:[^}]*34px/,
  'overflowing groups should reserve space so the first and last tabs are never clipped');
assert.match(html, /\.bs-group-tab\{[^}]*flex:0 0 auto/,
  'group tabs should keep their full label width so overflow controls can activate reliably');
assert.match(html, /\.bs-groups\{[^}]*flex-wrap:nowrap/,
  'group tabs should stay on one row while the arrows reveal overflow');
assert.match(html, /\.bs-groups\{[^}]*overflow-x:auto/,
  'the group row should expose a horizontal scroll surface for the arrow controls');
assert.match(html, /\.bs-group-rail\{[^}]*width:100%/,
  'the group rail should stay constrained to the bookshelf pane width');
assert.match(db, /groupId/, 'existing series should normalize a missing group association');

console.log('grouping-contract: PASS');
