'use strict';

const DB_NAME = 'manhwa-reader-db';
const DB_VERSION = 2;
const BOOKSHELF_STORE = 'bookshelf';
const PDF_CACHE_STORE = 'pdf-cache';
const SETTINGS_STORE = 'settings';
const COVERS_STORE = 'covers';

class ManhwaDB {
  constructor() {
    this._db = null;
    this._ready = null;
  }

  async open() {
    if (this._db) return this._db;
    if (this._ready) return this._ready;
    this._ready = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        const oldVersion = e.oldVersion;
        if (!db.objectStoreNames.contains(BOOKSHELF_STORE)) {
          db.createObjectStore(BOOKSHELF_STORE, { keyPath: 'seriesId' });
        }
        if (!db.objectStoreNames.contains(PDF_CACHE_STORE)) {
          const store = db.createObjectStore(PDF_CACHE_STORE, { keyPath: 'cacheKey' });
          store.createIndex('seriesId', 'seriesId', { unique: false });
        }
        // v2 stores
        if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
          db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(COVERS_STORE)) {
          const store = db.createObjectStore(COVERS_STORE, { keyPath: 'seriesId' });
          store.createIndex('seriesId', 'seriesId', { unique: true });
        }
        console.log('DB upgraded from v' + oldVersion + ' to v' + DB_VERSION);
      };
      req.onsuccess = (e) => {
        this._db = e.target.result;
        this._db.onclose = () => { this._db = null; this._ready = null; };
        resolve(this._db);
      };
      req.onerror = (e) => reject(e.target.error);
      req.onblocked = () => reject(new Error('DB blocked — close other tabs'));
    });
    return this._ready;
  }

  _txComplete(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
      tx.onabort = (e) => reject(e.target.error || new Error('Transaction aborted'));
    });
  }

  // ==================== Bookshelf ====================

  async loadBookshelf() {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(BOOKSHELF_STORE, 'readonly');
      const store = tx.objectStore(BOOKSHELF_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async saveSeries(series) {
    await this.open();
    const tx = this._db.transaction(BOOKSHELF_STORE, 'readwrite');
    const store = tx.objectStore(BOOKSHELF_STORE);
    store.put(series);
    await this._txComplete(tx);
  }

  async deleteSeries(seriesId) {
    await this.open();
    const tx = this._db.transaction(BOOKSHELF_STORE, 'readwrite');
    const store = tx.objectStore(BOOKSHELF_STORE);
    store.delete(seriesId);
    await this._txComplete(tx);
  }

  // ==================== Settings ====================

  async getSettings() {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(SETTINGS_STORE, 'readonly');
      const store = tx.objectStore(SETTINGS_STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const obj = {};
        (req.result || []).forEach(r => { obj[r.key] = r.value; });
        resolve(obj);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async saveSetting(key, value) {
    await this.open();
    const tx = this._db.transaction(SETTINGS_STORE, 'readwrite');
    const store = tx.objectStore(SETTINGS_STORE);
    store.put({ key, value });
    await this._txComplete(tx);
  }

  // ==================== Covers ====================

  async saveCover(seriesId, dataUrl) {
    await this.open();
    const tx = this._db.transaction(COVERS_STORE, 'readwrite');
    const store = tx.objectStore(COVERS_STORE);
    store.put({ seriesId, dataUrl, timestamp: Date.now() });
    await this._txComplete(tx);
  }

  async loadCover(seriesId) {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(COVERS_STORE, 'readonly');
      const store = tx.objectStore(COVERS_STORE);
      const req = store.get(seriesId);
      req.onsuccess = () => resolve(req.result ? req.result.dataUrl : null);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async loadAllCovers() {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(COVERS_STORE, 'readonly');
      const store = tx.objectStore(COVERS_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async deleteCover(seriesId) {
    await this.open();
    const tx = this._db.transaction(COVERS_STORE, 'readwrite');
    const store = tx.objectStore(COVERS_STORE);
    store.delete(seriesId);
    await this._txComplete(tx);
  }

  // ==================== PDF Cache ====================

  makeCacheKey(seriesId, chapterNum) {
    return seriesId + '_' + chapterNum;
  }

  async savePDF(seriesId, chapterNum, data) {
    await this.open();
    // 分块存储：大文件单条 IndexedDB 记录在 WebKit（iPad）上有损坏案例，切成 4MB 小块逐条写入
    const buf = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : new Uint8Array(data);
    const CHUNK = 4 * 1024 * 1024;
    const total = Math.max(1, Math.ceil(buf.length / CHUNK));
    const baseKey = this.makeCacheKey(seriesId, chapterNum);
    const tx = this._db.transaction(PDF_CACHE_STORE, 'readwrite');
    const store = tx.objectStore(PDF_CACHE_STORE);
    store.put({ cacheKey: baseKey, seriesId: seriesId, chapterNum: chapterNum, kind: 'chunks', chunks: total, size: buf.length, timestamp: Date.now() });
    for (let i = 0; i < total; i++) {
      store.put({ cacheKey: baseKey + '#c' + i, seriesId: seriesId, chapterNum: chapterNum, kind: 'chunk', index: i, data: new Blob([buf.subarray(i * CHUNK, Math.min((i + 1) * CHUNK, buf.length))]) });
    }
    await this._txComplete(tx);
  }

  _b64ToArrayBuffer(b64) {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }

  async loadPDF(seriesId, chapterNum) {
    await this.open();
    const checkBytes = (ab) => {
      if (!ab || ab.byteLength < 10) return '存储数据为空，请删除本书重新导入';
      try {
        if (String.fromCharCode.apply(null, new Uint8Array(ab.slice(0, 5))) !== '%PDF-') return '存储数据损坏（非 PDF 内容），请删除本书重新导入';
        if (String.fromCharCode.apply(null, new Uint8Array(ab.slice(Math.max(0, ab.byteLength - 2048)))).indexOf('%%EOF') === -1) return '存储数据不完整（尾部缺失），请删除本书重新导入';
      } catch (err) { return '存储数据无法读取，请删除本书重新导入'; }
      return null;
    };
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(PDF_CACHE_STORE, 'readonly');
      const store = tx.objectStore(PDF_CACHE_STORE);
      const req = store.get(this.makeCacheKey(seriesId, chapterNum));
      req.onsuccess = async () => {
        const rec = req.result;
        if (!rec) { reject(new Error('PDF not cached')); return; }
        try {
          let ab;
          if (rec.kind === 'chunks') {
            const tx2 = this._db.transaction(PDF_CACHE_STORE, 'readonly');
            const st2 = tx2.objectStore(PDF_CACHE_STORE);
            const baseKey = this.makeCacheKey(seriesId, chapterNum);
            const parts = await Promise.all(Array.from({ length: rec.chunks }, (_, i) => new Promise((res, rej) => {
              const r = st2.get(baseKey + '#c' + i);
              r.onsuccess = () => { r.result && r.result.data ? res(r.result.data) : rej(new Error('分块 ' + (i + 1) + '/' + rec.chunks + ' 缺失，请删除本书重新导入')); };
              r.onerror = () => rej(r.error || new Error('分块读取失败'));
            })));
            const buffers = await Promise.all(parts.map(p => p instanceof Blob ? (p.arrayBuffer ? p.arrayBuffer() : new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsArrayBuffer(p); })) : p));
            let totalLen = 0; for (const b of buffers) totalLen += b.byteLength;
            const merged = new Uint8Array(totalLen);
            let off = 0; for (const b of buffers) { merged.set(new Uint8Array(b), off); off += b.byteLength; }
            ab = merged.buffer;
          } else if (rec.encoding === 'base64') { ab = this._b64ToArrayBuffer(rec.data); }
          else if (rec.data instanceof Blob) {
            ab = rec.data.arrayBuffer ? await rec.data.arrayBuffer() : await new Promise((res, rej) => {
              const fr = new FileReader();
              fr.onload = () => res(fr.result);
              fr.onerror = () => rej(fr.error || new Error('FileReader failed'));
              fr.readAsArrayBuffer(rec.data);
            });
          } else { ab = rec.data; }
          const problem = checkBytes(ab);
          if (problem) reject(new Error(problem));
          else resolve(ab);
        } catch (err) { reject(err); }
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async pdfExists(seriesId, chapterNum) {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(PDF_CACHE_STORE, 'readonly');
      const store = tx.objectStore(PDF_CACHE_STORE);
      const req = store.get(this.makeCacheKey(seriesId, chapterNum));
      req.onsuccess = () => resolve(!!req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async deleteSeriesPDFs(seriesId) {
    await this.open();
    const tx = this._db.transaction(PDF_CACHE_STORE, 'readwrite');
    const store = tx.objectStore(PDF_CACHE_STORE);
    const idx = store.index('seriesId');
    const req = idx.openCursor(IDBKeyRange.only(seriesId));
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) { cursor.delete(); cursor.continue(); }
    };
    await this._txComplete(tx);
  }

  async getCacheStats() {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(PDF_CACHE_STORE, 'readonly');
      const store = tx.objectStore(PDF_CACHE_STORE);
      const req = store.openCursor();
      const seriesMap = {};
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          const v = cursor.value;
          if (!seriesMap[v.seriesId]) seriesMap[v.seriesId] = { count: 0, size: 0 };
          seriesMap[v.seriesId].count++;
          seriesMap[v.seriesId].size += (v.size || 0);
          cursor.continue();
        } else resolve(seriesMap);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async getStorageEstimate() {
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const est = await navigator.storage.estimate();
        return { usage: est.usage || 0, quota: est.quota || 0, pct: est.quota ? Math.round(est.usage / est.quota * 100) : 0 };
      } catch (e) { return null; }
    }
    return null;
  }

  // ==================== Migration ====================

  // Fill missing new fields (status etc.) in existing series
  normalizeSeries(s) {
    if (!s.chapters || !Array.isArray(s.chapters)) s.chapters = [];
    if (!Object.prototype.hasOwnProperty.call(s, 'groupId')) s.groupId = null;
    if (s.groupId === '') s.groupId = null;
    s.chapters.forEach(c => {
      if (!c.status) c.status = 'unread';
      if (!c.cached) c.cached = false;
      if (!c.loaded) c.loaded = false;
      if (!c.pages) c.pages = null;
    });
    return s;
  }

  async migrateFromLocalStorage() {
    try {
      const raw = localStorage.getItem('manhwa-bookshelf');
      if (!raw) return false;
      const oldData = JSON.parse(raw);
      if (!Array.isArray(oldData) || oldData.length === 0) {
        localStorage.removeItem('manhwa-bookshelf');
        return false;
      }
      for (const s of oldData) {
        const chapters = (s.chapters || []).map(c => ({
          name: c.name,
          chapterNum: c.chapterNum,
          pages: c.pages,
          cached: false,
          loaded: false,
          status: 'unread'
        }));
        await this.saveSeries({
          seriesId: s.id || s.seriesId,
          name: s.name,
          chapters: chapters,
          lastChNum: s.lastChNum || null,
          lastPage: s.lastPage || null,
          createdAt: s.createdAt || new Date().toISOString()
        });
      }
      localStorage.removeItem('manhwa-bookshelf');
      return true;
    } catch (e) {
      console.warn('Migration failed:', e);
      return false;
    }
  }
}

const db = new ManhwaDB();
