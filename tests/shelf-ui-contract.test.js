'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

assert.match(html, /--accent:#8B62D9/i,
  'the comic palette should use a restrained violet accent');
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
assert.match(html, /id="bs-reading-dock"[^>]*class="bs-reading-dock"/,
  'desktop shelves should provide a dedicated current-reading dock');
assert.match(html, /id="bs-dock-stage"/,
  'the current-reading dock should expose a visual reading stage');
assert.match(html, /@media\(min-width:900px\)\{[\s\S]*grid-template-columns:minmax\(620px,58%\)/,
  'desktop bookshelf should give the library enough room beside the current-reading dock');
assert.match(html, /@media\(min-width:900px\) and \(max-height:820px\)\{[\s\S]*grid-template-columns:minmax\(620px,58%\)/,
  'short desktop shelves should keep the library wide and the reading dock compact');
assert.match(html, /#bs-continue\{display:none!important\}/,
  'desktop shelves should move the continue-reading card out of the left library column');
assert.match(html, /id="bs-library-head"[^>]*class="bs-section-head"/,
  'the page should provide a library section header mount point');
assert.match(app, /shelf-cover-wrap/,
  'renderBookshelf should render a visible cover-first card');
assert.match(app, /bs-continue/,
  'renderBookshelf should populate the continue-reading module');
assert.match(app, /bs-reading-dock/,
  'renderBookshelf should populate the current-reading dock');
assert.match(app, /has-reading-dock/,
  'the bookshelf should track whether a current-reading dock is available');
assert.match(app, /bs-empty-add/,
  'the empty bookshelf should expose a direct add action');
assert.match(html, /@media\(min-width:1100px\)\{[\s\S]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/,
  'wide desktop shelves should use four readable cover columns');
assert.match(html, /@media\(min-width:1100px\) and \(max-height:1200px\)\{[\s\S]*max-width:840px[\s\S]*min-height:178px/,
  'normal-height desktop shelves should fit the reference composition without shrinking text');
assert.match(html, /\.bs-rack\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\);gap:12px 20px[\s\S]*max-width:100%/,
  'short desktop shelves should use breathable cover spacing across the widened library pane');
assert.match(html, /#bs-library-pane\{[^}]*padding-left:12px/,
  'the left library pane should keep rotated header and navigation controls inside its safe area');
assert.match(html, /\.bs-dock-cover\{[^}]*width:min\(340px,73%\)/,
  'the current-reading cover should scale up with the available right-pane width');
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
