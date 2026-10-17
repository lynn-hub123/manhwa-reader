'use strict';

function findRackBookAtPoint(slots, clientX, clientY, options) {
  const settings = options || {};
  const verticalPadding = Number(settings.verticalPadding || 0);
  const visible = (slots || []).filter((slot) => (
    slot && slot.index !== undefined &&
    Number.isFinite(slot.left) && Number.isFinite(slot.right) &&
    Number.isFinite(slot.top) && Number.isFinite(slot.bottom) &&
    clientY >= slot.top - verticalPadding && clientY <= slot.bottom + verticalPadding
  ));
  if (!visible.length) return -1;

  const leftEdge = Math.min(...visible.map((slot) => slot.left));
  const rightEdge = Math.max(...visible.map((slot) => slot.right));
  if (clientX < leftEdge || clientX >= rightEdge) return -1;

  let best = visible[0];
  let bestDistance = Math.abs(clientX - (best.left + best.right) / 2);
  for (let i = 1; i < visible.length; i += 1) {
    const slot = visible[i];
    const distance = Math.abs(clientX - (slot.left + slot.right) / 2);
    if (distance < bestDistance) {
      best = slot;
      bestDistance = distance;
    }
  }
  return best.index;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { findRackBookAtPoint };
} else if (typeof window !== 'undefined') {
  window.RackInteraction = { findRackBookAtPoint };
}
