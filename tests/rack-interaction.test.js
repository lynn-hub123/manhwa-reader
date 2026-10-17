'use strict';

const assert = require('assert');
const { findRackBookAtPoint } = require('../rack-interaction');

const slots = [
  { index: 0, left: 100, right: 148, top: 120, bottom: 420 },
  { index: 1, left: 150, right: 198, top: 120, bottom: 420 },
  { index: 2, left: 200, right: 248, top: 120, bottom: 420 },
];

assert.strictEqual(
  findRackBookAtPoint(slots, 174, 250),
  1,
  'the pointer should choose the second spine by coordinate even if another cover visually overlaps it',
);

assert.strictEqual(
  findRackBookAtPoint(slots, 149, 250),
  0,
  'a boundary point should resolve to the nearest spine center',
);

assert.strictEqual(
  findRackBookAtPoint(slots, 174, 100),
  -1,
  'a pointer above the rack hit band should not trigger a book',
);

assert.strictEqual(
  findRackBookAtPoint(slots, 248, 250),
  -1,
  'a pointer outside the rack edge should not trigger the last book',
);

console.log('rack-interaction: PASS');
