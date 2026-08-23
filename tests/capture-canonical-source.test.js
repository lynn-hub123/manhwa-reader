'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const CoverCapture = require('../cover-capture.js');

const sourceText = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function extractFunction(name) {
  const start = sourceText.indexOf('function ' + name + '(');
  assert.notStrictEqual(start, -1, name + ' must exist');
  let depth = 0;
  let opened = false;
  for (let i = sourceText.indexOf('{', start); i < sourceText.length; i += 1) {
    if (sourceText[i] === '{') { depth += 1; opened = true; }
    else if (sourceText[i] === '}') {
      depth -= 1;
      if (opened && depth === 0) return sourceText.slice(start, i + 1);
    }
  }
  throw new Error(name + ' must be parseable');
}

const canvases = [];
const drawCalls = [];
function makeCanvas() {
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return {
        drawImage(...args) { drawCalls.push(args); }
      };
    },
    toDataURL() { return 'data:image/png;base64,canonical-source'; }
  };
  canvases.push(canvas);
  return canvas;
}

let requestedScale = null;
let renderedCanvas = null;
const page = {
  getViewport({ scale }) {
    requestedScale = scale;
    return { width: 600 * scale, height: 2000 * scale };
  },
  render({ canvasContext, viewport }) {
    renderedCanvas = { canvasContext, viewport };
    return { promise: Promise.resolve() };
  }
};

const context = {
  CoverCapture,
  document: { createElement(tag) { assert.strictEqual(tag, 'canvas'); return makeCanvas(); } },
  pdfDoc: { getPage(pageNumber) { assert.strictEqual(pageNumber, 4); return Promise.resolve(page); } },
  zoom: 1.5,
  fitWidth: false,
  Math,
  Number
};
vm.createContext(context);
vm.runInContext(extractFunction('buildCanonicalCaptureSource'), context);

async function main() {
  const currentSource = {
    pageNumber: 4,
    canvasRect: { left: -150, top: -1250, width: 900, height: 3000 },
    visibleBounds: { x: 0, y: 0, width: 600, height: 500 },
    viewportSize: { width: 600, height: 500 }
  };
  const result = await context.buildCanonicalCaptureSource(currentSource);

  assert.strictEqual(requestedScale, 1, 'the PDF page must be rendered at the canonical 100% scale');
  assert(renderedCanvas, 'the canonical PDF page must be rendered before extracting the window');
  assert.strictEqual(canvases[0].width, 600);
  assert.strictEqual(canvases[0].height, 2000);
  assert.strictEqual(result.canvas.width, 600);
  assert.strictEqual(result.canvas.height, 500);
  assert.deepStrictEqual(drawCalls[0].slice(1), [0, 750, 600, 500, 0, 0, 600, 500], 'the result must contain the 100% window centered on the current reading focus');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(result.visibleBounds)), { x: 0, y: 0, width: 600, height: 500 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(result.canvasRect)), { left: 0, top: 0, width: 600, height: 500 });
  assert.strictEqual(context.zoom, 1.5, 'capture preparation must not mutate the reader zoom');
  assert.strictEqual(context.fitWidth, false, 'capture preparation must not mutate fit-width mode');
}

main().then(() => console.log('capture-canonical-source: PASS')).catch((error) => { console.error(error); process.exitCode = 1; });
