'use strict';

(function initMobileReader(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MobileReader = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createMobileReader() {
  const ZOOM_STEPS = Object.freeze([0.6, 0.75, 0.9, 1, 1.25, 1.5, 2]);

  function swipeDirection(start, end, options) {
    if (!start || !end) return null;
    const opts = options || {};
    const minDistance = Number.isFinite(opts.minDistance) ? opts.minDistance : 56;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (Math.abs(dx) < minDistance || Math.abs(dx) <= Math.abs(dy) * 1.15) return null;
    return dx < 0 ? 'next' : 'previous';
  }

  function clampPinchZoom(value, steps) {
    const supported = Array.isArray(steps) && steps.length ? steps : ZOOM_STEPS;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return supported[0];
    return supported.reduce((closest, candidate) => (
      Math.abs(candidate - numeric) < Math.abs(closest - numeric) ? candidate : closest
    ), supported[0]);
  }

  return { ZOOM_STEPS, swipeDirection, clampPinchZoom };
});
