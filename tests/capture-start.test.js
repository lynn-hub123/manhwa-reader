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
const captureButton = {disabled: false, textContent: '当前画面截图'};
const modalContent = {innerHTML: '', contains(element) { return element === captureButton; }, querySelector(selector) { return selector === '#set-cover-capture' ? captureButton : null; }};
const frames = [];
const shown = [];
const visibleSource = {pageNumber: 3};
const canonicalSource = {canvas: {width: 600, height: 500}, canvasRect: {left: 0, top: 0, width: 600, height: 500}, visibleBounds: {x: 0, y: 0, width: 600, height: 500}};
const recommendation = {dataUrl: 'data:image/jpeg;base64,recommended'};
const recommendationInputs = [];

const context = {
  document: {
    getElementById(id) { return id === 'modal-overlay' ? modalOverlay : id === 'modal-content' ? modalContent : null; },
  },
  $: (id) => context.document.getElementById(id),
  Qs: (selector, root) => root.querySelector(selector),
  showToast: (message) => toasts.push(message),
  getVisibleCaptureSource() { return visibleSource; },
  buildCanonicalCaptureSource(source) { assert.strictEqual(source, visibleSource); return Promise.resolve(canonicalSource); },
  recommendVisibleCoverCrop(source) { recommendationInputs.push(source); return recommendation; },
  showCoverRecommendation(sid, result) { shown.push([sid, result]); },
  requestAnimationFrame(callback) { frames.push(callback); },
  console,
};

vm.createContext(context);
vm.runInContext(source.slice(start, end), context);

async function main() {
  context.startCoverCapture('series-1');
  assert(modalOverlay.classList.contains('show'), 'the setup modal must remain visible while the canonical view is prepared');
  assert.strictEqual(captureButton.disabled, true, 'the capture button must prevent duplicate preparation');
  assert.strictEqual(captureButton.textContent, '正在生成 100% 画面…');
  assert.deepStrictEqual(toasts, ['正在生成 100% 截图画面…'], 'capture must immediately report canonical rendering');
  assert.strictEqual(frames.length, 1, 'capture must defer analysis to one animation frame');
  await frames.shift()();
  assert.deepStrictEqual(recommendationInputs, [canonicalSource], 'recommendation must analyze the canonical 100% source rather than the reader canvas');
  assert.deepStrictEqual(shown, [['series-1', recommendation]], 'capture must hand the canonical recommendation to the preview');
}

main().then(() => console.log('capture-start: PASS')).catch((error) => { console.error(error); process.exitCode = 1; });
