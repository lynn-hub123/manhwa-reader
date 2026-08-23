'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const CoverCapture = require('../cover-capture.js');

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
  target.addEventListener = function (type, listener, options) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push({ listener, capture: options === true || !!(options && options.capture), passive: !!(options && options.passive), options });
  };
  target.removeEventListener = function (type, listener, options) {
    const capture = options === true || !!(options && options.capture);
    listeners.set(type, (listeners.get(type) || []).filter((item) => item.listener !== listener || item.capture !== capture));
  };
  target.dispatch = function (type, event) {
    const dispatched = event || {};
    let stopped = false;
    if (!dispatched.currentTarget) dispatched.currentTarget = target;
    const originalStop = dispatched.stopPropagation;
    dispatched.stopPropagation = function () { stopped = true; dispatched.stopped = true; if (originalStop) originalStop.call(dispatched); };
    (listeners.get(type) || []).slice().sort((a, b) => Number(b.capture) - Number(a.capture)).forEach((item) => { if (!stopped) item.listener(dispatched); });
  };
  target.count = function (type, capture) { const items = listeners.get(type) || []; return capture === undefined ? items.length : items.filter((item) => item.capture === capture).length; };
  target.listenerOptions = function (type) { return (listeners.get(type) || []).map((item) => ({ capture: item.capture, passive: item.passive })); };
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
    disabled: false,
    setAttribute(name, value) { this[name] = value; },
    focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    removeChild(child) { this.children = this.children.filter((item) => item !== child); child.parentNode = null; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    setPointerCapture() { this.pointerCaptured = true; },
    releasePointerCapture() { this.pointerReleased = true; },
    click() { if (this.disabled) return undefined; const result = this.onclick && this.onclick({ currentTarget: this, preventDefault() {} }); this.dispatch('click', { currentTarget: this, preventDefault() {} }); return result; },
    querySelector(selector) { return find(this, selector); },
    querySelectorAll(selector) { return findAll(this, selector); }
  });
  if (tagName.toLowerCase() === 'canvas') {
    element.width = 0;element.height = 0;element._drawCalls = [];
    element.getContext = function () { return { drawImage: (...args) => element._drawCalls.push(args) }; };
  }
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
  document.body.ownerDocument = document;
  document.activeElement = null;
  document.contains = () => true;
  document.createElement = function (tagName) { const element = makeElement(tagName); element.ownerDocument = document; return element; };
  document.querySelector = (selector) => find(document.body, selector);
  document.querySelectorAll = (selector) => findAll(document.body, selector);
  const toasts = [];
  const cropCalls = [];
  const saveCalls = [];
  let saveResult = true;
  let cropResult = 'data:image/jpeg;base64,adjusted';
  const context = {
    document,
    CoverCapture,
    cropCanvasToDataUrl(capture) { cropCalls.push({ ...capture.rect }); return cropResult; },
    async setSeriesCover(sid, dataUrl, options) {
      saveCalls.push([sid, dataUrl, options]);
      if (!saveResult) toasts.push(options.errorMessage);
      return saveResult;
    },
    showToast(message) { toasts.push(message); },
    captureUiActive: false,
    window: makeEvents({ innerWidth: 800, innerHeight: 700 }),
    console
  };
  vm.createContext(context);
  ['beginCaptureUi', 'endCaptureUi', 'trapCaptureUiFocus'].forEach((name) => vm.runInContext(extractFunction(name), context));
  vm.runInContext(extractFunction('startCoverAdjustment'), context);
  const priorFocus = document.createElement('button');priorFocus.id = 'prior-focus';document.body.appendChild(priorFocus);priorFocus.focus();
  return {
    context, document, toasts, cropCalls, saveCalls, priorFocus,
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
    },
    key(key, shiftKey) {
      const event = { key, shiftKey: !!shiftKey, target: document.activeElement, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
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

function cornerPoint(rect, corner) {
  return {
    x: corner.includes('w') ? rect.x : rect.x + rect.width,
    y: corner.includes('n') ? rect.y : rect.y + rect.height
  };
}

function oppositeAnchor(rect, corner) {
  return {
    x: corner.includes('w') ? rect.x + rect.width : rect.x,
    y: corner.includes('n') ? rect.y + rect.height : rect.y
  };
}

function assertRetainsAnchor(rect, corner, anchor, message) {
  const actual = oppositeAnchor(rect, corner);
  assert(Math.abs(actual.x - anchor.x) < 0.001, message + ': opposite horizontal anchor stays fixed');
  assert(Math.abs(actual.y - anchor.y) < 0.001, message + ': opposite vertical anchor stays fixed');
}

function resizeScenario(corner, dx, dy, message, expectAnchor) {
  const scenarioHarness = makeHarness();
  const capture = fixture();
  const startRect = { ...capture.rect };
  const moving = cornerPoint(startRect, corner);
  const anchor = oppositeAnchor(startRect, corner);
  scenarioHarness.context.startCoverAdjustment('series-resize', capture);
  const handle = scenarioHarness.overlay().querySelector('.cover-adjustment-handle-' + corner);
  scenarioHarness.pointer(handle, 'pointerdown', moving.x, moving.y);
  scenarioHarness.pointer(scenarioHarness.overlay(), 'pointermove', moving.x + dx, moving.y + dy);
  scenarioHarness.pointer(scenarioHarness.overlay(), 'pointerup', moving.x + dx, moving.y + dy);
  assertInsideAndRatio(capture.rect, capture.visibleBounds, 'Important 4 ' + message + ' ' + corner);
  if (expectAnchor) {
    assert.notStrictEqual(capture.rect.width, startRect.width, 'Important 4 ' + message + ' changes size for ' + corner);
    assertRetainsAnchor(capture.rect, corner, anchor, 'Important 4 ' + message + ' ' + corner);
  } else {
    assert(capture.rect.width > 0, 'Important 4 ' + message + ' keeps a positive size for ' + corner);
  }
  scenarioHarness.button('cover-adjustment-cancel').click();
}

async function main() {
  const harness = makeHarness();
  const capture = fixture();
  harness.context.startCoverAdjustment('series-1', capture);
  const overlay = harness.overlay();
  assert(overlay, 'adjustment must render an overlay');
  assert.strictEqual(overlay['aria-modal'], 'true', 'Important 3: adjustment exposes modal semantics');
  assert.strictEqual(harness.document.activeElement, harness.button('cover-adjustment-save'), 'Important 3: adjustment focuses its first action');
  assert.deepStrictEqual(capture.rect, { x: 70, y: 80, width: 200, height: 280 }, 'overlay starts at capture.rect');
  assert.strictEqual(overlay.querySelector('.cover-adjustment-tip').textContent, '拖动或拉角调整 · 固定 5:7', '5:7 guidance is visible');
  assert.strictEqual(overlay.querySelectorAll('.cover-adjustment-handle').length, 4, 'four corner handles are rendered');
  [['cover-adjustment-save', '保存为封面'], ['cover-adjustment-restore', '恢复推荐位置'], ['cover-adjustment-cancel', '取消']].forEach(([id, label]) => {
    assert.strictEqual(harness.button(id).textContent, label, label + ' action is rendered');
  });
  assert.deepStrictEqual(overlay.types().sort(), ['pointercancel', 'pointerdown', 'pointermove', 'pointerup'].sort(), 'manipulation uses only Pointer Events');
  assert.strictEqual(overlay.count('mousedown') + overlay.count('mousemove') + overlay.count('touchstart'), 0, 'legacy manipulation listeners are absent');
  assert.deepStrictEqual(harness.document.listenerOptions('wheel'), [{ capture: true, passive: false }], 'Important 3: wheel blocking is capture-phase and non-passive');
  let tab = harness.key('Tab');
  assert(tab.prevented && tab.stopped, 'Important 3: adjustment traps Tab');
  assert.strictEqual(harness.document.activeElement, harness.button('cover-adjustment-restore'), 'Important 3: Tab moves within adjustment actions');
  harness.key('Tab');harness.key('Tab');
  assert.strictEqual(harness.document.activeElement, harness.button('cover-adjustment-save'), 'Important 3: Tab wraps within adjustment actions');
  harness.key('Tab', true);
  assert.strictEqual(harness.document.activeElement, harness.button('cover-adjustment-cancel'), 'Important 3: Shift+Tab wraps backward within adjustment actions');

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
  assert.strictEqual(harness.document.activeElement, harness.priorFocus, 'Important 3: adjustment cleanup restores prior focus');
  assert.deepStrictEqual(harness.saveCalls, [], 'cancel saves nothing');

  ['nw', 'ne', 'sw', 'se'].forEach((corner) => {
    const horizontalDirection = corner.includes('w') ? -1 : 1;
    const verticalDirection = corner.includes('n') ? -1 : 1;
    resizeScenario(corner, horizontalDirection * 20, 0, 'horizontal-only resize', true);
    resizeScenario(corner, 0, verticalDirection * 70, 'vertical-only resize', true);
    resizeScenario(corner, horizontalDirection * 1000, verticalDirection * 1000, 'boundary resize', false);
    resizeScenario(corner, horizontalDirection * -400, verticalDirection * -500, 'crossing-pointer resize', false);
  });

  const narrowHarness = makeHarness();
  const narrowCapture = {
    canvas: { width: 500, height: 700 },
    canvasRect: { left: 0, top: 0, width: 100, height: 140 },
    visibleBounds: { x: 0, y: 0, width: 100, height: 140 },
    rect: { x: 20, y: 28, width: 60, height: 84 },
    originalRect: { x: 20, y: 28, width: 60, height: 84 }
  };
  narrowHarness.context.startCoverAdjustment('series-narrow', narrowCapture);
  assert.deepStrictEqual(narrowCapture.rect, { x: 20, y: 28, width: 60, height: 84 }, 'Important 4: starting adjustment preserves a valid 60×84 recommendation');
  const narrowHandle = narrowHarness.overlay().querySelector('.cover-adjustment-handle-se');
  narrowHarness.pointer(narrowHandle, 'pointerdown', 80, 112);
  narrowHarness.pointer(narrowHarness.overlay(), 'pointermove', 95, 133);
  narrowHarness.pointer(narrowHarness.overlay(), 'pointerup', 95, 133);
  narrowHarness.button('cover-adjustment-restore').click();
  assert.deepStrictEqual(narrowCapture.rect, { x: 20, y: 28, width: 60, height: 84 }, 'Important 4: restore returns exactly to the valid narrow recommendation');
  assert.deepStrictEqual(narrowCapture.originalRect, narrowCapture.rect, 'Important 4: rect and originalRect stay consistent for a narrow recommendation');
  narrowHarness.button('cover-adjustment-cancel').click();

  const escapeCapture = fixture();
  const readerKeys = [];
  harness.document.addEventListener('keydown', (event) => readerKeys.push(event.key));
  harness.context.startCoverAdjustment('series-1', escapeCapture);
  ['ArrowRight', 'w', 'A', 's', 'D', 'f', 'B'].forEach((key) => {
    const event = harness.key(key);
    assert(event.prevented && event.stopped, key + ' must be intercepted while adjusting');
  });
  assert.deepStrictEqual(readerKeys, [], 'reader shortcuts must not receive adjustment keys');
  harness.key('Tab');
  ['Enter', ' '].forEach((key) => {
    const event = harness.key(key);
    assert(!event.prevented && !event.stopped, key + ' remains available to activate adjustment buttons');
  });
  assert.deepStrictEqual(readerKeys, ['Enter', ' '], 'Tab stays trapped while Enter and Space remain available to adjustment buttons');
  const escape = harness.escape();
  assert(escape.prevented && escape.stopped, 'Escape must not reach reader shortcuts');
  assert.strictEqual(harness.overlay(), null, 'Escape cancels adjustment');
  harness.key('ArrowRight');
  harness.key('w');
  assert.deepStrictEqual(readerKeys, ['Enter', ' ', 'ArrowRight', 'w'], 'reader shortcuts resume after cleanup');

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
  assert.strictEqual(harness.document.count('keydown', true), 1, 'reopening after exit has one adjustment keyboard listener');
  assert.strictEqual(harness.document.querySelectorAll('.cover-adjustment-overlay').length, 1, 'reopening has one overlay/action set');
  harness.button('cover-adjustment-cancel').click();

  const canonicalHarness = makeHarness();
  const canonicalCanvas = { width: 600, height: 500 };
  const canonicalCapture = {
    sourceKind: 'canonical100',
    canvas: canonicalCanvas,
    canvasRect: { left: 0, top: 0, width: 600, height: 500 },
    visibleBounds: { x: 0, y: 0, width: 600, height: 500 },
    rect: { x: 175, y: 75, width: 250, height: 350 },
    originalRect: { x: 175, y: 75, width: 250, height: 350 }
  };
  canonicalHarness.context.startCoverAdjustment('series-canonical', canonicalCapture);
  const canonicalOverlay = canonicalHarness.overlay();
  const stage = canonicalOverlay.querySelector('.cover-adjustment-stage');
  assert(stage, 'the canonical adjustment must display a standalone comic stage');
  assert.strictEqual(stage.tagName, 'CANVAS');
  assert.deepStrictEqual(stage._drawCalls, [[canonicalCanvas, 0, 0]], 'the standalone stage must display the canonical 100% source');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(canonicalCapture.canvasRect)), { left: 100, top: 100, width: 600, height: 500 }, 'the crop source must map to the centered standalone stage');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(canonicalCapture.visibleBounds)), { x: 100, y: 100, width: 600, height: 500 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(canonicalCapture.rect)), { x: 275, y: 175, width: 250, height: 350 }, 'the recommendation must keep its source position when mapped onto the standalone stage');
  assert.strictEqual(canonicalHarness.rect().style.left, '275px');
  assert.strictEqual(canonicalHarness.rect().style.top, '175px');
  assert.strictEqual(canonicalOverlay.querySelector('.cover-adjustment-tip').textContent, '100% 画面 · 拖动或拉角调整 · 固定 5:7');
  canonicalHarness.context.window.innerWidth = 700;
  canonicalHarness.context.window.innerHeight = 800;
  canonicalHarness.context.window.dispatch('resize', {});
  assert.strictEqual(canonicalHarness.overlay(), null, 'viewport resize closes the stale standalone adjustment stage');
  assert.deepStrictEqual(canonicalHarness.toasts.slice(-1), ['窗口尺寸已变化，请重新调整封面']);
  assert.strictEqual(canonicalHarness.context.window.count('resize'), 0, 'viewport resize cleanup removes its listener');
  console.log('cover-capture-adjustment: PASS');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
