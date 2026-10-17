'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function extractFunction(name) {
  const start = source.indexOf('function ' + name + '(');
  assert.notStrictEqual(start, -1, name + ' must exist');
  let brace = source.indexOf('{', start);
  let depth = 0;
  for (let end = brace; end < source.length; end++) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') {
      depth--;
      if (depth === 0) {
        const asyncStart = source.slice(Math.max(0, start - 6), start) === 'async ' ? start - 6 : start;
        return source.slice(asyncStart, end + 1);
      }
    }
  }
  throw new Error('unterminated ' + name);
}

function makeContext() {
  const context = {
    pdfDoc: { numPages: 5 },
    isWebtoon: false,
    currentPage: 3,
    getNormalPageProgress: () => 0.42,
    getNormalPageAtAnchor: () => 3,
    getNormalPageProgressAt: () => 0.42,
    getScrollProgress: () => 68,
    window: {},
    console
  };
  vm.createContext(context);
  vm.runInContext(extractFunction('captureReaderViewState'), context);
  return context;
}

async function testRerenderPreservesState() {
  const calls = { cancelled: 0, visible: 0, normal: null, webtoon: null };
  const context = {
    pdfDoc: { numPages: 5 },
    chapterLoadToken: 9,
    viewRestoreGeneration: 0,
    renderedPages: new Set([1, 2]),
    renderTasks: [{ cancel() { calls.cancelled++; } }],
    restoringProgress: false,
    isWebtoon: false,
    markCaptureCanvasesIneligible() {},
    $: () => ({ }),
    renderVisiblePages() { calls.visible++; },
    restoreNormalPageProgress: async (state, token) => { calls.normal = { state, token }; return true; },
    restoreWebtoonScroll: async (progress, token) => { calls.webtoon = { progress, token }; return true; },
    console,
    Promise
  };
  vm.createContext(context);
  vm.runInContext(extractFunction('reRenderAll'), context);
  const state = { isWebtoon: false, page: 3, pageProgress: 0.42 };
  context.reRenderAll(state);
  assert.strictEqual(calls.cancelled, 1);
  assert.strictEqual(context.renderedPages.size, 0);
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(calls.normal.token.chapter, 9, 'normal zoom rerender should restore with the current chapter token');
  assert.strictEqual(calls.normal.token.view, 1, 'normal zoom rerender should create a view restore generation');
  assert.strictEqual(calls.normal.state.pageProgress, 0.42);
  assert.strictEqual(context.restoringProgress, false);
  assert.strictEqual(calls.visible, 1, 'normal zoom rerender should render visible pages after restoring the anchor');

  context.isWebtoon = true;
  context.renderedPages.add(1);
  context.reRenderAll({ isWebtoon: true, scrollProgress: 68 });
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(calls.webtoon.progress, 68, 'webtoon zoom rerender should restore the existing overall percentage');
  assert.strictEqual(context.restoringProgress, false);
  assert.strictEqual(calls.visible, 3, 'webtoon zoom rerender should render visible pages before and after restoration');
}

function testCaptureUsesFreshAnchorPage() {
  const context = {
    pdfDoc: { numPages: 5 },
    isWebtoon: false,
    currentPage: 1,
    getNormalPageProgress: () => 0.12,
    getNormalPageAtAnchor: () => 4,
    getNormalPageProgressAt: page => page === 4 ? 0.73 : 0.12,
    getScrollProgress: () => 0,
    window: {},
    console
  };
  vm.createContext(context);
  vm.runInContext(extractFunction('captureReaderViewState'), context);
  const state = context.captureReaderViewState();
  assert.strictEqual(state.page, 4, 'zoom should recalculate the page under the reading anchor instead of trusting the debounced page state');
  assert.strictEqual(state.pageProgress, 0.73);
}

function testAnchorIgnoresUnrenderedPages() {
  const viewer = { getBoundingClientRect: () => ({ top: 0, height: 500 }) };
  const wrappers = [
    { getBoundingClientRect: () => ({ top: 100, height: 400 }), dataset: { page: '2' } },
    { getBoundingClientRect: () => ({ top: 145, height: 0 }), dataset: { page: '3' } }
  ];
  const context = {
    isWebtoon: false,
    currentPage: 2,
    $: id => id === 'viewer-area' ? viewer : { querySelectorAll: () => wrappers },
    console
  };
  vm.createContext(context);
  vm.runInContext(extractFunction('getNormalPageAtAnchor'), context);
  assert.strictEqual(context.getNormalPageAtAnchor(), 2, 'zero-height unrendered pages must not steal the reading anchor');
}

