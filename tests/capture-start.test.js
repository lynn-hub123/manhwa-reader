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

const appended = [];
const toasts = [];
const modalOverlay = {classList: {remove() {}}};

function makeElement() {
  return {
    className: '',
    style: {},
    textContent: '',
    appendChild() {},
    addEventListener() {},
    remove() {},
  };
}

const context = {
  document: {
    createElement: makeElement,
    body: {appendChild(element) { appended.push(element); }},
    addEventListener() {},
    removeEventListener() {},
  },
  $: (id) => id === 'modal-overlay' ? modalOverlay : null,
  showToast: (message) => toasts.push(message),
  setSeriesCover() {},
  console,
};

vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
context.startCoverCapture('series-1');

assert.deepStrictEqual(toasts, [], 'capture must not fail during startup');
assert.strictEqual(appended.length, 2, 'capture overlay and tip must be appended');
assert.strictEqual(appended[0].className, 'capture-overlay');
assert.strictEqual(appended[1].className, 'capture-tip');

console.log('capture-start: PASS');
