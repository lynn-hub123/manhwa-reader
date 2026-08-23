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

function extractReaderKeyHandler() {
  if (source.includes('function handleReaderKeyDown(')) return extractFunction('handleReaderKeyDown');
  const marker = "document.addEventListener('keydown',function(e){if(e.target.tagName";
  const bindingStart = source.indexOf(marker);
  assert.notStrictEqual(bindingStart, -1, 'global reader keyboard binding must exist');
  const start = source.indexOf('function(e)', bindingStart);
  let depth = 0;
  let opened = false;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') { depth += 1; opened = true; }
    else if (source[i] === '}') {
      depth -= 1;
      if (opened && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('global reader keyboard handler must be parseable');
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
    addEventListener(type, listener, options) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push({ listener, capture: options === true || !!(options && options.capture) });
    },
    removeEventListener(type, listener) {
      const items = listeners.get(type) || [];
      listeners.set(type, items.filter((item) => item.listener !== listener));
    },
    dispatch(type, event) {
      const dispatched = event || {};
      let stopped = false;
      const originalStop = dispatched.stopPropagation;
      dispatched.stopPropagation = function () { stopped = true; dispatched.stopped = true; if (originalStop) originalStop.call(dispatched); };
      (listeners.get(type) || []).slice().sort((a, b) => Number(b.capture) - Number(a.capture)).forEach((item) => { if (!stopped) item.listener(dispatched); });
    },
    count(type) { return (listeners.get(type) || []).length; }
  };
}