async function testNormalRestoreDisablesSmoothScroll() {
  const writes = [];
  const viewer = {
    style: { scrollBehavior: 'smooth' },
    clientHeight: 600,
    scrollHeight: 2200,
    getBoundingClientRect: () => ({ top: 0, height: 600 })
  };
  Object.defineProperty(viewer, 'scrollTop', {
    configurable: true,
    get: () => 400,
    set(value) { writes.push({ value, behavior: viewer.style.scrollBehavior }); }
  });
  const pageWrapper = { getBoundingClientRect: () => ({ top: -50, height: 800 }) };
  const slider = { value: 0 };
  const context = {
    pdfDoc: { numPages: 3 },
    isWebtoon: false,
    renderPage: async () => {},
    restoreTokenIsCurrent: () => true,
    updatePageInfo() {},
    setChapterStatus() {},
    $: id => {
      if (id === 'viewer-area') return viewer;
      if (id === 'page-container') return { querySelector: () => pageWrapper };
      if (id === 'page-slider') return slider;
      return {};
    },
    window: {
      ReadingProgress: {
        normalizePageRatio: value => value,
        scrollTopForPageRatio: () => 900
      }
    },
    console
  };
  vm.createContext(context);
  vm.runInContext(extractFunction('renderPagesForRestore'), context);
  vm.runInContext(extractFunction('withInstantScroll'), context);
  vm.runInContext(extractFunction('restoreNormalPageProgress'), context);
  await context.restoreNormalPageProgress({ page: 2, pageProgress: 0.5 }, 1);
  assert.deepStrictEqual(writes, [{ value: 900, behavior: 'auto' }], 'automatic anchor restoration must assign scrollTop without smooth animation');
  assert.strictEqual(viewer.style.scrollBehavior, 'smooth', 'normal viewer scrolling must retain its original behavior after restoration');
}

async function testRestoreRendersPagesInBatches() {
  const started = [];
  const pending = [];
  const context = {
    Promise,
    renderPage(page) {
      started.push(page);
      return new Promise(resolve => pending.push({ page, resolve }));
    },
    restoreTokenIsCurrent: () => true,
    console
  };
  vm.createContext(context);
  vm.runInContext(extractFunction('renderPagesForRestore'), context);
  const restoring = context.renderPagesForRestore(5, 1);
  await Promise.resolve();
  assert.deepStrictEqual(started, [1, 2, 3], 'restoration should start at most three page renders in one batch');
  assert.strictEqual(pending.length, 3, 'the next batch must wait for the first batch to finish');
  pending.slice(0, 3).forEach(({ resolve }) => resolve());
  await new Promise(resolve => setImmediate(resolve));
  assert.deepStrictEqual(started, [1, 2, 3, 4, 5], 'restoration should start the next batch after the first batch settles');
  pending.slice(3).forEach(({ resolve }) => resolve());
  assert.strictEqual(await restoring, true, 'batched restoration should report success when all pages finish');
}

async function testZoomRequestsAreCoalesced() {
  const started = [];
  const resolvers = [];
  const select = { value: '' };
  const context = {
    pendingZoomValue: null,
    zoomChangeRun: null,
    fitWidth: false,
    zoom: 1,
    settings: { zoom: '1' },
    captureReaderViewState: () => ({ isWebtoon: false, page: 2, pageProgress: 0.5 }),
    $: id => id === 'zoom-select' ? select : {},
    reRenderAll(state) {
      started.push({ zoom: context.zoom, fitWidth: context.fitWidth, state });
      return new Promise(resolve => resolvers.push(resolve));
    },
    console,
    Promise
  };
  vm.createContext(context);
  vm.runInContext(extractFunction('withInstantScroll'), context);
  vm.runInContext(extractFunction('requestZoomChange'), context);

  const first = context.requestZoomChange('1.25');
  await Promise.resolve();
  assert.deepStrictEqual(started.map(item => [item.zoom, item.fitWidth]), [[1.25, false]], 'the first zoom target should start immediately');

  const second = context.requestZoomChange('1.5');
  const third = context.requestZoomChange('fit');
  assert.strictEqual(started.length, 1, 'rapid zoom changes must not start overlapping rerenders');

  resolvers[0](true);
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(started.length, 2, 'a queued zoom request should start after the active rerender settles');
  assert.strictEqual(started[1].fitWidth, true, 'only the latest queued zoom target should be applied');
  assert.strictEqual(started[1].state.page, 2, 'the queued target should preserve the captured reader state');

  resolvers[1](true);
  await Promise.all([first, second, third]);
  assert.strictEqual(context.settings.zoom, 'fit');
  assert.strictEqual(context.$('zoom-select').value, 'fit');
}

