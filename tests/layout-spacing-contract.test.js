'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

assert.match(html, /#bookshelf\{[^}]*padding:34px clamp\(48px,5vw,96px\) 72px/,
  'the desktop bookshelf should keep generous page-edge breathing room');
assert.match(html, /\.bs-header\{[^}]*margin-bottom:28px[^}]*padding:6px 0 20px[^}]*border:0[^}]*background:transparent[^}]*box-shadow:none/,
  'the bookshelf header should use the open reference layout');
assert.match(html, /\.bs-continue\{[^}]*grid-template-rows:auto auto auto[^}]*min-height:222px[^}]*margin:0 0 34px[^}]*padding:26px 28px/,
  'the continue-reading module should use readable dimensions');
assert.match(html, /\.bs-section-head\{[^}]*margin:0 0 26px[^}]*padding:0 3px 16px/,
  'the library section header should separate from the card grid');
assert.match(html, /\.bs-rack\{[^}]*gap:36px 28px[^}]*padding:8px 0 24px/,
  'the cover grid should use a readable card rhythm');
assert.match(html, /\.rack-book\{[^}]*gap:12px/,
  'cover metadata should have a little more breathing room');

assert.match(html, /#topbar\{[^}]*margin:20px clamp\(28px,4vw,64px\) 0[^}]*padding:12px 16px/,
  'the reader top bar should align with the relaxed desktop margins');
assert.match(html, /#main\{[^}]*padding:20px clamp\(28px,4vw,64px\)[^}]*gap:20px/,
  'the reader main area should have wider page gutters and panel gaps');
assert.match(html, /#viewer-area\{[^}]*padding:32px clamp\(24px,2\.5vw,40px\)/,
  'the reader canvas should have a roomier inner frame');
assert.match(html, /#bottombar\{[^}]*margin:0 clamp\(28px,4vw,64px\) 20px[^}]*padding:12px 16px/,
  'the reader bottom bar should share the wider desktop gutters');

console.log('layout-spacing-contract: PASS');
