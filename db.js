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
    const tx = this._db.transaction(PDF_CACHE_STORE, 'readwrite');
    const store = tx.objectStore(PDF_CACHE_STORE);
    const record = {
      cacheKey: this.makeCacheKey(seriesId, chapterNum),
      seriesId: seriesId,
      chapterNum: chapterNum,
      data: data,
      size: data.byteLength,
      timestamp: Date.now()
    };
    store.put(record);
    await this._txComplete(tx);
  }

  async loadPDF(seriesId, chapterNum) {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(PDF_CACHE_STORE, 'readonly');
      const store = tx.objectStore(PDF_CACHE_STORE);
      const req = store.get(this.makeCacheKey(seriesId, chapterNum));
      req.onsuccess = () => {
        if (req.result && req.result.data) resolve(req.result.data);
        else reject(new Error('PDF not cached'));
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

