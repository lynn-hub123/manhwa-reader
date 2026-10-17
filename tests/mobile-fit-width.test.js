'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const start = source.indexOf('async function renderPage(pn){');
const end = source.indexOf('\nfunction renderVisiblePages', start);

for (const previousZoom of [0.6, 1, 1.5, 2]) {
  test(`fit width uses unscaled PDF dimensions after ${previousZoom * 100}% zoom`, async () => {
    const canvas = { style: {}, dataset: {}, getContext: () => ({}),
      set width(value) { this._width = Math.trunc(value); }, get width() { return this._width; },
      set height(value) { this._height = Math.trunc(value); }, get height() { return this._height; } };
    const wrapper = { style: {}, querySelector: () => canvas };
    const ctx = {
      zoom: previousZoom, fitWidth: true, renderedPages: new Set(), renderTasks: [],
      $: id => id === 'viewer-area' ? { clientWidth: 369 } : { querySelector: () => wrapper },
      setCaptureRenderState(cv) { cv._captureRenderVersion = 1; return 1; },
      pdfDoc: { getPage: async () => ({
        getViewport: ({ scale }) => ({ width: 300 * scale, height: 420 * scale }),
        render: () => ({ promise: Promise.resolve() })
      }) }
    };
    vm.createContext(ctx); vm.runInContext(source.slice(start, end), ctx);
    await ctx.renderPage(1);
    assert.equal(Math.round(canvas.width), 329);
    assert.equal(canvas.height, 460);
    assert.equal(Number(canvas.dataset.pdfScale), 329 / 300);
  });
}

test('switching from a horizontally panned zoom to fit clears horizontal offset after layout restoration', async () => {
  const viewer = { scrollLeft: 849, style: { scrollBehavior: 'smooth' } };
  const state = { page: 2, pageProgress: 0.4 };
  const ctx = {
    pendingZoomValue: null, zoomChangeRun: null, settings: {}, fitWidth: false, zoom: 2,
    $: id => id === 'viewer-area' ? viewer : { value: '' }, captureReaderViewState: () => state,
    reRenderAll: async received => { assert.equal(received, state); viewer.scrollLeft = 540; }, console
  };
  const helperStart = source.indexOf('function withInstantScroll(');
  const helperEnd = source.indexOf('\n', helperStart);
  const zoomStart = source.indexOf('function requestZoomChange(');
  const zoomEnd = source.indexOf('\nfunction goToPage', zoomStart);
  vm.createContext(ctx);
  vm.runInContext(source.slice(helperStart, helperEnd), ctx);
  vm.runInContext(source.slice(zoomStart, zoomEnd), ctx);
  await ctx.requestZoomChange('fit');
  assert.equal(viewer.scrollLeft, 0);
  assert.equal(viewer.style.scrollBehavior, 'smooth');
});

test('reopening with fit waits until the formerly hidden reader has a measurable viewport', async () => {
  let width = 0; const frames = []; const viewports = [];
  const canvas = { dataset: {}, style: {}, getContext: () => ({}) };
  const wrapper = { style: {}, querySelector: () => canvas };
  const ctx = {
    fitWidth: true, zoom: 1.5, renderedPages: new Set(), renderTasks: [],
    $: id => id === 'viewer-area' ? { get clientWidth() { return width; } } : { querySelector: () => wrapper },
    requestAnimationFrame: fn => frames.push(fn), cancelAnimationFrame() {}, setTimeout, clearTimeout, Date, Promise,
    setCaptureRenderState(cv) { cv._captureRenderVersion = 1; return 1; },
    pdfDoc: { getPage: async () => ({ getViewport: ({ scale }) => ({ width: 600 * scale, height: 840 * scale }),
      render: ({ viewport }) => { viewports.push(viewport); return { promise: Promise.resolve() }; } }) }
  };
  vm.createContext(ctx);
  const helperStart = source.indexOf('function waitForReaderViewport(');
  if (helperStart >= 0) vm.runInContext(source.slice(helperStart, source.indexOf('\nasync function renderPage', helperStart)), ctx);
  vm.runInContext(source.slice(start, end), ctx);
  const pending = ctx.renderPage(1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(viewports.length, 0, 'a hidden viewport must not produce a completed 1px render');
  width = 363;
  frames.splice(0).forEach(fn => fn());
  await pending;
  assert.equal(Math.floor(canvas.width), 323);
  assert.equal(Math.floor(canvas.height), 452);
});

test('invalidating a canvas after viewport measurement prevents the awaited stale render from starting', async () => {
  let width = 0; let renderCalls = 0; const frames = [];
  const canvas = { dataset: {}, style: {}, getContext: () => ({}) };
  const wrapper = { style: {}, querySelector: () => canvas };
  const ctx = {
    fitWidth: true, zoom: 1, renderedPages: new Set(), renderTasks: [],
    $: id => id === 'viewer-area' ? { get clientWidth() { return width; } } : { querySelector: () => wrapper },
    requestAnimationFrame: fn => frames.push(fn), cancelAnimationFrame() {}, setTimeout, clearTimeout, Promise,
    setCaptureRenderState(cv, state, expected) {
      if (expected !== undefined && cv._captureRenderVersion !== expected) return null;
      if (expected === undefined) cv._captureRenderVersion = (cv._captureRenderVersion || 0) + 1;
      cv.dataset.captureRenderState = state; return cv._captureRenderVersion;
    },
    pdfDoc: { getPage: async () => ({ getViewport: ({ scale }) => ({ width: 600 * scale, height: 840 * scale }),
      render: () => { renderCalls++; return { promise: Promise.resolve() }; } }) }
  };
  vm.createContext(ctx);
  const helperStart = source.indexOf('function waitForReaderViewport(');
  vm.runInContext(source.slice(helperStart, source.indexOf('\nasync function renderPage', helperStart)), ctx);
  vm.runInContext(source.slice(start, end), ctx);
  const pending = ctx.renderPage(1);
  await new Promise(resolve => setImmediate(resolve));
  width = 363;
  frames.splice(0).forEach(fn => fn());
  canvas._captureRenderVersion++;
  canvas.dataset.captureRenderState = 'idle';
  await pending;
  assert.equal(renderCalls, 0, 'a cancelled canvas must not start an obsolete PDF render');
  assert.equal(canvas.width, undefined);
  assert.equal(canvas.dataset.captureRenderState, 'idle');
});

function viewportWaitFixture() {
  let alarm; let cleared = 0; let frameId = 0; const frames = new Map();
  const canvas = { _captureRenderVersion: 1 };
  const ctx = {
    $: () => ({ clientWidth: 0 }), Promise,
    setTimeout(fn) { alarm = fn; return 1; }, clearTimeout() { cleared++; },
    requestAnimationFrame(fn) { const id = ++frameId; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); }
  };
  const begin = source.indexOf('function waitForReaderViewport(');
  vm.createContext(ctx); vm.runInContext(source.slice(begin, source.indexOf('\nasync function renderPage', begin)), ctx);
  return { canvas, ctx, frames, expire: () => alarm(), cleared: () => cleared };
}

test('closing the reader cancels its viewport wait without rendering stale content', async () => {
  const f = viewportWaitFixture(); const pending = f.ctx.waitForReaderViewport(f.canvas, 1);
  f.canvas._captureRenderVersion = 2;
  const fn = f.frames.values().next().value; f.frames.clear(); fn();
  assert.equal(await pending, null); assert.equal(f.cleared(), 1); assert.equal(f.frames.size, 0);
});

test('an unmeasurable reader has a bounded timeout and cleans its animation callback', async () => {
  const f = viewportWaitFixture(); const pending = f.ctx.waitForReaderViewport(f.canvas, 1);
  const assertion = assert.rejects(pending, /TIMEOUT/); f.expire(); await assertion;
  assert.equal(f.cleared(), 1); assert.equal(f.frames.size, 0);
});
