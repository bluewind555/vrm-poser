/**
 * 浏览器端的模型收藏库（IndexedDB）。
 *
 * 「载入文件夹」是纯内存的 blob 加载，刷新就没了；这里把用户拖进来的模型
 * （PMX + 贴图）持久化到 IndexedDB，下次打开还能在角色库里看到、能直接加载。
 *
 * 注意：这是**浏览器本地存储**，不是 public/models/ 磁盘目录。
 * 想要进仓库/给别人用，还是得放到 public/models 然后 npm run scan。
 */

const DB_NAME = 'vrm-poser-models';
const STORE = 'models';

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((res, rej) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        const out = fn(store);
        t.oncomplete = () => res(out?.result ?? out);
        t.onerror = () => rej(t.error);
      }),
  );
}

/**
 * 保存一个模型。
 * @param {{id:string, meta:object, files:{path:string, blob:Blob}[]}} record
 */
export async function saveLocalModel(record) {
  try {
    await tx('readwrite', (store) => store.put(record));
    return true;
  } catch (err) {
    console.warn('[modelStore] 保存失败', err);
    return false;
  }
}

/** 列出所有本地模型（不带文件内容，避免占内存） */
export async function listLocalModels() {
  try {
    const all = await tx('readonly', (store) => store.getAll());
    return (all ?? []).map((r) => ({
      ...r.meta,
      id: r.id,
      source: 'local',
      fileCount: r.files?.length ?? 0,
      size: (r.files ?? []).reduce((s, f) => s + (f.blob?.size ?? 0), 0),
    }));
  } catch (err) {
    console.warn('[modelStore] 读取失败', err);
    return [];
  }
}

export async function getLocalModel(id) {
  try {
    return await tx('readonly', (store) => store.get(id));
  } catch {
    return null;
  }
}

export async function deleteLocalModel(id) {
  try {
    await tx('readwrite', (store) => store.delete(id));
    return true;
  } catch {
    return false;
  }
}

/** 从一组 File 里挑主模型文件并生成记录 */
export function buildRecord(files, { id, meta }) {
  const list = [...files];
  const pmx = list.filter((f) => f.name.toLowerCase().endsWith('.pmx')).sort((a, b) => b.size - a.size)[0];
  const main = pmx ?? list.find((f) => /\.(vrm|glb)$/i.test(f.name));
  if (!main) return null;

  const relOf = (f) => String(f.__relPath || f.webkitRelativePath || f.name).replace(/\\/g, '/');
  const mainPath = relOf(main);
  const dir = mainPath.includes('/') ? mainPath.slice(0, mainPath.lastIndexOf('/') + 1) : '';

  return {
    id,
    meta: {
      ...meta,
      kind: main.name.toLowerCase().endsWith('.pmx') ? 'pmx' : 'glb',
      fileName: main.name,
      mainPath,
    },
    files: list.map((f) => ({ path: relOf(f), blob: f, dir })),
  };
}
