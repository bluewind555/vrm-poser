/**
 * 磁盘侧操作：写元数据、删模型、重扫索引。
 * 只在 `npm run dev`（Vite 中间件）下可用；静态部署时全部返回 false。
 */

async function postJson(url, body) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? '' : JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return await res.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** 探测磁盘写能力（写一个空 meta 不会发生，这里用 GET /__save-model） */
export async function hasDiskBackend() {
  try {
    const res = await fetch('/__save-model', { method: 'GET' });
    if (!res.ok) return false;
    return (await res.json())?.available === true;
  } catch {
    return false;
  }
}

/** 写 model.json（游戏/角色/服装/标签） */
export async function saveModelMeta(modelDir, meta) {
  const r = await postJson(`/__save-meta?model=${encodeURIComponent(modelDir)}`, meta);
  if (r?.ok) await rescan();
  return r;
}

/** 删除 public/models/<dir> 整个目录 */
export async function deleteDiskModel(modelDir) {
  const r = await postJson(`/__delete-model?model=${encodeURIComponent(modelDir)}`);
  if (r?.ok) await rescan();
  return r;
}

/** 重跑扫描，刷新 index.json */
export async function rescan() {
  return postJson('/__scan');
}
