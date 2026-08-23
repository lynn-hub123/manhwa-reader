'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function extractFunction(name) {
  const functionStart = source.indexOf('function ' + name + '(');
  assert.notStrictEqual(functionStart, -1, name + ' must exist');
  const start = source.slice(Math.max(0, functionStart - 6), functionStart) === 'async ' ? functionStart - 6 : functionStart;
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

async function main() {
  const canvas = { width: 0, height: 0, style: {}, dataset: {}, getContext() { return {}; } };
  const wrapper = { style: {}, dataset: {}, querySelector(selector) { assert.strictEqual(selector, 'canvas'); return canvas; } };
  const pageContainer = {
    querySelector(selector) { assert.strictEqual(selector, '[data-page="1"]'); return wrapper; },
    querySelectorAll(selector) { assert.strictEqual(selector, '.page-wrapper canvas'); return [canvas]; }
  };
  const viewer = { clientWidth: 500 };
  let renderDeferred = deferred();
  let renderCancelCalled = false;
  let renderVisibleCalls = 0;
  const page = {
    getViewport({ scale }) { return { width: 100 * scale, height: 140 * scale }; },
    render() {
      return {
        promise: renderDeferred.promise,
        cancel() { renderCancelCalled = true; renderDeferred.reject(new Error('RenderingCancelledException')); }
      };
    }
  };
  const context = {
    pdfDoc: { async getPage() { return page; } },
    renderedPages: new Set(),
    renderTasks: [],
    zoom: 1,
    fitWidth: false,
    $: (id) => id === 'page-container' ? pageContainer : id === 'viewer-area' ? viewer : null,
    renderVisiblePages() { renderVisibleCalls += 1; },
    console
  };
  vm.createContext(context);
  ['setCaptureRenderState', 'markCaptureCanvasesIneligible'].forEach((name) => {
    if (source.includes('function ' + name + '(')) vm.runInContext(extractFunction(name), context);
  });
  vm.runInContext(extractFunction('renderPage'), context);
  vm.runInContext(extractFunction('reRenderAll'), context);

  const pending = context.renderPage(1);
  await flushAsyncWork();
  assert.strictEqual(canvas.dataset.captureRenderState, 'rendering', 'Important 1: render start leaves the visible canvas recommendation-ineligible');
  renderDeferred.resolve();
  await pending;
  assert.strictEqual(canvas.dataset.captureRenderState, 'complete', 'Important 1: only a fulfilled page.render promise makes the canvas eligible');

  renderDeferred = deferred();
  context.renderedPages.clear();
  const failed = context.renderPage(1);
  await flushAsyncWork();
  renderDeferred.reject(new Error('render failed'));
  await assert.rejects(failed, /render failed/);
  assert.strictEqual(canvas.dataset.captureRenderState, 'idle', 'Important 1: failed rendering leaves the canvas ineligible');
  assert(!context.renderedPages.has(1), 'Important 1: a failed page can be scheduled for rendering again');

  canvas.dataset.captureRenderState = 'complete';
  context.renderTasks = [{ cancel() { renderCancelCalled = true; } }];
  context.renderedPages.add(1);
  context.reRenderAll();
  assert.strictEqual(canvas.dataset.captureRenderState, 'idle', 'Important 1: rerender invalidates the prior completed canvas immediately');
  assert(renderCancelCalled, 'rerender cancels prior PDF render tasks');
  assert.strictEqual(renderVisibleCalls, 1, 'rerender schedules the currently visible pages again');

  console.log('capture-render-state: PASS');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
