'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

test('the PDF boundary forces the official no-eval mitigation and a local worker', () => {
  const calls = [];
  const task = { promise: Promise.resolve('document') };
  const engine = { GlobalWorkerOptions: {}, getDocument(options) { calls.push(options); return task; } };
  const context = vm.createContext({ window: { pdfjsLib: engine } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'pdf-engine.js'), 'utf8'), context);
  const bytes = new Uint8Array([1, 2, 3]);
  assert.equal(context.window.ManhwaPdf.getDocument({ data: bytes, isEvalSupported: true }), task);
  assert.equal(calls[0].data, bytes);
  assert.equal(calls[0].isEvalSupported, false);
  assert.equal(engine.GlobalWorkerOptions.workerSrc, './vendor/pdfjs/pdf.worker.min.js');
});

test('every application PDF entry point passes through the protected boundary', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  // A boundary guard complements the behavioral test; it is not a rendering test.
  assert.equal(source.includes('pdfjsLib.getDocument('), false);
  assert.ok(source.includes('ManhwaPdf.getDocument('));
});
