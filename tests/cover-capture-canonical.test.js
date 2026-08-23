'use strict';

const assert = require('assert');
const CoverCapture = require('../cover-capture.js');

// This test catches a regression where the crop bounds are derived from the
// user's current zoomed viewport instead of a stable 100% page rendering.
const canonicalPage = { width: 600, height: 2000 };
const viewer = { width: 600, height: 500 };
const zoomScenarios = [
  {
    canvasRect: { left: 0, top: -750, width: 600, height: 2000 },
    visibleBounds: { x: 0, y: 0, width: 600, height: 500 }
  },
  {
    canvasRect: { left: -150, top: -1250, width: 900, height: 3000 },
    visibleBounds: { x: 0, y: 0, width: 600, height: 500 }
  },
  {
    canvasRect: { left: -300, top: -1750, width: 1200, height: 4000 },
    visibleBounds: { x: 0, y: 0, width: 600, height: 500 }
  }
];

const windows = zoomScenarios.map((scenario) => CoverCapture.computeCanonicalWindow(
  scenario.canvasRect,
  scenario.visibleBounds,
  canonicalPage,
  viewer
));

windows.forEach((windowBounds) => {
  assert.deepStrictEqual(windowBounds, { x: 0, y: 750, width: 600, height: 500 }, '100%, 150%, and 200% must resolve to the same canonical window at the same reading focus');
});

const nearTop = CoverCapture.computeCanonicalWindow(
  { left: 0, top: 0, width: 600, height: 2000 },
  { x: 0, y: 0, width: 600, height: 500 },
  canonicalPage,
  viewer
);
assert.deepStrictEqual(nearTop, { x: 0, y: 0, width: 600, height: 500 }, 'the canonical window must clamp to the top of a long page');

const shortPage = CoverCapture.computeCanonicalWindow(
  { left: 50, top: 100, width: 300, height: 400 },
  { x: 50, y: 100, width: 300, height: 400 },
  { width: 300, height: 400 },
  viewer
);
assert.deepStrictEqual(shortPage, { x: 0, y: 0, width: 300, height: 400 }, 'a page smaller than the 100% viewport must be included in full');

const mappedCrop = CoverCapture.mapRectBetweenBounds(
  { x: 100, y: 50, width: 250, height: 350 },
  { x: 0, y: 0, width: 600, height: 500 },
  { x: 200, y: 80, width: 300, height: 250 }
);
assert.deepStrictEqual(mappedCrop, { x: 250, y: 105, width: 125, height: 175 }, 'a canonical crop must map exactly onto a scaled standalone stage');

console.log('cover-capture-canonical: PASS');
