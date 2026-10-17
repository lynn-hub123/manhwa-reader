'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { isWebtoonPage, shouldUseWebtoon } = require('../reader-mode.js');

test('isWebtoonPage identifies pages taller than the reader threshold', () => {
  assert.equal(isWebtoonPage({ width: 800, height: 2401 }), true);
  assert.equal(isWebtoonPage({ width: 800, height: 2200 }), false);
  assert.equal(isWebtoonPage({ width: 0, height: 2400 }), false);
});

test('shouldUseWebtoon accepts an early tall page and ignores ordinary pages', () => {
  assert.equal(shouldUseWebtoon([{ width: 800, height: 1200 }, { width: 800, height: 2600 }]), true);
  assert.equal(shouldUseWebtoon([{ width: 800, height: 1200 }, { width: 800, height: 1800 }]), false);
});
