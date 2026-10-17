'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { build } = require('../tools/package-pwa.cjs');
const root = path.resolve(__dirname, '..');
const list = directory => fs.readdirSync(directory, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile()).map(entry => path.relative(directory, path.join(entry.parentPath, entry.name)).replaceAll('\\', '/')).sort();

test('the actual static artifact contains only reader assets and licenses, not the source workspace', () => {
  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'manhwa-package-test-')), 'dist');
  const receipt = build(root, target);
  const files = list(target);
  assert.ok(files.includes('vendor/pdfjs/pdf.worker.min.js'));
  assert.ok(files.includes('fonts/OFL.txt'));
  assert.ok(files.includes('service-worker.js'));
  assert.equal(files.some(file => /(^|\/)(tests|docs|capacitor|\.git|\.env)(\/|$)|\.pdf$|server\.js$|\.bat$|CURRENT-PROGRESS/i.test(file)), false);
  assert.deepEqual(files, receipt.files.map(item => item.path).sort());
  for (const entry of receipt.files) assert.equal(fs.readFileSync(path.join(target, entry.path)).equals(fs.readFileSync(path.join(root, entry.path))), true);
});

test('packaging refuses to overwrite any existing output directory', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'manhwa-package-preserve-'));
  const marker = path.join(target, 'keep.txt'); fs.writeFileSync(marker, 'keep');
  assert.throws(() => build(root, target), /empty|overwrite/i);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'keep');
});
