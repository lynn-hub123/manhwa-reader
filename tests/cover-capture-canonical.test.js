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
  },
  {
    canvasRect: { left: 120, top: -350, width: 360, height: 1200 },
    visibleBounds: { x: 120, y: 0, width: 360, height: 500 }
  },
  {
    canvasRect: { left: 20, top: -883.3333333333333, width: 680, height: 2266.6666666666665 },
    visibleBounds: { x: 20, y: 0, width: 680, height: 500 },
    viewportSize: { width: 720, height: 500 }
  }
];

const windows = zoomScenarios.map((scenario) => CoverCapture.computeCanonicalWindow(
  scenario.canvasRect,
  scenario.visibleBounds,
  canonicalPage,
  scenario.viewportSize || viewer
));

windows.forEach((windowBounds) => {
  assert(Math.abs(windowBounds.x) < 1e-9 && Math.abs(windowBounds.y - 750) < 1e-9, '60%, 100%, 150%, 200%, and fit-width must preserve the same canonical reading focus');
  assert.strictEqual(windowBounds.width, 600);
  assert.strictEqual(windowBounds.height, 500);
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
