'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const start = source.indexOf('function startCoverCapture(sid)');
assert.notStrictEqual(start, -1, 'startCoverCapture must exist');

let depth = 0;
let end = -1;
let opened = false;
for (let i = source.indexOf('{', start); i < source.length; i++) {
  if (source[i] === '{') {
    depth++;
    opened = true;
  } else if (source[i] === '}') {
    depth--;
    if (opened && depth === 0) {
      end = i + 1;
      break;
    }
  }
}
assert.notStrictEqual(end, -1, 'startCoverCapture must be parseable');

const toasts = [];
const classNames = new Set(['show']);
const modalOverlay = {classList: {remove(name) { classNames.delete(name); }, contains(name) { return classNames.has(name); }}};
const modalContent = {innerHTML: ''};
const frames = [];
const shown = [];
const capture = {dataUrl: 'data:image/jpeg;base64,recommended'};

const context = {
  document: {
    getElementById(id) { return id === 'modal-overlay' ? modalOverlay : id === 'modal-content' ? modalContent : null; },
  },
  $: (id) => context.document.getElementById(id),
  showToast: (message) => toasts.push(message),
  recommendVisibleCoverCrop() { return capture; },
  showCoverRecommendation(sid, result) { shown.push([sid, result]); },
  requestAnimationFrame(callback) { frames.push(callback); },
  console,
};

vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
context.startCoverCapture('series-1');

assert(!modalOverlay.classList.contains('show'), 'capture must close the setup modal before analysis');
assert.deepStrictEqual(toasts, ['正在分析当前画面…'], 'capture must immediately report analysis loading');
assert.strictEqual(frames.length, 1, 'capture must defer analysis to one animation frame');
frames.shift()();
assert.deepStrictEqual(shown, [['series-1', capture]], 'capture must hand a recommendation to the preview');

console.log('capture-start: PASS');
