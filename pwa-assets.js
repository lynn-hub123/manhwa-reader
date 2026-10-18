'use strict';
(function exposeAssets(root) {
  const assets = Object.freeze([
    './', './index.html', './manifest.json', './pwa-assets.js', './pwa.js',
    './pdf-engine.js', './mobile-reader.js', './reader-mode.js', './db.js',
    './reading-progress.js', './cover-capture.js', './rack-interaction.js', './app.js',
    './vendor/pdfjs/pdf.min.js', './vendor/pdfjs/pdf.worker.min.js',
    './fonts/MaShanZheng-Regular.ttf', './icons/icon.svg',
    './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png'
  ]);
  const api = Object.freeze({ version: 'study-v5-20261018-05', assets });
  root.ManhwaAssets = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
