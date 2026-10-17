'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

assert.match(html, /--accent:#C9A45C/i,
  'the midnight-study palette should use a brass lamp accent');
assert.match(html, /#bookshelf\{[^}]*background:var\(--bg\)/,
  'the bookshelf needs an explicit surface background');
assert.match(html, /\.bs-rack\{[^}]*display:grid[^}]*grid-template-columns:repeat\(auto-fill,minmax\(/,
  'the shelf should render as a responsive cover grid');
assert.match(html, /grid-template-columns:repeat\(auto-fill,minmax\(198px,1fr\)/,
  'desktop cover cards should stay large enough for titles and artwork');
assert.match(html, /\.bs-header\{[^}]*flex-shrink:0/,
  'the shelf header should keep its height when the grid overflows');
assert.match(html, /\.bs-continue\{/,
  'the bookshelf needs a dedicated continue-reading module');
assert.match(html, /\.bs-continue\[hidden\]\{display:none!important\}/,
  'an empty bookshelf must not reserve space for the continue-reading module');
assert.match(html, /\.shelf-cover-frame\{/,
  'cover cards need a dimensional frame separate from the legacy rack body');
assert.match(html, /\.comic-panel-rule\{/,
  'comic identity should be expressed through restrained panel rules');
assert.match(html, /id="bs-continue"[^>]*class="bs-continue"/,
  'the page should provide a continue-reading mount point');
assert.doesNotMatch(html, /bs-reading-dock/,
  'the bulky right-side reading dock was removed; the compact continue-reading card serves all viewports');
assert.doesNotMatch(html, /grid-template-columns:minmax\(620px,58%\)/,
  'the bookshelf should stay a single roomy column without the reading dock');
assert.match(html, /id="bs-library-head"[^>]*class="bs-section-head"/,
  'the page should provide a library section header mount point');
assert.match(app, /shelf-cover-wrap/,
  'renderBookshelf should render a visible cover-first card');
assert.match(app, /bs-continue/,
  'renderBookshelf should populate the continue-reading module');
assert.doesNotMatch(app, /has-reading-dock/,
  'renderBookshelf should no longer track the removed reading dock');
assert.match(app, /bs-empty-add/,
  'the empty bookshelf should expose a direct add action');
assert.match(html, /@media\(min-width:1100px\)\{[\s\S]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/,
  'wide desktop shelves should use four readable cover columns');
assert.match(html, /@media\(min-width:1100px\) and \(max-height:1200px\)\{[\s\S]*max-width:840px[\s\S]*min-height:178px/,
  'normal-height desktop shelves should fit the reference composition without shrinking text');
assert.match(html, /\.bs-rack\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\);gap:12px 20px[\s\S]*max-width:100%/,
  'short desktop shelves should use breathable cover spacing across the widened library pane');
assert.match(html, /\.bs-rack\.rack-add|\.bs-rack \.rack-add/,
  'the add card should have a desktop presentation rule');
assert.match(html, /\.bs-continue\{[^}]*grid-template-rows:auto auto auto/,
  'continue reading should stack its action with the text column');
assert.match(html, /\.continue-action\{[^}]*grid-column:2[^}]*grid-row:3/,
  'continue reading action should sit under the title and metadata');
assert.match(app, /\$\('bs-add-btn'\)\.style\.display='';/,
  'the main add action should stay visible as the primary desktop entry');
assert.match(app, /rail\.hidden=settings\.groups\.length===0&&activeGroupId===null;/,
  'the default-only group rail should stay out of the way until custom groups exist');
assert.doesNotMatch(app, /夜书店|日书店/,
  'theme labels should describe the comic palette instead of a bookstore');

console.log('shelf-ui-contract: PASS');
