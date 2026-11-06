/**
 * 缩略图缓存（IndexedDB）。
 * 键 = 模型 + 姿势 + 渲染版本；渲染设置一变（改描边/高光），版本号变，自动重烤。
 */

const DB_NAME = 'vrm-poser-thumbs';
const STORE = 'thumbs';

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  return dbPromise;
}

export async function getThumb(key) {
  try {
    const db = await openDb();
    return await new Promise((res) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => res(req.result ?? null);
      req.onerror = () => res(null);
    });
  } catch {
    return null;
  }
}

export async function setThumb(key, dataUrl) {
  try {
    const db = await openDb();
    return await new Promise((res) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(dataUrl, key);
      tx.oncomplete = () => res(true);
      tx.onerror = () => res(false);
    });
  } catch {
    return false;
  }
}

export async function clearThumbs() {
  try {
    const db = await openDb();
    await new Promise((res) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => res(true);
      tx.onerror = () => res(false);
    });
    return true;
  } catch {
    return false;
  }
}
