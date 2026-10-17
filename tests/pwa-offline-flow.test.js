'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const origin = 'http://localhost:8767/';

function workerFixture({ failedAsset = '', cacheFailure = '' } = {}) {
  let online = true;
  let skippedWaiting = false;
  const stores = new Map();
  const listeners = new Map();
  const requests = [];
  const key = value => new URL(typeof value === 'string' ? value : value.url, origin).href;
  const fetchAsset = async request => {
    const url = key(request); requests.push(url);
    if (!online || (failedAsset && url.includes(failedAsset))) throw new Error('simulated network failure');
    return new Response(`asset:${new URL(url).pathname}`, { status: 200 });
  };
  const caches = {
    async open(name) {
      if (cacheFailure === 'open') throw new Error('Cache storage unavailable');
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async addAll(urls) {
          const pairs = await Promise.all(urls.map(async url => [key(url), await fetchAsset(url)]));
          pairs.forEach(([url, response]) => entries.set(url, response));
        },
        async put(request, response) { entries.set(key(request), response.clone()); },
        async match(request) { if (cacheFailure === 'match') throw new Error('Cache lookup unavailable'); return entries.get(key(request))?.clone(); },
        async keys() { return [...entries.keys()].map(url => new Request(url)); }
      };
    },
    async match(request) {
      for (const entries of stores.values()) { const response = entries.get(key(request)); if (response) return response.clone(); }
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); }
  };
  const self = {
    location: { origin: new URL(origin).origin, href: `${origin}service-worker.js` },
    registration: { scope: origin },
    addEventListener(name, fn) { listeners.set(name, fn); },
    async skipWaiting() { skippedWaiting = true; }, clients: { claim: async () => {} }
  };
  const context = vm.createContext({ self, caches, fetch: fetchAsset, URL, Request, Response, Promise, console });
  context.importScripts = name => vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8'), context);
  return {
    stores, requests, caches, listeners,
    offline() { online = false; },
    waitingSkipped() { return skippedWaiting; },
    async lifecycle(type) { let pending; listeners.get(type)({ waitUntil(promise) { pending = promise; } }); await pending; },
    async get(url, mode = 'cors') {
      let result;
      const pending = [];
      listeners.get('fetch')({ request: { url: key(url), method: 'GET', mode },
        respondWith(promise) { result = promise; }, waitUntil(promise) { pending.push(promise); } });
      const response = await result; await Promise.all(pending); return response;
    },
    async status() {
      assert.ok(listeners.has('message'), 'worker must expose verifiable offline readiness');
      let response; let pending;
      listeners.get('message')({ data: { type: 'MANHWA_OFFLINE_STATUS_REQUEST' },
        ports: [{ postMessage(value) { response = value; } }], waitUntil(value) { pending = value; } });
      await pending; return response;
    }
  };
}

test('installation caches both local PDF engine and worker without a CDN dependency', async () => {
  const f = workerFixture(); await f.lifecycle('install');
  assert.ok(f.requests.some(url => url.endsWith('/pdf.min.js')));
  assert.ok(f.requests.some(url => url.endsWith('/pdf.worker.min.js')));
  assert.ok(f.requests.every(url => url.startsWith(origin)), 'installation must not depend on external origins');
});

test('the first PDF worker request can be satisfied after a cold offline restart', async () => {
  const f = workerFixture(); await f.lifecycle('install'); f.offline();
  const response = await f.get('vendor/pdfjs/pdf.worker.min.js');
  assert.ok(response instanceof Response); assert.equal(response.status, 200);
  assert.equal(await response.text(), 'asset:/vendor/pdfjs/pdf.worker.min.js');
});

test('a missing required worker aborts installation and never activates an incomplete shell', async () => {
  const f = workerFixture({ failedAsset: 'pdf.worker.min.js' });
  await assert.rejects(f.lifecycle('install'), /simulated network failure/);
  assert.equal(f.waitingSkipped(), false);
});

test('activation cleans only this reader old caches and preserves unrelated origin caches', async () => {
  const f = workerFixture();
  await f.caches.open('unrelated-app-cache'); await f.caches.open('manhwa-reader-shell-v3');
  await f.lifecycle('install'); await f.lifecycle('activate');
  assert.equal(f.stores.has('unrelated-app-cache'), true);
  assert.equal(f.stores.has('manhwa-reader-shell-v3'), false);
});

test('readiness is confirmed from actual complete cache entries, not registration success', async () => {
  const f = workerFixture(); await f.lifecycle('install');
  const ready = await f.status(); assert.equal(ready.ready, true);
  for (const entries of f.stores.values()) {
    for (const url of entries.keys()) if (url.endsWith('/pdf.worker.min.js')) entries.delete(url);
  }
  const broken = await f.status(); assert.equal(broken.ready, false);
  assert.ok(broken.missing.some(url => url.endsWith('/pdf.worker.min.js')));
});

test('offline navigation and required scripts resolve from the same installed shell', async () => {
  const f = workerFixture(); await f.lifecycle('install'); f.offline();
  for (const [url, mode] of [['./', 'navigate'], ['app.js', 'cors'], ['vendor/pdfjs/pdf.min.js', 'cors']]) {
    const response = await f.get(url, mode); assert.ok(response instanceof Response); assert.equal(response.status, 200);
  }
});

test('a missing offline resource returns an explicit HTTP failure rather than undefined', async () => {
  const f = workerFixture(); await f.lifecycle('install'); f.offline();
  const response = await f.get('missing-test-resource.js');
  assert.ok(response instanceof Response); assert.equal(response.status, 503);
});

for (const cacheFailure of ['open', 'match']) {
  test(`a cache ${cacheFailure} failure falls back to the network while online`, async () => {
    const f = workerFixture({ cacheFailure });
    const response = await f.get('app.js');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'asset:/app.js');
    assert.equal(f.requests.length, 1);
  });
  test(`a cache ${cacheFailure} failure returns explicit 503 while offline`, async () => {
    const f = workerFixture({ cacheFailure }); f.offline();
    const response = await f.get('app.js');
    assert.equal(response.status, 503);
  });
}

test('private hosting sign-in and sign-out navigation is never intercepted by the cached reader', async () => {
  const f = workerFixture(); await f.lifecycle('install');
  for (const url of ['signin-with-chatgpt', 'signout-with-chatgpt', 'callback']) {
    assert.equal(await f.get(url, 'navigate'), undefined, 'authentication belongs to Sites, not the cached app');
  }
});

test('manifest icons have matching PNG files at installable dimensions', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  for (const size of [192, 512]) {
    const icon = manifest.icons.find(item => item.sizes === `${size}x${size}` && item.type === 'image/png');
    assert.ok(icon, `missing ${size}px PNG install icon`);
    const bytes = fs.readFileSync(path.join(root, icon.src));
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.equal(bytes.readUInt32BE(16), size); assert.equal(bytes.readUInt32BE(20), size);
  }
});
