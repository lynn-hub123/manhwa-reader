'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ReadingProgress = require('../reading-progress.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function extractFunction(name) {
  const start = source.indexOf('function ' + name + '(');
  assert.notStrictEqual(start, -1, name + ' must exist');
  let brace = source.indexOf('{', start);
  let depth = 0;
  let end = brace;
  for (; end < source.length; end++) {
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

function makeHarness() {
  const wrappers = {
    1: { rect: { top: 110, height: 500 } },
    2: { rect: { top: -300, height: 2000 } }
  };
  const viewer = {
    scrollTop: 0,
    clientHeight: 600,
    scrollHeight: 3000,
    getBoundingClientRect: () => ({ top: 100, height: 600 })
  };
  const slider = { value: 1 };
  const pageContainer = {
    scrollHeight: viewer.scrollHeight,
    querySelector(selector) {
      const match = /data-page="(\d+)"/.exec(selector);
      const wrapper = match && wrappers[match[1]];
      if (!wrapper) return null;
      return {
        getBoundingClientRect: () => wrapper.rect,
        scrollIntoView: (options) => { wrapper.scrollIntoView = options; }
      };
    }
  };
  const elements = { 'viewer-area': viewer, 'page-container': pageContainer, 'page-slider': slider, 'page-info': {} };
  const series = { lastChNum: null, lastPage: null };
  const context = {
    window: { ReadingProgress },
    console,
    Math,
    parseInt,
    currentPage: 2,
    currentChIdx: 0,
    currentSeries: 'series-1',
    chapters: [{ chapterNum: 7 }],
    isWebtoon: false,
    restoringProgress: false,
    pdfDoc: { numPages: 2 },
    chapterLoadToken: 1,
    findSeries: () => series,
    saveSeriesBg: () => Promise.resolve(),
    updatePageInfo: () => {},
    setChapterStatus: () => {},
    getScrollProgress: () => Math.round((viewer.scrollTop / (viewer.scrollHeight - viewer.clientHeight)) * 100),
    renderPage: async (page) => { context.rendered.push(page); },
    $: (id) => elements[id],
    rendered: []
  };
  vm.createContext(context);
  vm.runInContext(extractFunction('getNormalPageProgress'), context);
  vm.runInContext(extractFunction('saveProgress'), context);
  vm.runInContext(extractFunction('restoreWebtoonScroll'), context);
  vm.runInContext(extractFunction('restoreNormalPageProgress'), context);
  return { context, viewer, wrappers, series };
}

async function main() {
  const harness = makeHarness();
  harness.context.saveProgress();
  assert.strictEqual(harness.series.lastPage, 2);
  assert.strictEqual(harness.series.lastPageProgress, 0.29, 'normal PDF progress should save the page-local anchor ratio');

  harness.context.restoringProgress = true;
  harness.wrappers[2].rect = { top: -800, height: 2000 };
  harness.context.saveProgress();
  assert.strictEqual(harness.series.lastPageProgress, 0.29, 'chapter initialization must not overwrite saved progress before restoration');
  harness.context.restoringProgress = false;

  harness.viewer.scrollTop = 0;
  harness.wrappers[2].rect = { top: -300, height: 2000 };
  const restored = await harness.context.restoreNormalPageProgress({ page: 2, pageProgress: 0.5 }, 1);
  assert.strictEqual(restored, true);
  assert.deepStrictEqual(harness.context.rendered, [1, 2], 'restoration should establish layout through the saved page');
  assert.strictEqual(harness.viewer.scrollTop, 420, 'restoration should target the saved content point');

  const legacy = makeHarness();
  const restoredLegacy = await legacy.context.restoreNormalPageProgress({ page: 2 }, 1);
  assert.strictEqual(restoredLegacy, true);
  assert.strictEqual(legacy.wrappers[2].scrollIntoView.behavior, 'auto', 'old records should retain page-start fallback');
  assert.strictEqual(legacy.wrappers[2].scrollIntoView.block, 'start', 'old records should retain page-start fallback');

  const webtoon = makeHarness();
  webtoon.context.isWebtoon = true;
  webtoon.series.lastPage = 42;
  webtoon.context.restoringProgress = true;
  webtoon.context.saveProgress();
  assert.strictEqual(webtoon.series.lastPage, 42, 'webtoon progress must not be overwritten during restoration');
  webtoon.context.restoringProgress = false;
  await webtoon.context.restoreWebtoonScroll(75, 1);
  assert.strictEqual(webtoon.viewer.scrollTop, 1800, 'webtoon restore should retain the existing percentage behavior');
  webtoon.context.saveProgress();
  assert.strictEqual(webtoon.series.lastPage, 75, 'webtoon save should still use the overall scroll percentage');

  console.log('normal-pdf-progress-flow: PASS');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
