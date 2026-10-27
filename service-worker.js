'use strict';
importScripts('./pwa-assets.js');
const SHELL_CACHE = 'manhwa-reader-shell-' + self.ManhwaAssets.version;
const APP_SHELL = self.ManhwaAssets.assets;
const scope = self.registration.scope;
const absolute = path => new URL(path, scope).href;

self.addEventListener('install', event => {
  // addAll is atomic: an unavailable required resource rejects installation.
  // skipWaiting lets UI fixes land on the very next open instead of after two restarts.
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => /^(manhwa-reader-shell-|manhwa-reader-runtime-)/.test(key) && key !== SHELL_CACHE)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('message', event => {
  if (!event.data || event.data.type !== 'MANHWA_OFFLINE_STATUS_REQUEST' || !event.ports[0]) return;
  event.waitUntil(caches.open(SHELL_CACHE).then(async cache => {
    const missing = [];
    for (const asset of APP_SHELL) if (!(await cache.match(absolute(asset)))) missing.push(asset);
    event.ports[0].postMessage({ type: 'MANHWA_OFFLINE_STATUS', version: self.ManhwaAssets.version, ready: missing.length === 0, missing });
  }));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (/^\/(signin-with-chatgpt|signout-with-chatgpt|callback)(\/|$)/.test(url.pathname)) return;
  // HTML navigation: network-first so updates land on next open, fall back to cache offline.
  // Everything else stays cache-first — static assets are immutable within the versioned shell.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const resp = await fetch(request);
        if (resp && resp.ok) {
          const copy = resp.clone();
          caches.open(SHELL_CACHE).then(cache => cache.put(absolute('./index.html'), copy));
          return resp;
        }
      } catch (error) { /* Network down — fall through to cache */ }
      try {
        const cache = await caches.open(SHELL_CACHE);
        const cached = await cache.match(absolute('./index.html'));
        if (cached) return cached;
      } catch (error) { /* Storage failure */ }
      return new Response('Offline — no cached shell available.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    })());
    return;
  }
  event.respondWith((async () => {
    try {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
    } catch (error) { /* Storage failure must not prevent ordinary online use. */ }
    try { return await fetch(request); }
    catch (error) { return new Response('Required resource is unavailable offline.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
  })());
});
