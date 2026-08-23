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
testRerenderPreservesState().then(testLatestRerenderWins).then(() => console.log('zoom-anchor: PASS')).catch((error) => { console.error(error); process.exitCode = 1; });
