'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function extractFunction(name) {
  const start = source.indexOf('function ' + name + '(');
  assert.notStrictEqual(start, -1, name + ' must exist');
  let depth = 0;
  let opened = false;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') { depth += 1; opened = true; }
    else if (source[i] === '}') {
      depth -= 1;
      if (opened && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(name + ' must be parseable');
}

function makeEvents(target) {
  const listeners = new Map();
  target.addEventListener = function (type, listener) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(listener);
  };
  target.removeEventListener = function (type, listener) {
    listeners.set(type, (listeners.get(type) || []).filter((item) => item !== listener));
  };
  target.dispatch = function (type, event) {
    const dispatched = event || {};
    if (!dispatched.currentTarget) dispatched.currentTarget = target;
    (listeners.get(type) || []).slice().forEach((listener) => listener(dispatched));
  };
  target.count = function (type) { return (listeners.get(type) || []).length; };
  target.types = function () { return Array.from(listeners.keys()).filter((type) => target.count(type)); };
  return target;
}

function makeElement(tagName) {
  const element = makeEvents({
    tagName: tagName.toUpperCase(),
    style: {},
    dataset: {},
    children: [],
    parentNode: null,
    className: '',
    textContent: '',
    id: '',
    onclick: null,
    setAttribute(name, value) { this[name] = value; },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    removeChild(child) { this.children = this.children.filter((item) => item !== child); child.parentNode = null; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    setPointerCapture() { this.pointerCaptured = true; },
    releasePointerCapture() { this.pointerReleased = true; },
    click() { const result = this.onclick && this.onclick({ currentTarget: this, preventDefault() {} }); this.dispatch('click', { currentTarget: this, preventDefault() {} }); return result; },
    querySelector(selector) { return find(this, selector); },
    querySelectorAll(selector) { return findAll(this, selector); }
  });
  Object.defineProperty(element, 'innerHTML', {
    get() { return this._innerHTML || ''; },
    set(value) { this._innerHTML = value; }
  });
  return element;
}

function matches(element, selector) {
  if (selector[0] === '#') return element.id === selector.slice(1);
  if (selector[0] === '.') return element.className.split(/\s+/).includes(selector.slice(1));
  return element.tagName.toLowerCase() === selector.toLowerCase();
}
function findAll(root, selector) {
  const found = [];
  (function visit(node) {
    node.children.forEach((child) => { if (matches(child, selector)) found.push(child); visit(child); });
  }(root));
  return found;
}
function find(root, selector) { return findAll(root, selector)[0] || null; }

function makeHarness() {
  const document = makeEvents({ body: makeElement('body') });
  document.createElement = makeElement;
  document.querySelector = (selector) => find(document.body, selector);
  document.querySelectorAll = (selector) => findAll(document.body, selector);
  const toasts = [];
  const cropCalls = [];
  const saveCalls = [];
  let saveResult = true;
  let cropResult = 'data:image/jpeg;base64,adjusted';
  const context = {
    document,
    CoverCapture: {
      clampRect(rect, bounds, ratio, minWidth) {
        const maxWidth = Math.min(bounds.width, bounds.height * ratio);
        const width = Math.min(maxWidth, Math.max(maxWidth >= minWidth ? minWidth : 0, rect.width));
        const height = width / ratio;
        return {
          x: Math.min(bounds.x + bounds.width - width, Math.max(bounds.x, rect.x)),
          y: Math.min(bounds.y + bounds.height - height, Math.max(bounds.y, rect.y)),
          width,
          height
        };
      }
    },
    cropCanvasToDataUrl(capture) { cropCalls.push({ ...capture.rect }); return cropResult; },
    async setSeriesCover(sid, dataUrl, options) {
      saveCalls.push([sid, dataUrl, options]);
      if (!saveResult) toasts.push(options.errorMessage);
      return saveResult;
    },
    showToast(message) { toasts.push(message); },
    console
  };
  vm.createContext(context);
  vm.runInContext(extractFunction('startCoverAdjustment'), context);
  return {
    context, document, toasts, cropCalls, saveCalls,
    setSaveResult(value) { saveResult = value; },
    setCropResult(value) { cropResult = value; },
    overlay() { return document.querySelector('.cover-adjustment-overlay'); },
    rect() { return document.querySelector('.cover-adjustment-rect'); },
    button(id) { return document.querySelector('#' + id); },
    pointer(target, type, x, y, pointerId) {
      target.dispatch(type, { pointerId: pointerId || 1, clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} });
    },
    escape() {
      const event = { key: 'Escape', prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
      document.dispatch('keydown', event);
      return event;
    }
  };
}

function fixture() {
  return {
    canvas: { width: 1000, height: 1400 },
    canvasRect: { left: 0, top: 0, width: 500, height: 700 },
    visibleBounds: { x: 20, y: 30, width: 300, height: 500 },
    rect: { x: 70, y: 80, width: 200, height: 280 },
    originalRect: { x: 70, y: 80, width: 200, height: 280 }
  };
}

function assertInsideAndRatio(rect, bounds, message) {
  assert(rect.x >= bounds.x && rect.y >= bounds.y, message + ': starts inside bounds');
  assert(rect.x + rect.width <= bounds.x + bounds.width + 0.001, message + ': ends inside bounds');
  assert(rect.y + rect.height <= bounds.y + bounds.height + 0.001, message + ': bottom inside bounds');
  assert(Math.abs(rect.width / rect.height - 5 / 7) < 0.0001, message + ': remains 5:7');
}

async function main() {
  const harness = makeHarness();
  const capture = fixture();
  harness.context.startCoverAdjustment('series-1', capture);
  const overlay = harness.overlay();
  assert(overlay, 'adjustment must render an overlay');
  assert.deepStrictEqual(capture.rect, { x: 70, y: 80, width: 200, height: 280 }, 'overlay starts at capture.rect');
  assert.strictEqual(overlay.querySelector('.cover-adjustment-tip').textContent, '拖动或拉角调整 · 固定 5:7', '5:7 guidance is visible');
  assert.strictEqual(overlay.querySelectorAll('.cover-adjustment-handle').length, 4, 'four corner handles are rendered');
  [['cover-adjustment-save', '保存为封面'], ['cover-adjustment-restore', '恢复推荐位置'], ['cover-adjustment-cancel', '取消']].forEach(([id, label]) => {
    assert.strictEqual(harness.button(id).textContent, label, label + ' action is rendered');
  });
  assert.deepStrictEqual(overlay.types().sort(), ['pointercancel', 'pointerdown', 'pointermove', 'pointerup'].sort(), 'manipulation uses only Pointer Events');
  assert.strictEqual(overlay.count('mousedown') + overlay.count('mousemove') + overlay.count('touchstart'), 0, 'legacy manipulation listeners are absent');

  const rect = harness.rect();
  overlay.dispatch('pointerdown', { target: rect, currentTarget: overlay, pointerId: 1, clientX: 120, clientY: 140, preventDefault() {}, stopPropagation() {} });
  harness.pointer(overlay, 'pointermove', 200, 200);
  harness.pointer(overlay, 'pointerup', 200, 200);
  assert.notDeepStrictEqual(capture.rect, capture.originalRect, 'drag moves the selected rectangle');
  assertInsideAndRatio(capture.rect, capture.visibleBounds, 'drag');

  const beforeResize = { ...capture.rect };
  const handle = overlay.querySelector('.cover-adjustment-handle');
  harness.pointer(handle, 'pointerdown', beforeResize.x, beforeResize.y);
  harness.pointer(overlay, 'pointermove', beforeResize.x - 40, beforeResize.y - 40);
  harness.pointer(overlay, 'pointerup', beforeResize.x - 40, beforeResize.y - 40);
  assert.notStrictEqual(capture.rect.width, beforeResize.width, 'corner drag resizes the selected rectangle');
  assertInsideAndRatio(capture.rect, capture.visibleBounds, 'resize');

  harness.button('cover-adjustment-restore').click();
  assert.deepStrictEqual(capture.rect, capture.originalRect, 'restore returns exactly to original recommendation');

  harness.button('cover-adjustment-cancel').click();
  assert.strictEqual(harness.overlay(), null, 'cancel removes overlay');
  assert.strictEqual(harness.document.count('keydown'), 0, 'cancel releases keyboard listener');
  assert.strictEqual(harness.document.count('wheel'), 0, 'cancel restores reader scrolling');
  assert.deepStrictEqual(harness.saveCalls, [], 'cancel saves nothing');

  const escapeCapture = fixture();
  harness.context.startCoverAdjustment('series-1', escapeCapture);
  const escape = harness.escape();
  assert(escape.prevented && escape.stopped, 'Escape must not reach reader shortcuts');
  assert.strictEqual(harness.overlay(), null, 'Escape cancels adjustment');

  const retryCapture = fixture();
  harness.context.startCoverAdjustment('series-1', retryCapture);
  harness.setCropResult(null);
  await harness.button('cover-adjustment-save').click();
  assert(harness.overlay(), 'crop failure keeps adjustment open');
  assert.deepStrictEqual(harness.toasts.slice(-1), ['封面保存失败，请重试']);
  assert.deepStrictEqual(harness.saveCalls, [], 'crop failure does not save');
  harness.setCropResult('data:image/jpeg;base64,retry');
  harness.setSaveResult(false);
  await harness.button('cover-adjustment-save').click();
  assert(harness.overlay(), 'set failure keeps adjustment open for retry');
  assert.deepStrictEqual(harness.toasts.slice(-1), ['封面保存失败，请重试']);
  assert.strictEqual(harness.toasts.filter((message) => message === '封面保存失败，请重试').length, 2, 'each failure displays one adjustment-specific error');
  assert.strictEqual(harness.saveCalls.length, 1, 'failed save attempts set the cover once');
  assert.strictEqual(harness.saveCalls[0][2].errorMessage, '封面保存失败，请重试', 'save uses the adjustment-specific error message');
  harness.setSaveResult(true);
  await harness.button('cover-adjustment-save').click();
  assert.strictEqual(harness.overlay(), null, 'successful save cleans up');
  assert.strictEqual(harness.saveCalls.length, 2, 'successful retry calls setSeriesCover once more');
  assert.deepStrictEqual(harness.cropCalls.slice(-1)[0], retryCapture.rect, 'save crops the final adjusted capture rect');

  harness.context.startCoverAdjustment('series-1', fixture());
  assert.strictEqual(harness.document.count('keydown'), 1, 'reopening after exit has one keyboard listener');
  assert.strictEqual(harness.document.querySelectorAll('.cover-adjustment-overlay').length, 1, 'reopening has one overlay/action set');
  harness.button('cover-adjustment-cancel').click();
  console.log('cover-capture-adjustment: PASS');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