async function testVisibleRenderFailuresAreHandled() {
  const wrappers = [
    { dataset: { page: '1' }, getBoundingClientRect: () => ({ top: 0, bottom: 200 }) },
    { dataset: { page: '2' }, getBoundingClientRect: () => ({ top: 200, bottom: 400 }) }
  ];
  const warnings = [];
  const context = {
    pdfDoc: {},
    renderedPages: new Set(),
    $: id => id === 'viewer-area'
      ? { getBoundingClientRect: () => ({ top: 0, bottom: 300 }) }
      : { querySelectorAll: () => wrappers },
    renderPage(page) {
      if (page === 1) return Promise.reject({ name: 'RenderingCancelledException' });
      return Promise.reject(new Error('render failed'));
    },
    console: { warn: (...args) => warnings.push(args) },
    Promise
  };
  vm.createContext(context);
  vm.runInContext(extractFunction('renderVisiblePages'), context);
  await context.renderVisiblePages();
  assert.deepStrictEqual(warnings.map(args => args[0]), ['page render failed'], 'background cancellation should be ignored while real render failures are reported');
}

async function testLatestRerenderWins() {
  const resolvers = [];
  const context = {
    pdfDoc: { numPages: 5 },
    chapterLoadToken: 9,
    viewRestoreGeneration: 0,
    renderedPages: new Set(),
    renderTasks: [],
    restoringProgress: false,
    isWebtoon: false,
    markCaptureCanvasesIneligible() {},
    renderVisiblePages() {},
    restoreNormalPageProgress: () => new Promise(resolve => resolvers.push(resolve)),
    restoreWebtoonScroll: async () => true,
    $: () => ({}),
    console,
    Promise
  };
  vm.createContext(context);
  vm.runInContext(extractFunction('reRenderAll'), context);
  context.reRenderAll({ isWebtoon: false, page: 2, pageProgress: 0.2 });
  context.reRenderAll({ isWebtoon: false, page: 2, pageProgress: 0.8 });
  resolvers[0](true);
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(context.restoringProgress, true, 'an older zoom restore must not release the latest restore guard');
  resolvers[1](true);
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(context.restoringProgress, false, 'the latest zoom restore should release the guard when it finishes');
}

const normal = makeContext();
const normalState = normal.captureReaderViewState();
assert.strictEqual(normalState.isWebtoon, false);
assert.strictEqual(normalState.page, 3);
assert.strictEqual(normalState.pageProgress, 0.42, 'normal PDF zoom should capture the current page and page-local reading anchor');

normal.isWebtoon = true;
const webtoonState = normal.captureReaderViewState();
assert.strictEqual(webtoonState.isWebtoon, true);
assert.strictEqual(webtoonState.scrollProgress, 68, 'webtoon zoom should capture its existing overall scroll percentage');

normal.pdfDoc = null;
assert.strictEqual(normal.captureReaderViewState(), null, 'zoom without an active document should not create restore state');

testCaptureUsesFreshAnchorPage();
testAnchorIgnoresUnrenderedPages();
testRerenderPreservesState().then(testLatestRerenderWins).then(testNormalRestoreDisablesSmoothScroll).then(testRestoreRendersPagesInBatches).then(testZoomRequestsAreCoalesced).then(testVisibleRenderFailuresAreHandled).then(() => console.log('zoom-anchor: PASS')).catch((error) => { console.error(error); process.exitCode = 1; });
