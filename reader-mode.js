'use strict';

(function initReaderMode(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ReaderMode = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createReaderMode() {
  function isWebtoonPage(viewport, threshold) {
    const width = Number(viewport && viewport.width);
    const height = Number(viewport && viewport.height);
    const ratioThreshold = Number.isFinite(threshold) ? threshold : 3;
    return width > 0 && height / width > ratioThreshold;
  }

  function shouldUseWebtoon(viewports, threshold) {
    return (viewports || []).some((viewport) => isWebtoonPage(viewport, threshold));
  }

  return { isWebtoonPage, shouldUseWebtoon };
});