function makeButton(focusDocument) {
  const events = makeEventTarget();
  return Object.assign(events, {
    tagName: 'BUTTON',
    onclick: null,
    disabled: false,
    focus() { focusDocument.activeElement = this; },
    click() {
      if (this.disabled) return undefined;
      const result = this.onclick && this.onclick({ currentTarget: this });
      this.dispatch('click', { currentTarget: this });
      return result;
    }
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

function makeHarness() {
  const documentEvents = makeEventTarget();
  const overlayEvents = makeEventTarget();
  const modalOverlay = Object.assign(overlayEvents, { classList: makeClassList() });
  const controls = {};
  let document;
  const modalContent = {
    _innerHTML: '',
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    removeAttribute(name) { delete this.attributes[name]; },
    getAttribute(name) { return this.attributes[name]; },
    get innerHTML() { return this._innerHTML; },
    set innerHTML(value) {
      this._innerHTML = value;
      ['cover-recommend-use', 'cover-recommend-adjust', 'cover-recommend-cancel'].forEach((id) => {
        controls[id] = value.includes('id="' + id + '"') ? makeButton(document) : null;
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
  const saveResults = [];
  const readerActions = [];
  let recommendation = null;
  document = Object.assign(documentEvents, {
    activeElement: null,
    contains() { return true; },
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
    async setSeriesCover(sid, dataUrl, options) {
      saves.push([sid, dataUrl, options]);
      let result = saveResults.length ? saveResults.shift() : true;
      if (result && typeof result.then === 'function') result = await result;
      if (result instanceof Error) throw result;
      if (result === false) toasts.push(options && options.errorMessage || '设置失败');
      return result;
    },
    startCoverAdjustment(sid, capture) { adjustments.push([sid, capture]); },
    showToast(message) { toasts.push(message); },
    nextPage() { readerActions.push('nextPage'); },
    prevPage() { readerActions.push('prevPage'); },
    nextChapter() { readerActions.push('nextChapter'); },
    prevChapter() { readerActions.push('prevChapter'); },
    reRenderAll() { readerActions.push('fit'); },
    closeReader() { readerActions.push('closeReader'); },
    captureUiActive: false,
    fitWidth: false,
    console
  };
  const zoomSelect = { tagName: 'SELECT', value: '1' };
  const sidebar = { classList: { toggle() { readerActions.push('sidebar'); } } };
  const originalGetElementById = document.getElementById.bind(document);
  document.getElementById = (id) => id === 'zoom-select' ? zoomSelect : id === 'sidebar' ? sidebar : originalGetElementById(id);
  vm.createContext(context);
  ['beginCaptureUi', 'endCaptureUi', 'trapCaptureUiFocus'].forEach((name) => {
    if (source.includes('function ' + name + '(')) vm.runInContext(extractFunction(name), context);
  });
  ['showCoverRecommendation', 'startCoverCapture'].forEach((name) => vm.runInContext(extractFunction(name), context));
  const readerHandlerSource = extractReaderKeyHandler();
  if (readerHandlerSource.startsWith('function handleReaderKeyDown')) vm.runInContext(readerHandlerSource, context);
  else vm.runInContext('readerKeyHandler=' + readerHandlerSource, context);
  document.addEventListener('keydown', context.handleReaderKeyDown || context.readerKeyHandler);
  const priorFocus = makeButton(document);
  priorFocus.id = 'prior-focus';
  priorFocus.focus();
  return {
    context,
    modalOverlay,
    modalContent,
    controls,
    frames,
    saves,
    adjustments,
    toasts,
    readerActions,
    priorFocus,
    setSaveResults(...results) { saveResults.push(...results); },
    setRecommendation(value) { recommendation = value; },
    flushFrame() { assert.strictEqual(frames.length, 1, 'capture analysis must queue exactly one frame'); frames.shift()(); },
    escape() {
      const event = { key: 'Escape', target: document.activeElement, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
      document.dispatch('keydown', event);
      return event;
    },
    key(key, shiftKey) {
      const event = { key, shiftKey: !!shiftKey, target: document.activeElement, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
      document.dispatch('keydown', event);
      return event;
    },
    backdrop() { modalOverlay.dispatch('click', { target: modalOverlay }); },
    listenerCount() { return document.count('keydown') - 1 + modalOverlay.count('click'); }
  };
}

async function main() {
const capture = {
  dataUrl: 'data:image/jpeg;base64,recommended-cover',
  rect: { x: 10, y: 20, width: 50, height: 70 }
};

const focusHarness = makeHarness();
focusHarness.context.showCoverRecommendation('series-1', capture);
['ArrowRight', 'd', 'a', 's', 'w', 'f', 'b'].forEach((key) => focusHarness.key(key));
assert.deepStrictEqual(focusHarness.readerActions, [], 'Important 3: preview suppresses the real reader Arrow/WASD/F/B actions through shared capture state');
assert.strictEqual(focusHarness.modalContent.getAttribute('role'), 'dialog', 'Important 3: recommendation preview exposes dialog semantics');
assert.strictEqual(focusHarness.modalContent.getAttribute('aria-modal'), 'true', 'Important 3: recommendation preview is announced as modal');
assert.strictEqual(focusHarness.context.document.activeElement, focusHarness.controls['cover-recommend-use'], 'Important 3: recommendation preview focuses its first action');
focusHarness.key('Tab');
assert.strictEqual(focusHarness.context.document.activeElement, focusHarness.controls['cover-recommend-adjust'], 'Important 3: Tab moves to the next preview action');
focusHarness.key('Tab');
focusHarness.key('Tab');
assert.strictEqual(focusHarness.context.document.activeElement, focusHarness.controls['cover-recommend-use'], 'Important 3: Tab wraps within preview actions');
focusHarness.key('Tab', true);
assert.strictEqual(focusHarness.context.document.activeElement, focusHarness.controls['cover-recommend-cancel'], 'Important 3: Shift+Tab wraps backward within preview actions');
['Enter', ' '].forEach((key) => {
  const event = focusHarness.key(key);
  assert(!event.prevented && !event.stopped, 'Important 3: ' + JSON.stringify(key) + ' remains available to activate a focused capture button');
});
focusHarness.controls['cover-recommend-cancel'].click();
assert.strictEqual(focusHarness.context.document.activeElement, focusHarness.priorFocus, 'Important 3: preview cleanup restores prior focus');
focusHarness.key('ArrowRight');
assert.deepStrictEqual(focusHarness.readerActions, ['nextPage'], 'Important 3: reader shortcuts resume after preview cleanup');

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

const unavailablePreviewHarness = makeHarness();
unavailablePreviewHarness.setRecommendation({ rect: capture.rect, dataUrl: null });
unavailablePreviewHarness.context.startCoverCapture('series-1');
unavailablePreviewHarness.flushFrame();
assert.deepStrictEqual(unavailablePreviewHarness.toasts, ['正在分析当前画面…', '当前画面还未加载完成'], 'a recommendation without preview data must report the same loading failure');
assert(!unavailablePreviewHarness.modalOverlay.classList.contains('show'), 'a recommendation without preview data must not open a preview');
assert.deepStrictEqual(unavailablePreviewHarness.saves, []);
assert.deepStrictEqual(unavailablePreviewHarness.adjustments, []);

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
await acceptHarness.controls['cover-recommend-use'].click();
assert(!acceptHarness.modalOverlay.classList.contains('show'));
assert.deepStrictEqual(JSON.parse(JSON.stringify(acceptHarness.saves)), [['series-1', capture.dataUrl, { errorMessage: '封面保存失败，请重试' }]]);
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
await reopenHarness.controls['cover-recommend-use'].click();
assert.deepStrictEqual(JSON.parse(JSON.stringify(reopenHarness.saves)), [['series-1', capture.dataUrl, { errorMessage: '封面保存失败，请重试' }]], 'reopening must not duplicate actions');

const retryHarness = makeHarness();
const pendingFailure = deferred();
retryHarness.setSaveResults(pendingFailure.promise, new Error('storage unavailable'), true);
retryHarness.context.showCoverRecommendation('series-1', capture);
const firstAttempt = retryHarness.controls['cover-recommend-use'].click();
assert.strictEqual(retryHarness.controls['cover-recommend-use'].disabled, true, 'Important 2: direct recommendation action is disabled while save is pending');
retryHarness.controls['cover-recommend-use'].click();
assert.strictEqual(retryHarness.saves.length, 1, 'Important 2: a pending click cannot start a duplicate save');
pendingFailure.resolve(false);
await firstAttempt;
assert(retryHarness.modalOverlay.classList.contains('show'), 'Important 2: a false save result keeps direct recommendation preview open');
assert.strictEqual(retryHarness.controls['cover-recommend-use'].disabled, false, 'Important 2: direct recommendation can be retried after false');
assert.deepStrictEqual(retryHarness.toasts, ['封面保存失败，请重试'], 'the setSeriesCover boundary owns the false-result toast without a duplicate preview toast');
await retryHarness.controls['cover-recommend-use'].click();
assert(retryHarness.modalOverlay.classList.contains('show'), 'Important 2: a rejected save keeps direct recommendation preview open');
assert.strictEqual(retryHarness.controls['cover-recommend-use'].disabled, false, 'Important 2: direct recommendation can be retried after rejection');
assert.deepStrictEqual(retryHarness.toasts, ['封面保存失败，请重试', '封面保存失败，请重试'], 'Important 2: each failed click displays exactly one dedicated error with no default toast');
await retryHarness.controls['cover-recommend-use'].click();
assert(!retryHarness.modalOverlay.classList.contains('show'), 'Important 2: direct recommendation closes only after an exact true result');
assert.strictEqual(retryHarness.saves.length, 3, 'Important 2: failure, rejection, and successful retry call setSeriesCover exactly once per accepted click');

console.log('cover-capture-preview: PASS');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
