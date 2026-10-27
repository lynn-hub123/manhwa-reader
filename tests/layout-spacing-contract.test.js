'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

assert.match(html, /#bookshelf\{[^}]*padding:34px clamp\(48px,5vw,96px\) 72px/,
  'the desktop bookshelf should keep generous page-edge breathing room');
assert.match(html, /\.bs-header\{[^}]*margin-bottom:24px[^}]*padding:18px 0[^}]*border-bottom:1px solid var\(--border\)/,
  'the bookshelf header should be a sticky glass bar');
assert.match(html, /\.bs-section-head\{[^}]*margin:0 0 20px[^}]*padding:0;border:0/,
  'the library section header should stay flat and borderless');
assert.match(html, /\.bs-rack\{[^}]*gap:24px 32px[^}]*padding:4px 0 24px/,
  'the cover grid should use a readable card rhythm');
assert.match(html, /\.rack-book\{[^}]*gap:10px/,
  'cover metadata should have a little more breathing room');

assert.match(html, /#topbar\{[^}]*margin:0;border:0;border-radius:0;box-shadow:none;overflow:visible\}/,
  'the reader top bar should be a full-width chrome bar, not a floating card');
assert.match(html, /#topbar\{[^}]*border-bottom:1px solid var\(--line\)/,
  'the reader top bar should separate from the stage with a hairline');
assert.match(html, /#main\{[^}]*margin:0;padding:0;gap:0\}/,
  'the reader stage should be flush with the viewport edges');
assert.match(html, /#viewer-area\{[^}]*margin:0;border:0;border-radius:0;box-shadow:none\}/,
  'the reader canvas stage should be an edge-to-edge dark room');
assert.match(html, /#bottombar\{[^}]*margin:0;border:0;border-radius:0;box-shadow:none\}/,
  'the reader bottom bar should share the full-width chrome bar');
assert.match(html, /#sidebar\.hidden\{transform:translateX\(100%\)/,
  'the catalog should slide off to the right as a drawer');

console.log('layout-spacing-contract: PASS');
