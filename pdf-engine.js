'use strict';
(function configurePdf(root) {
  const engine = root.pdfjsLib;
  if (!engine) throw new Error('Local PDF engine is missing');
  engine.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.js';
  root.ManhwaPdf = Object.freeze({
    getDocument(options) {
      // Official mitigation for GHSA-wgrm-67xf-hhpq. All reader/cover/prefetch paths use this boundary.
      return engine.getDocument({ ...options, isEvalSupported: false });
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
