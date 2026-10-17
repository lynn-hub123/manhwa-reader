'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('mobile shell exposes installable PWA metadata and offline entry points', () => {
  const html = read('index.html');
  const manifest = JSON.parse(read('manifest.json'));
  const worker = read('service-worker.js');
  const pwa = read('pwa.js');

  assert.match(html, /name="viewport"[^>]+interactive-widget=resizes-content/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /rel="manifest"[^>]+href="manifest\.json"/);
  assert.match(pwa, /service-worker\.js/);
  assert.match(html, /id="network-status"/);
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.orientation, 'portrait');
  assert.ok(manifest.icons.some((icon) => icon.purpose.includes('maskable')));
  assert.match(worker, /cache\.addAll/);
  assert.match(worker, /index\.html/);
  const assets = require('../pwa-assets.js');
  assert.ok(assets.assets.includes('./vendor/pdfjs/pdf.min.js'));
  assert.ok(assets.assets.includes('./vendor/pdfjs/pdf.worker.min.js'));
  assert.doesNotMatch(html, /cdnjs\.cloudflare\.com/);
  assert.match(worker, /cache\.match/);
});

test('mobile reader keeps controls reachable and wires touch interactions', () => {
  const html = read('index.html');
  const app = read('app.js');
  const mobileReader = read('mobile-reader.js');
  const readerMode = read('reader-mode.js');

  assert.match(html, /id="btn-reader-more"/);
  assert.match(html, /class="reader-secondary"/);
  assert.match(html, /id="hidden-file-input"[^>]+accept="application\/pdf,\.pdf"/);
  assert.match(html, /100dvh/);
  assert.match(html, /safe-area-inset-bottom/);
  assert.match(html, /#topbar \.spacer\{display:none\}/);
  assert.match(html, /touch-action:\s*pan-y/);
  assert.match(html, /#bottombar[^}]*grid-template/);
  assert.match(app, /ManhwaPWA\.init/);
  assert.match(app, /bindMobileReaderGestures/);
  assert.match(app, /MobileReader\.swipeDirection/);
  assert.match(app, /MobileReader\.clampPinchZoom/);
  assert.match(app, /showModal\('reader-more'\)/);
  assert.match(mobileReader, /module\.exports/);
  assert.match(app, /await detectWebtoon\(\)/);
  assert.match(readerMode, /shouldUseWebtoon/);
});

test('Capacitor scaffold keeps the web app as the native shell source', () => {
  const config = JSON.parse(read(path.join('capacitor', 'capacitor.config.json')));
  const readme = read(path.join('capacitor', 'README.md'));

  assert.equal(config.appId, 'com.manhwa.reader');
  assert.equal(config.webDir, '..');
  assert.match(readme, /npx cap add android/);
  assert.match(readme, /签名|signing/i);
});
