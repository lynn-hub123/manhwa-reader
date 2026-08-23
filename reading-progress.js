'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReadingProgress = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const ANCHOR_RATIO = 0.3;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizePageRatio(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return clamp(number, 0, 1);
  }

  function pageRatioAtAnchor(viewerRect, pageRect) {
    if (!viewerRect || !pageRect || !(pageRect.height > 0)) return null;
    const anchorY = viewerRect.top + viewerRect.height * ANCHOR_RATIO;
    return clamp((anchorY - pageRect.top) / pageRect.height, 0, 1);
  }

  function scrollTopForPageRatio(viewerRect, pageRect, ratio) {
    const normalized = normalizePageRatio(ratio);
    if (!viewerRect || !pageRect || normalized === null) return null;
    const anchorOffset = viewerRect.height * ANCHOR_RATIO;
    return viewerRect.scrollTop + (pageRect.top - viewerRect.top) + pageRect.height * normalized - anchorOffset;
  }

  return { ANCHOR_RATIO, normalizePageRatio, pageRatioAtAnchor, scrollTopForPageRatio };
});
