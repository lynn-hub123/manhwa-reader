(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CoverCapture = factory();
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  function positive(value, fallback) {
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function fitRect(bounds, ratio, margin) {
    ratio = positive(ratio, 1);
    margin = Math.max(0, Number.isFinite(margin) ? margin : 0);
    var innerWidth = Math.max(0, bounds.width - margin * 2);
    var innerHeight = Math.max(0, bounds.height - margin * 2);
    var width = Math.min(innerWidth, innerHeight * ratio);
    var height = width / ratio;
    return {
      x: bounds.x + margin + (innerWidth - width) / 2,
      y: bounds.y + margin + (innerHeight - height) / 2,
      width: width,
      height: height
    };
  }

  function buildCandidates(bounds, ratio) {
    ratio = positive(ratio, 1);
    var scales = [0.5, 0.75, 1];
    var positions = [0, 0.5, 1];
    var candidates = [];
    var seen = Object.create(null);
    scales.forEach(function (scale) {
      var maxWidth = bounds.width * scale;
      var maxHeight = bounds.height * scale;
      var width = Math.min(maxWidth, maxHeight * ratio);
      var height = width / ratio;
      positions.forEach(function (px) {
        positions.forEach(function (py) {
          var rect = {
            x: bounds.x + (bounds.width - width) * px,
            y: bounds.y + (bounds.height - height) * py,
            width: width,
            height: height
          };
          var key = [rect.x, rect.y, rect.width, rect.height].join(',');
          if (!seen[key]) {
            seen[key] = true;
            candidates.push(rect);
          }
        });
      });
    });
    if (!candidates.length) candidates.push(fitRect(bounds, ratio, 0));
    return candidates;
  }

  function chooseCandidate(candidates, scoreCandidate) {
    if (!candidates || !candidates.length) return null;
    var best = candidates[0];
    var bestScore = scoreCandidate(best);
    for (var i = 1; i < candidates.length; i += 1) {
      var score = scoreCandidate(candidates[i]);
      if (score > bestScore) {
        best = candidates[i];
        bestScore = score;
      }
    }
    return best;
  }

  function clampRect(rect, bounds, ratio, minWidth) {
    ratio = positive(ratio, 1);
    var maxWidth = Math.min(bounds.width, bounds.height * ratio);
    var requestedWidth = positive(rect.width, minWidth);
    var width = Math.min(maxWidth, Math.max(0, requestedWidth));
    if (Number.isFinite(minWidth) && minWidth > 0 && maxWidth >= minWidth) {
      width = Math.max(width, minWidth);
    }
    var height = width / ratio;
    var x = Math.min(bounds.x + bounds.width - width, Math.max(bounds.x, Number.isFinite(rect.x) ? rect.x : bounds.x));
    var y = Math.min(bounds.y + bounds.height - height, Math.max(bounds.y, Number.isFinite(rect.y) ? rect.y : bounds.y));
    return { x: x, y: y, width: width, height: height };
  }

  return { fitRect: fitRect, buildCandidates: buildCandidates, chooseCandidate: chooseCandidate, clampRect: clampRect };
}));
