'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

function fixture({ reply, online = true, persistence = false, registrationFails = false } = {}) {
  const elements = Object.fromEntries(['network-status', 'pwa-info'].map(id => [id, {
    hidden: true, textContent: '', classList: { toggle() {}, add() {}, remove() {} }
  }]));
  const listeners = new Map();
  const worker = { postMessage(message, ports) { if (reply) ports[0].postMessage(reply); } };
  class Channel {
    constructor() {
      this.port1 = { close() {}, onmessage: null };
      this.port2 = { postMessage: data => queueMicrotask(() => this.port1.onmessage?.({ data })), close() {} };
    }
  }
  const root = {
    isSecureContext: true, location: { protocol: 'https:' }, MessageChannel: Channel,
    navigator: { onLine: online, storage: { persist: async () => persistence }, serviceWorker: {
      register: async () => { if (registrationFails) throw new Error('registration failed'); return { active: worker }; },
      ready: Promise.resolve({ active: worker }), addEventListener(name, fn) { listeners.set(name, fn); }
    } },
    document: { getElementById: id => elements[id] },
    addEventListener(name, fn) { listeners.set(name, fn); }, setTimeout, clearTimeout
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'pwa.js'), 'utf8'), { window: root, console });
  return { root, elements, listeners };
}

test('registration success alone never promises offline readability', async () => {
  const f = fixture({ reply: { type: 'MANHWA_OFFLINE_STATUS', ready: false, version: 'test', missing: ['worker'] }, online: false });
  await f.root.ManhwaPWA.init();
  assert.equal(f.root.ManhwaPWA.getState().offline, 'INCOMPLETE');
  assert.doesNotMatch(f.elements['network-status'].textContent, /仍可阅读/);
  assert.match(f.elements['network-status'].textContent, /未就绪/);
});

test('confirmed complete caches and declined persistence are described separately', async () => {
  const f = fixture({ reply: { type: 'MANHWA_OFFLINE_STATUS', ready: true, version: 'test', missing: [] }, online: false });
  await f.root.ManhwaPWA.init();
  assert.equal(f.root.ManhwaPWA.getState().offline, 'READY');
  assert.equal(f.root.ManhwaPWA.getState().storage, 'BEST_EFFORT');
  assert.match(f.elements['network-status'].textContent, /仍可阅读/);
  assert.match(f.elements['pwa-info'].textContent, /浏览器.*清理/);
});

test('registration failure is visible and cannot be classified as ready', async () => {
  const f = fixture({ registrationFails: true });
  await f.root.ManhwaPWA.init();
  assert.equal(f.root.ManhwaPWA.getState().offline, 'UNAVAILABLE');
  assert.match(f.elements['pwa-info'].textContent, /未就绪/);
});
