'use strict';
(function initPwa(root) {
  const state = { offline: 'CHECKING', storage: 'UNKNOWN', version: null, missing: [] };
  let initialized;
  const element = id => root.document && root.document.getElementById(id);
  const getState = () => ({ ...state, missing: [...state.missing] });
  const timeout = (promise, milliseconds) => new Promise((resolve, reject) => {
    const timer = root.setTimeout(() => reject(new Error('TIMEOUT')), milliseconds);
    Promise.resolve(promise).then(value => { root.clearTimeout(timer); resolve(value); }, error => { root.clearTimeout(timer); reject(error); });
  });

  function updateNetworkStatus() {
    const status = element('network-status');
    const ready = state.offline === 'READY';
    if (status) {
      status.hidden = root.navigator.onLine;
      status.classList.toggle('is-offline', !root.navigator.onLine);
      status.textContent = root.navigator.onLine ? '' : ready
        ? '离线模式 · 本设备已保存的章节仍可阅读'
        : '离线资源未就绪 · 请联网完成准备后再测试';
    }
    const info = element('pwa-info');
    if (info) {
      info.hidden = false;
      const preparation = ready ? '离线资源已就绪。' : state.offline === 'CHECKING'
        ? '正在准备离线资源，请保持联网。' : state.offline === 'TIMEOUT'
          ? '离线检查超时，请联网重新打开。' : '离线资源未就绪，请使用 HTTPS 并联网重新打开。';
      const storage = state.storage === 'PERSISTENT' ? '浏览器已授予持久存储，但清除网站数据仍会删除书架。'
        : '浏览器可能清理本地存储，请保留原始 PDF。';
      info.textContent = preparation + ' 手机浏览器菜单中选择“安装应用”或“添加到主屏幕”。PDF、封面和进度仅保存在当前设备与当前网址，不会上传或跨设备同步。' + storage;
    }
  }

  async function requestPersistentStorage() {
    try {
      state.storage = root.navigator.storage && root.navigator.storage.persist
        ? (await timeout(root.navigator.storage.persist(), 4000) ? 'PERSISTENT' : 'BEST_EFFORT') : 'BEST_EFFORT';
    } catch (error) { state.storage = 'UNKNOWN'; }
    updateNetworkStatus();
  }

  async function checkOfflineResources(registration) {
    let channel;
    try {
      const registered = registration || await timeout(root.navigator.serviceWorker.ready, 8000);
      const worker = root.navigator.serviceWorker.controller || registered.active;
      if (!worker || !root.MessageChannel) throw new Error('No active worker');
      channel = new root.MessageChannel();
      const response = await timeout(new Promise(resolve => {
        channel.port1.onmessage = event => resolve(event.data);
        worker.postMessage({ type: 'MANHWA_OFFLINE_STATUS_REQUEST' }, [channel.port2]);
      }), 4000);
      const expectedVersion = root.ManhwaAssets && root.ManhwaAssets.version;
      if (!response || response.type !== 'MANHWA_OFFLINE_STATUS' || !Array.isArray(response.missing)) throw new Error('Invalid worker receipt');
      state.version = response.version;
      state.missing = response.missing;
      state.offline = response.ready === true && response.missing.length === 0 && (!expectedVersion || response.version === expectedVersion) ? 'READY' : 'INCOMPLETE';
    } catch (error) { state.offline = error.message === 'TIMEOUT' ? 'TIMEOUT' : 'UNAVAILABLE'; }
    finally { if (channel) { channel.port1.close(); channel.port2.close(); } updateNetworkStatus(); }
    return getState();
  }

  async function registerServiceWorker() {
    if (!root.navigator.serviceWorker || root.location.protocol === 'file:' || root.isSecureContext === false) {
      state.offline = 'UNAVAILABLE'; updateNetworkStatus(); return;
    }
    try {
      await timeout(root.navigator.serviceWorker.register('./service-worker.js', { scope: './', updateViaCache: 'none' }), 8000);
      await checkOfflineResources();
    } catch (error) { state.offline = error.message === 'TIMEOUT' ? 'TIMEOUT' : 'UNAVAILABLE'; updateNetworkStatus(); }
  }

  function init() {
    if (initialized) return initialized;
    updateNetworkStatus();
    root.addEventListener('online', () => { updateNetworkStatus(); if (root.navigator.serviceWorker) checkOfflineResources(); });
    root.addEventListener('offline', () => { updateNetworkStatus(); if (root.navigator.serviceWorker) checkOfflineResources(); });
    // When a new SW takes over (either first install or version update), reload so
    // the page runs under the new controller and fetches the latest shell.
    if (root.navigator.serviceWorker) root.navigator.serviceWorker.addEventListener('controllerchange', () => root.location.reload());
    initialized = Promise.all([requestPersistentStorage(), registerServiceWorker()]).then(getState);
    return initialized;
  }
  root.ManhwaPWA = { init, updateNetworkStatus, checkOfflineResources, getState };
})(typeof window !== 'undefined' ? window : globalThis);
