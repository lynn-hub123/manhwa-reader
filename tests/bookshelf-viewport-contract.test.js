'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

assert.match(html, /@media\(min-width:900px\) and \(max-height:820px\)/,
  'only genuinely short desktop windows should enter compact bookshelf spacing');
assert.match(html, /@media\(min-width:900px\) and \(max-height:820px\)\{[\s\S]*#bookshelf\{padding:16px clamp\(24px,3vw,40px\) 18px\}/,
  'short desktop shelves should keep visible top and bottom page breathing room');
assert.match(html, /\.bs-rack\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)[^}]*max-width:100%/,
  'short desktop windows should use the full widened library column for four readable covers');
assert.match(html, /\.bs-section-head,\.bs-rack\{[^}]*max-width:100%/,
  'short desktop windows should keep the bookshelf content in the widened left column');
assert.match(html, /\.shelf-title\{[^}]*font-size:16px/,
  'normal desktop cards should keep readable title text');
assert.match(html, /\.bs-rack\{display:grid;grid-template-columns:repeat\(auto-fill,minmax\(198px,1fr\)\)/,
  'normal desktop cards should use a readable minimum width');
assert.match(html, /\.shelf-cover-wrap\{aspect-ratio:5\/5\.6\}/,
  'short desktop cards should fit two rows without forcing an inner scrollbar');
assert.doesNotMatch(app, /continueEl/,
  'the continue-reading card logic was folded into the shelf resume badge');
assert.match(html, /启动阅读器\.bat[\s\S]*http:\/\/localhost:8765/,
  'the startup hint should explain the supported local launcher');
assert.match(app, /const isFileMode=window\.location\.protocol==='file:';/,
  'direct file opens should keep the launcher hint visible');
assert.match(app, /window\.location\.replace\('http:\/\/localhost:8765\/'\)/,
  'direct file opens should return to the running local server when available');
assert.match(app, /if\(startup\)startup\.style\.display=isFileMode\?'':'none';/,
  'the launcher hint should only appear in file:// mode, never on localhost');
assert.match(app, /pageBooks\.length<4\?' is-prominent':''/,
  'small libraries should promote the add card instead of leaving an empty shelf');
assert.match(html, /\.bs-rack\[data-count="1"\][^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,
  'a one-book shelf should use two balanced columns');

console.log('bookshelf-viewport-contract: PASS');
