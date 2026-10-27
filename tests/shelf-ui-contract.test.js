'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

assert.match(html, /--accent:#6B8FA8/i,
  'the shelf should use the cool blue-gray status accent, not a vermilion accent');
assert.match(html, /#bookshelf\{[^}]*background:var\(--bg\)/,
  'the bookshelf needs an explicit surface background');
assert.match(html, /\.bs-rack\{[^}]*display:grid[^}]*grid-template-columns:repeat\(auto-fill,minmax\(/,
  'the shelf should render as a responsive cover grid');
assert.match(html, /grid-template-columns:repeat\(auto-fill,minmax\(160px,1fr\)/,
  'desktop cover cards should stay large enough for titles and artwork');
assert.match(html, /\.bs-header\{[^}]*position:sticky/,
  'the shelf header should stay pinned above the grid');
assert.match(html, /\.resume-badge\{/,
  'the shelf should style a dedicated resume badge for the most recently read series');
assert.match(app, /resume-badge/,
  'renderBookshelf should mark the most recently read series on the shelf itself');
assert.match(html, /\.shelf-cover-frame\{/,
  'cover cards need a dimensional frame separate from the legacy rack body');
assert.match(html, /\.comic-panel-rule\{/,
  'comic identity should be expressed through restrained panel rules');
assert.match(html, /id="bs-library-head"[^>]*class="bs-section-head"/,
  'the page should provide a library section header mount point');
assert.match(app, /shelf-cover-wrap/,
  'renderBookshelf should render a visible cover-first card');
assert.doesNotMatch(app, /bs-continue/,
  'the standalone continue-reading card was folded into the shelf resume badge');
assert.doesNotMatch(app, /has-reading-dock/,
  'renderBookshelf should no longer track the removed reading dock');
assert.match(app, /bs-empty-add/,
  'the empty bookshelf should expose a direct add action');
assert.match(html, /@media\(min-width:1100px\)\{[\s\S]*--colw:max\(118px,min\(150px,calc\(\(100dvh - 396px\)\/4\.2\)\)\)/,
  'wide desktop shelves should scale cover width from the viewport so a full rack fits one screen');
assert.match(html, /@media\(min-width:1100px\)\{[\s\S]*position:sticky;top:0;z-index:20/,
  'the desktop shelf header should stay pinned with a translucent material while the rack scrolls under it');
assert.match(html, /@media\(min-width:1100px\) and \(max-height:1200px\)\{[\s\S]*#bookshelf\{padding:0 clamp\(32px,4vw,72px\) 8px\}/,
  'normal-height desktop shelves should keep compact page edges without a top gap');
assert.match(html, /\.bs-rack\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\);gap:12px 20px[\s\S]*max-width:100%/,
  'short desktop shelves should use breathable cover spacing across the widened library pane');
assert.match(html, /\.bs-rack\.rack-add|\.bs-rack \.rack-add/,
  'the add card should have a desktop presentation rule');
assert.match(app, /\$\('bs-add-btn'\)\.style\.display='';/,
  'the main add action should stay visible as the primary desktop entry');
assert.match(app, /rail\.hidden=settings\.groups\.length===0&&activeGroupId===null;/,
  'the default-only group rail should stay out of the way until custom groups exist');
assert.doesNotMatch(app, /夜书店|日书店/,
  'theme labels should describe the comic palette instead of a bookstore');

console.log('shelf-ui-contract: PASS');
