'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const MobileReader = require('../mobile-reader.js');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function gestureFixture(options = {}) {
  const listeners = new Map();
  const frames = new Map();
  const requests = [];
  const turns = [];
  let sequence = 0;
  const viewer = {
    style: {}, clientWidth: 370, scrollWidth: options.overflow ? 600 : 370,
    scrollLeft: 0, scrollTop: 0,
    addEventListener(name, fn) { listeners.set(name, fn); },
    querySelector() { return { dataset: { pdfScale: '0.54' } }; }
  };
  const context = {
    $: id => id === 'viewer-area' ? viewer : { classList: { contains: () => false } },
    window: { MobileReader, matchMedia: () => ({ matches: true }) },
    zoom: 1.5, fitWidth: false, currentPage: 1, isWebtoon: false, captureUiActive: false,
    pdfDoc: { numPages: 3 },
    requestAnimationFrame(fn) { const id = ++sequence; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    requestZoomChange(value) { requests.push(value); context.fitWidth = value === 'fit'; if (!context.fitWidth) context.zoom = Number(value); },
    nextPage() { turns.push('next'); }, prevPage() { turns.push('previous'); },
    db: { saveSetting: async () => {} }, console
  };
  const start = source.indexOf('function bindMobileReaderGestures(){');
  const end = source.indexOf('\nbindMobileReaderGestures();', start);
  assert.ok(start >= 0 && end > start);
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  context.bindMobileReaderGestures();
  return {
    viewer, context, requests, turns,
    send(type, id, x, y) {
      const e = { type, pointerType: 'touch', pointerId: id, clientX: x, clientY: y,
        target: { closest: () => null }, cancelable: true, preventDefault() {} };
      listeners.get(type)?.(e);
    },
    touch(type, points) {
      const e = { type, touches: points.map(([identifier, clientX, clientY]) => ({ identifier, clientX, clientY })),
        cancelable: true, preventDefault() {} };
      listeners.get(type)?.(e);
    },
    flush() { const jobs = [...frames.values()]; frames.clear(); jobs.forEach(fn => fn()); }
  };
}

test('cancelled touch never turns a PDF page', () => {
  const f = gestureFixture();
  f.send('pointerdown', 1, 200, 200);
  f.send('pointercancel', 1, 100, 200);
  assert.deepEqual(f.turns, []);
});

test('a pinch returning to its starting distance restores the starting zoom', () => {
  const f = gestureFixture();
  f.send('pointerdown', 1, 0, 0);
  f.send('pointerdown', 2, 100, 0);
  f.send('pointermove', 2, 140, 0); f.flush();
  f.send('pointermove', 2, 100, 0); f.flush();
  assert.deepEqual(f.requests, ['2', '1.5']);
  f.send('pointerup', 1, 0, 0); f.send('pointerup', 2, 100, 0);
  assert.deepEqual(f.turns, []);
});

test('a pinch starting in fit mode scales from its rendered ratio and restores fit mode', () => {
  const f = gestureFixture(); f.context.fitWidth = true;
  f.send('pointerdown', 1, 0, 0); f.send('pointerdown', 2, 100, 0);
  f.send('pointermove', 2, 140, 0); f.flush();
  f.send('pointermove', 2, 100, 0); f.flush();
  assert.deepEqual(f.requests, ['0.75', 'fit']);
  assert.equal(f.context.fitWidth, true);
});

test('horizontal dragging on an enlarged page pans instead of turning pages', () => {
  const f = gestureFixture({ overflow: true });
  f.send('pointerdown', 1, 220, 200);
  f.send('pointermove', 1, 100, 205);
  f.send('pointerup', 1, 100, 205);
  assert.equal(f.viewer.scrollLeft, 120);
  assert.deepEqual(f.turns, []);
});

test('normal swipes turn pages while vertical scrolling does not', () => {
  const f = gestureFixture();
  f.send('pointerdown', 1, 220, 200); f.send('pointerup', 1, 100, 205);
  f.send('pointerdown', 1, 100, 200); f.send('pointerup', 1, 220, 205);
  f.send('pointerdown', 1, 100, 200); f.send('pointerup', 1, 105, 350);
  assert.deepEqual(f.turns, ['next', 'previous']);
});

test('fit-width swipes still turn pages even when a lazy offscreen canvas retains an old width', () => {
  const f = gestureFixture({ overflow: true }); f.context.fitWidth = true;
  f.send('pointerdown', 1, 220, 200); f.send('pointermove', 1, 100, 205); f.send('pointerup', 1, 100, 205);
  assert.equal(f.viewer.scrollLeft, 0);
  assert.deepEqual(f.turns, ['next']);
});

test('pinch input is ignored while capture UI is active', () => {
  const f = gestureFixture(); f.context.captureUiActive = true;
  f.send('pointerdown', 1, 0, 0); f.send('pointerdown', 2, 100, 0);
  f.send('pointermove', 2, 140, 0); f.flush();
  assert.deepEqual(f.requests, []);
});

test('touch-event pinch preserves natural one-finger scroll and restores its zoom', () => {
  const f = gestureFixture();
  f.touch('touchstart', [[1, 0, 0], [2, 100, 0]]);
  f.touch('touchmove', [[1, 0, 0], [2, 140, 0]]); f.flush();
  f.touch('touchmove', [[1, 0, 0], [2, 100, 0]]); f.flush();
  f.touch('touchend', []);
  assert.deepEqual(f.requests, ['2', '1.5']);
  assert.notEqual(f.viewer.style.touchAction, 'none', 'do not switch touch-action after a gesture has started');
});

test('cancelled pinch discards a pending animation-frame zoom', () => {
  const f = gestureFixture();
  f.send('pointerdown', 1, 0, 0); f.send('pointerdown', 2, 100, 0);
  f.send('pointermove', 2, 140, 0);
  f.send('pointercancel', 2, 140, 0); f.flush();
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.turns, []);
});
