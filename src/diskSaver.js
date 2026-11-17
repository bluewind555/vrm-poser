/**
 * 把拖进来的模型写到本地磁盘（public/models/<目录>/）。
 *
 * 浏览器本身写不了磁盘，这里借助 `npm run dev` 启动的本地服务：
 * Vite 中间件 /__save-model 负责落盘，/__scan 重跑索引。
 * 纯静态部署时这些接口不存在，调用方要退回浏览器收藏库（IndexedDB）。
 */

/** 探测本地写盘能力（dev server 才有） */
export async function canSaveToDisk() {
  try {
    const res = await fetch('/__save-model', { method: 'GET' });
    if (!res.ok) return false;
    const data = await res.json();
    return data?.available === true;
  } catch {
    return false;
  }
}

const relOf = (f) => String(f.__relPath || f.webkitRelativePath || f.name).replace(/\\/g, '/');

/**
 * @param {File[]} files
 * @param {{onProgress?: (done:number, total:number)=>void}} [opts]
 * @returns {Promise<{ok:boolean, modelDir?:string, saved?:number, failed?:number, error?:string}>}
 */
export async function saveFilesToDisk(files, { onProgress } = {}) {
  const list = [...files];
  if (!list.length) return { ok: false, error: '没有文件' };

  // 目录名取第一个文件的顶层目录（webkitRelativePath 的第一段）
  const firstParts = relOf(list[0]).split('/').filter(Boolean);
  const modelDir = firstParts.length > 1 ? firstParts[0] : (list[0].name.replace(/\.[^.]+$/, '') || 'model');

  let saved = 0;
  let failed = 0;
  let done = 0;

  // 并发 4 路：模型动辄几十个贴图，串行传会很慢
  const CONCURRENCY = 4;
  let cursor = 0;

  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= list.length) return;
      const f = list[i];
      const parts = relOf(f).split('/').filter(Boolean);
      const rel = (parts.length > 1 ? parts.slice(1) : parts).join('/');
      try {
        const res = await fetch(`/__save-model?model=${encodeURIComponent(modelDir)}&path=${encodeURIComponent(rel)}`, {
          method: 'POST',
          body: f,
          headers: { 'content-type': 'application/octet-stream' },
        });
        if (res.ok) saved += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
      done += 1;
      onProgress?.(done, list.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));

  if (!saved) return { ok: false, error: '所有文件都写入失败' };

  try {
    await fetch('/__scan', { method: 'POST' });
  } catch {
    /* 扫描失败不影响文件已写入 */
  }

  return { ok: true, modelDir, saved, failed };
}
