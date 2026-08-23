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
    if (source[i] === '{') {
      depth += 1;
      opened = true;
    } else if (source[i] === '}') {
      depth -= 1;
      if (opened && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(name + ' must be parseable');
}

function makeClassList() {
  const values = new Set();
  return {
    add(value) { values.add(value); },
    remove(value) { values.delete(value); },
    contains(value) { return values.has(value); }
  };
}

function makeEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      const items = listeners.get(type) || [];
      listeners.set(type, items.filter((item) => item !== listener));
    },
    dispatch(type, event) {
      (listeners.get(type) || []).slice().forEach((listener) => listener(event || {}));
    },
    count(type) { return (listeners.get(type) || []).length; }
  };
}

function makeButton() {
  const events = makeEventTarget();
  return Object.assign(events, {
    onclick: null,
    click() {
      if (this.onclick) this.onclick({ currentTarget: this });
      this.dispatch('click', { currentTarget: this });
    }
  });
}

function makeHarness() {
  const documentEvents = makeEventTarget();
  const overlayEvents = makeEventTarget();
  const modalOverlay = Object.assign(overlayEvents, { classList: makeClassList() });
  const controls = {};
  const modalContent = {
    _innerHTML: '',
    get innerHTML() { return this._innerHTML; },
    set innerHTML(value) {
      this._innerHTML = value;
      ['cover-recommend-use', 'cover-recommend-adjust', 'cover-recommend-cancel'].forEach((id) => {
        controls[id] = value.includes('id="' + id + '"') ? makeButton() : null;
      });
    },
    querySelector(selector) {
      return controls[selector.slice(1)] || null;
    }
  };
  const frames = [];
  const saves = [];
  const adjustments = [];
  const toasts = [];
  let recommendation = null;
  const document = Object.assign(documentEvents, {
    getElementById(id) {
      return id === 'modal-overlay' ? modalOverlay : id === 'modal-content' ? modalContent : null;
    }
  });
  const context = {
    document,
    $: (id) => document.getElementById(id),
    Qs: (selector, root) => root.querySelector(selector),
    requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
    setTimeout(callback) { frames.push(callback); return frames.length; },
    recommendVisibleCoverCrop() { return recommendation; },
    setSeriesCover(sid, dataUrl) { saves.push([sid, dataUrl]); },
    startCoverAdjustment(sid, capture) { adjustments.push([sid, capture]); },
    showToast(message) { toasts.push(message); },
    console
  };
  vm.createContext(context);
  ['showCoverRecommendation', 'startCoverCapture'].forEach((name) => vm.runInContext(extractFunction(name), context));
  return {
    context,
    modalOverlay,
    modalContent,
    controls,
    frames,
    saves,
    adjustments,
    toasts,
    setRecommendation(value) { recommendation = value; },
    flushFrame() { assert.strictEqual(frames.length, 1, 'capture analysis must queue exactly one frame'); frames.shift()(); },
    escape() {
      const event = { key: 'Escape', prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
      document.dispatch('keydown', event);
      return event;
    },
    backdrop() { modalOverlay.dispatch('click', { target: modalOverlay }); },
    listenerCount() { return document.count('keydown') + modalOverlay.count('click'); }
  };
}

const capture = {
  dataUrl: 'data:image/jpeg;base64,recommended-cover',
  rect: { x: 10, y: 20, width: 50, height: 70 }
};

const loadingHarness = makeHarness();
loadingHarness.modalOverlay.classList.add('show');
loadingHarness.context.startCoverCapture('series-1');
assert(!loadingHarness.modalOverlay.classList.contains('show'), 'start must close the setup modal before analysis');
assert.deepStrictEqual(loadingHarness.toasts, ['正在分析当前画面…']);
assert.strictEqual(loadingHarness.frames.length, 1, 'analysis must wait for the next frame');
loadingHarness.setRecommendation(null);
loadingHarness.flushFrame();
assert.deepStrictEqual(loadingHarness.toasts, ['正在分析当前画面…', '当前画面还未加载完成']);
assert(!loadingHarness.modalOverlay.classList.contains('show'), 'a null recommendation must not open a preview');
assert.deepStrictEqual(loadingHarness.saves, []);

const acceptHarness = makeHarness();
acceptHarness.setRecommendation(capture);
acceptHarness.context.startCoverCapture('series-1');
acceptHarness.flushFrame();
assert(acceptHarness.modalOverlay.classList.contains('show'));
assert.match(acceptHarness.modalContent.innerHTML, /系统推荐/);
assert.match(acceptHarness.modalContent.innerHTML, /src="data:image\/jpeg;base64,recommended-cover"/);
assert.match(acceptHarness.modalContent.innerHTML, />使用推荐</);
assert.match(acceptHarness.modalContent.innerHTML, />调整一下</);
assert.match(acceptHarness.modalContent.innerHTML, />取消</);
acceptHarness.controls['cover-recommend-use'].click();
assert(!acceptHarness.modalOverlay.classList.contains('show'));
assert.deepStrictEqual(acceptHarness.saves, [['series-1', capture.dataUrl]]);
assert.deepStrictEqual(acceptHarness.adjustments, []);
assert.strictEqual(acceptHarness.listenerCount(), 0, 'accept must remove preview listeners');

const adjustHarness = makeHarness();
adjustHarness.context.showCoverRecommendation('series-1', capture);
adjustHarness.controls['cover-recommend-adjust'].click();
assert(!adjustHarness.modalOverlay.classList.contains('show'));
assert.deepStrictEqual(adjustHarness.saves, []);
assert.deepStrictEqual(adjustHarness.adjustments, [['series-1', capture]]);
assert.strictEqual(adjustHarness.listenerCount(), 0, 'adjust must remove preview listeners');

['cancel', 'backdrop', 'escape'].forEach((exit) => {
  const harness = makeHarness();
  harness.context.showCoverRecommendation('series-1', capture);
  let escapeEvent = null;
  if (exit === 'cancel') harness.controls['cover-recommend-cancel'].click();
  else if (exit === 'escape') escapeEvent = harness.escape();
  else harness.backdrop();
  assert(!harness.modalOverlay.classList.contains('show'), exit + ' must close the preview');
  assert.deepStrictEqual(harness.saves, [], exit + ' must not save');
  assert.deepStrictEqual(harness.adjustments, [], exit + ' must not adjust');
  assert.strictEqual(harness.listenerCount(), 0, exit + ' must remove preview listeners');
  if (escapeEvent) assert(escapeEvent.prevented && escapeEvent.stopped, 'Escape must not reach reader-level shortcuts');
});

const reopenHarness = makeHarness();
reopenHarness.context.showCoverRecommendation('series-1', capture);
reopenHarness.controls['cover-recommend-cancel'].click();
reopenHarness.context.showCoverRecommendation('series-1', capture);
reopenHarness.controls['cover-recommend-use'].click();
assert.deepStrictEqual(reopenHarness.saves, [['series-1', capture.dataUrl]], 'reopening must not duplicate actions');

console.log('cover-capture-preview: PASS');
