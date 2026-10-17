'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

assert.match(app, /chapterNum:ch\.chapterNum/, 'cover candidates should retain the source chapter');
assert.match(app, /function renderCoverCandidate\(/, 'a selected thumbnail needs a full-resolution renderer');
assert.match(app, /let scale=2/, 'full-resolution cover rendering should use a cover scale');
assert.match(app, /getViewport\(\{scale\}\)/, 'full-resolution cover rendering should use the cover scale');
assert.match(app, /renderCoverCandidate\(data\.sid/, 'selecting a candidate should render the source page again');
assert.doesNotMatch(app, /const url=this\.dataset\.url;try\{await db\.saveCover/, 'the thumbnail data URL must not be saved as the final cover');

console.log('cover-selection-contract: PASS');
