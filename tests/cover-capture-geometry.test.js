'use strict';

const assert = require('assert');
const CoverCapture = require('../cover-capture.js');

const bounds = { x: 100, y: 50, width: 700, height: 600 };
const ratio = 5 / 7;

function assertInside(rect, container) {
  assert(rect.x >= container.x);
  assert(rect.y >= container.y);
  assert(rect.x + rect.width <= container.x + container.width);
  assert(rect.y + rect.height <= container.y + container.height);
}

function assertRatio(rect) {
  assert(Math.abs(rect.width / rect.height - ratio) < 1e-10);
}

const fitted = CoverCapture.fitRect(bounds, ratio, 20);
assertRatio(fitted);
assertInside(fitted, bounds);
assert(fitted.x >= bounds.x + 20);
assert(fitted.y >= bounds.y + 20);
assert(fitted.x + fitted.width <= bounds.x + bounds.width - 20);
assert(fitted.y + fitted.height <= bounds.y + bounds.height - 20);

const candidates = CoverCapture.buildCandidates(bounds, ratio);
assert(candidates.length > 1);
assert.strictEqual(new Set(candidates.map((rect) => [rect.x, rect.y, rect.width, rect.height].join(','))).size, candidates.length);
candidates.forEach((rect) => {
  assertRatio(rect);
  assertInside(rect, bounds);
});

assert.strictEqual(CoverCapture.chooseCandidate(candidates, (rect) => rect.x), candidates.reduce((best, rect) => rect.x > best.x ? rect : best));
const tied = [{ x: 10 }, { x: 10 }];
assert.strictEqual(CoverCapture.chooseCandidate(tied, (rect) => rect.x), tied[0]);

const clamped = CoverCapture.clampRect({ x: -100, y: -100, width: 1000, height: 10 }, bounds, ratio, 80);
assertRatio(clamped);
assertInside(clamped, bounds);
assert(clamped.width >= 80);

console.log('cover-capture-geometry: PASS');
