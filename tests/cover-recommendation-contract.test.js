'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

assert.match(app, /function scoreCover\(cv,vp,pageNum,totalPages\)/, 'cover scoring should receive page context');
assert.match(app, /pagePrior/, 'cover scoring should apply a mild page-position prior');
assert.match(app, /scoreCover\(cv,vp,p,maxP\)/, 'candidate ranking should use page-aware cover scoring');
assert.match(app, /id="cover-open-reader"/, 'cover picker should expose a manual reader entry');
assert.match(app, /cover-open-reader/, 'manual reader entry should be wired');
assert.match(app, /currentSeries!==data\.sid/, 'manual reader entry should avoid resetting an already-open reader');

console.log('cover-recommendation-contract: PASS');
