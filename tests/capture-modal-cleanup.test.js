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
  target.dispatch = function (type, event) { (listeners.get(type) || []).slice().forEach((listener) => listener(event)); };
  target.count = function (type) { return (listeners.get(type) || []).length; };
  return target;
}

function makeButton() {
  return { onclick: null, click() { return this.onclick && this.onclick({ currentTarget: this }); } };
}

const classes = new Set();
const overlay = makeEvents({
  classList: {
    add(name) { classes.add(name); },
    remove(name) { classes.delete(name); },
    contains(name) { return classes.has(name); }
  }
});
const controls = {};
const modalContent = {
  _innerHTML: '',
  get innerHTML() { return this._innerHTML; },
  set innerHTML(value) {
    this._innerHTML = value;
    ['set-cover-capture', 'set-cover-upload', 'set-cover-text', 'set-cover-cands', 'modal-cancel'].forEach((id) => {
      controls[id] = value.includes('id="' + id + '"') ? makeButton() : null;
    });
  },
  querySelector(selector) { return controls[selector.slice(1)] || null; },
  querySelectorAll() { return []; }
};
const timers = [];
const frames = [];
const toasts = [];
const document = {
  getElementById(id) { return id === 'modal-overlay' ? overlay : id === 'modal-content' ? modalContent : null; }
};
const context = {
  document,
  $: (id) => document.getElementById(id),
  Qs: (selector, root) => root.querySelector(selector),
  bookshelf: [],
  settings: {},
  setTimeout(callback) { timers.push(callback); return timers.length; },
  requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
  showToast(message) { toasts.push(message); },
  getVisibleCaptureSource() { return { pageNumber: 1 }; },
  buildCanonicalCaptureSource() { return Promise.resolve({ sourceKind: 'canonical100' }); },
  recommendVisibleCoverCrop() { return { dataUrl: 'data:image/jpeg;base64,recommended' }; },
  showCoverRecommendation() { overlay.classList.add('show'); },
  console
};
vm.createContext(context);
vm.runInContext(extractFunction('startCoverCapture'), context);
vm.runInContext(extractFunction('showModal'), context);

function flushTimers() { while (timers.length) timers.shift()(); }

async function main() {
  for (let round = 1; round <= 2; round += 1) {
    context.showModal('set-cover', { sid: 'series-1' });
    flushTimers();
    assert.strictEqual(overlay.count('click'), 1, 'set-cover round ' + round + ' owns one backdrop listener');
    controls['set-cover-capture'].click();
    assert(overlay.classList.contains('show'), '100% preparation keeps the setup modal visible');
    assert.strictEqual(overlay.count('click'), 1, 'preparation retains exactly one setup backdrop listener');
    assert.strictEqual(frames.length, 1, 'each capture start schedules one analysis frame');
    await frames.shift()();
    assert(overlay.classList.contains('show'), 'successful preparation transitions to the recommendation preview');
    assert.strictEqual(overlay.count('click'), 0, 'transitioning to recommendation removes the old setup backdrop listener');
  }
}

main().then(() => console.log('capture-modal-cleanup: PASS')).catch((error) => { console.error(error); process.exitCode = 1; });
