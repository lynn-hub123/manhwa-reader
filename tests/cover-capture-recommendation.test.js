'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const CoverCapture = require('../cover-capture.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const functionNames = [
  'getVisibleCaptureSource',
  'scoreCaptureCandidate',
  'cropCanvasToDataUrl',
  'recommendVisibleCoverCrop'
];

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

function makePixels(width, height, pixelAt) {
  return function getImageData(x, y, sampleWidth, sampleHeight) {
    const data = new Uint8ClampedArray(sampleWidth * sampleHeight * 4);
    for (let row = 0; row < sampleHeight; row += 1) {
      for (let column = 0; column < sampleWidth; column += 1) {
        const pixel = pixelAt(Math.min(width - 1, Math.max(0, Math.floor(x + column))), Math.min(height - 1, Math.max(0, Math.floor(y + row))));
        const index = (row * sampleWidth + column) * 4;
        data[index] = pixel[0];
        data[index + 1] = pixel[1];
        data[index + 2] = pixel[2];
        data[index + 3] = 255;
      }
    }
    return { data };
  };
}

function makeCanvas(rect, width, height, pixelAt) {
  return {
    width,
    height,
    getBoundingClientRect() { return Object.assign({}, rect); },
    getContext() { return { getImageData: makePixels(width, height, pixelAt) }; },
    toDataURL(type, quality) { return 'data:' + type + ';base64,source-' + quality; }
  };
}

const firstCanvas = makeCanvas(
  { left: 50, top: 50, right: 450, bottom: 350, width: 400, height: 300 },
  800,
  600,
  () => [255, 255, 255]
);
const secondCanvas = makeCanvas(
  { left: 300, top: 200, right: 800, bottom: 700, width: 500, height: 500 },
  1000,
  1000,
  (x, y) => ((x + y) % 30 < 15 ? [35, 80, 150] : [220, 120, 40])
);
const viewerRect = { left: 100, top: 100, right: 700, bottom: 600, width: 600, height: 500 };
const drawCalls = [];
const viewer = {
  getBoundingClientRect() { return Object.assign({}, viewerRect); },
  querySelectorAll(selector) {
    assert.strictEqual(selector, '.page-wrapper canvas');
    return [firstCanvas, secondCanvas];
  }
};
let returnNullPreview = false;
const document = {
  querySelector(selector) {
    assert.strictEqual(selector, '#viewer-area');
    return viewer;
  },
  createElement(tag) {
    assert.strictEqual(tag, 'canvas');
    return {
      width: 0,
      height: 0,
      getContext() {
        return { drawImage(...args) { drawCalls.push(args); } };
      },
      toDataURL(type, quality) { return returnNullPreview ? null : 'data:' + type + ';base64,output-' + quality; }
    };
  }
};

const context = { CoverCapture, document, window: { innerWidth: 800, innerHeight: 500 }, Math, Number, Uint8ClampedArray };
vm.createContext(context);
functionNames.forEach((name) => vm.runInContext(extractFunction(name), context));

const visible = context.getVisibleCaptureSource();
assert.strictEqual(visible.canvas, secondCanvas, 'the largest visible canvas must be selected');
assert.deepStrictEqual(JSON.parse(JSON.stringify(visible.visibleBounds)), { x: 300, y: 200, width: 400, height: 300 });

const candidate = { x: 0, y: 0, width: 500, height: 700 };
const detailedCenterCanvas = makeCanvas(
  { left: 0, top: 0, right: 500, bottom: 700, width: 500, height: 700 },
  1000,
  1000,
  (x, y) => (x >= 400 && x < 600 && y >= 400 && y < 600 && (x + y) % 20 < 10 ? [35, 80, 150] : [255, 255, 255])
);
const whiteCanvas = makeCanvas({ left: 0, top: 0, right: 500, bottom: 700, width: 500, height: 700 }, 1000, 1000, () => [255, 255, 255]);
assert(
  context.scoreCaptureCandidate(detailedCenterCanvas, detailedCenterCanvas.getBoundingClientRect(), candidate) > context.scoreCaptureCandidate(whiteCanvas, whiteCanvas.getBoundingClientRect(), candidate),
  'a detailed non-white candidate must outrank a blank white candidate'
);

const observedCandidates = [];
const originalBuildCandidates = CoverCapture.buildCandidates;
CoverCapture.buildCandidates = function (bounds, ratio) {
  const candidates = originalBuildCandidates(bounds, ratio);
  candidates.forEach((rect) => observedCandidates.push(rect));
  return candidates;
};
const recommendation = context.recommendVisibleCoverCrop();
CoverCapture.buildCandidates = originalBuildCandidates;
assert.strictEqual(recommendation.canvas, secondCanvas);
assert.deepStrictEqual(JSON.parse(JSON.stringify(recommendation.canvasRect)), secondCanvas.getBoundingClientRect());
assert(Math.abs(recommendation.rect.width / recommendation.rect.height - 5 / 7) < 1e-10, 'recommendation ratio must remain 5:7');
assert.notStrictEqual(recommendation.rect, recommendation.originalRect, 'originalRect must be an independent copy');
assert.deepStrictEqual(JSON.parse(JSON.stringify(recommendation.rect)), JSON.parse(JSON.stringify(recommendation.originalRect)));
assert.match(recommendation.dataUrl, /^data:image\/jpeg;base64,/);
assert(observedCandidates.length > 0);
observedCandidates.forEach((rect) => assert(Math.abs(rect.width / rect.height - 5 / 7) < 1e-10, 'all scored candidates must have a 5:7 ratio'));

returnNullPreview = true;
const previewFallback = context.recommendVisibleCoverCrop();
returnNullPreview = false;
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(previewFallback.rect)),
  JSON.parse(JSON.stringify(CoverCapture.fitRect(visible.visibleBounds, 5 / 7, 0))),
  'a failed preview must retain a usable fitted fallback crop'
);

const cropSource = makeCanvas(
  { left: 100, top: 50, right: 500, bottom: 250, width: 400, height: 200 },
  1000,
  500,
  () => [0, 0, 0]
);
drawCalls.length = 0;
const cropDataUrl = context.cropCanvasToDataUrl({
  canvas: cropSource,
  canvasRect: cropSource.getBoundingClientRect(),
  rect: { x: 50, y: 30, width: 600, height: 300 }
});
assert.deepStrictEqual(drawCalls, [[cropSource, 0, 0, 1000, 500, 0, 0, 1000, 500]], 'viewport crop must map and clamp to source pixels');
assert.strictEqual(cropDataUrl, 'data:image/jpeg;base64,output-0.92');

console.log('cover-capture-recommendation: PASS');
