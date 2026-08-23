'use strict';

const assert = require('assert');
const ReadingProgress = require('../reading-progress.js');

// This catches the regression where normal PDF reading only remembers the
// page number and reopens a tall page at its top.
const viewer = { top: 100, height: 600 };
const page = { top: -120, height: 1600 };
const ratio = ReadingProgress.pageRatioAtAnchor(viewer, page);
assert.strictEqual(ratio, 0.25, 'the saved position should be the page-local ratio at the reading anchor');

// The same content point must be restored after zoom changes the rendered
// page height. The result is a scrollTop delta, not a fixed pixel offset.
const zoomedPage = { top: -140, height: 3200 };
const restoredScrollTop = ReadingProgress.scrollTopForPageRatio(
  { top: 100, height: 600, scrollTop: 500 },
  zoomedPage,
  ratio
);
assert.strictEqual(restoredScrollTop, 880, 'restoration should align the same page-local content with the reading anchor');

assert.strictEqual(
  ReadingProgress.pageRatioAtAnchor({ top: 0, height: 400 }, { top: 500, height: 1000 }),
  0,
  'content above the page should clamp to the page start'
);
assert.strictEqual(
  ReadingProgress.pageRatioAtAnchor({ top: 0, height: 400 }, { top: -1200, height: 1000 }),
  1,
  'content below the page should clamp to the page end'
);

assert.strictEqual(
  ReadingProgress.normalizePageRatio(undefined),
  null,
  'old progress records without a page-local position should use the legacy fallback'
);
assert.strictEqual(ReadingProgress.normalizePageRatio(0), 0);
assert.strictEqual(ReadingProgress.normalizePageRatio(1.4), 1);
assert.strictEqual(ReadingProgress.normalizePageRatio(-0.2), 0);

console.log('reading-progress: PASS');
