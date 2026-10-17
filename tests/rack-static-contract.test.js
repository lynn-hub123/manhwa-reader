'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const renderBookshelf = app.match(/function renderBookshelf\(\)[\s\S]*?\nfunction findSeries\(/);

assert(renderBookshelf, 'renderBookshelf must remain discoverable');
assert.doesNotMatch(renderBookshelf[0], /bindRackHover\(\)/,
  'bookshelf rendering must not re-enable the pull-out hover listener');
assert.doesNotMatch(renderBookshelf[0], /renderRackCard\(card,0\)/,
  'bookshelf rendering must not start rigid-book animation frames');
assert.match(html, /#rack-overlay \.rack-rigid-book\{display:none!important\}/,
  'the legacy rigid layer must stay hidden even if stale hover state exists');
assert.match(html, /\.rack-book:hover \.shelf-cover-wrap,\.rack-book:focus-visible \.shelf-cover-wrap\{[^}]*transform:none/,
  'hover feedback must not move the cover out of its card');

console.log('rack-static-contract: PASS');
