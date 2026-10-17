'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('group rail measures intrinsic content and reschedules after layout changes', () => {
  const html = read('index.html');
  const app = read('app.js');

  assert.match(app, /function measureGroupRailContentWidth\(bar\)/,
    'overflow must be measured from intrinsic group content instead of state-dependent padding');
  assert.match(app, /const compactPadding/,
    'the measurement must normalize away the overflow safety padding');
  assert.match(app, /function scheduleGroupRailMeasurement\(/,
    'group rail measurement needs a shared deferred reschedule path');
  assert.match(app, /requestAnimationFrame\(/,
    'group rail measurement must wait for layout to settle across animation frames');
  assert.match(app, /new MutationObserver\(/,
    'content redraws must trigger a fresh group rail measurement');
  assert.match(app, /childList:\s*!0/,
    'the group rail observer must watch rendered group children');
  assert.match(app, /document\.fonts\.ready/,
    'font completion must trigger a fresh group rail measurement');

  assert.match(html, /\.bs-groups\{[^}]*touch-action:pan-x/,
    'mobile group navigation must remain horizontally touchable');
  assert.match(html, /\.bs-groups\{[^}]*-webkit-overflow-scrolling:touch/,
    'mobile group navigation should use native momentum scrolling');
  assert.match(html, /\.bs-groups::-webkit-scrollbar\{display:none\}/,
    'the horizontal scroll surface must not expose a scrollbar');
});

console.log('group-rail-mobile-contract: PASS');
