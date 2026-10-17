'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { clampPinchZoom, swipeDirection } = require('../mobile-reader.js');

test('swipeDirection identifies horizontal page gestures and ignores vertical scrolling', () => {
  assert.equal(swipeDirection({ x: 240, y: 120 }, { x: 120, y: 132 }), 'next');
  assert.equal(swipeDirection({ x: 120, y: 120 }, { x: 240, y: 132 }), 'previous');
  assert.equal(swipeDirection({ x: 120, y: 120 }, { x: 130, y: 240 }), null);
  assert.equal(swipeDirection({ x: 120, y: 120 }, { x: 145, y: 122 }), null);
});

test('clampPinchZoom snaps gesture zoom to supported reader steps', () => {
  assert.equal(clampPinchZoom(0.2), 0.6);
  assert.equal(clampPinchZoom(1.12), 1);
  assert.equal(clampPinchZoom(1.38), 1.5);
  assert.equal(clampPinchZoom(3), 2);
});
