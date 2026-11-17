import { saveModelMeta, hasDiskBackend } from './diskMeta.js';

/**
 * 入库元数据表单：模型存到磁盘后，让用户确认/修正 游戏 / 角色 / 服装 / 标签。
 * 自动猜出来的游戏名经常是"未分类"，这里是唯一的人工修正入口。
 */
export function createModelMetaUI({ onSaved, setStatus }) {
  const overlay = document.getElementById('modelmeta');
  const form = document.getElementById('modelmeta-form');
  const titleEl = document.getElementById('modelmeta-title');
  if (!overlay || !form) return { open() {}, close() {} };

  let currentDir = null;

  const field = (name) => form.querySelector(`[name="${name}"]`);

  function fill(meta) {
    if (titleEl) titleEl.textContent = `入库：${meta.character || meta.modelDir}`;
    field('character').value = meta.character ?? '';
    field('game').value = meta.game && meta.game !== '未分类' ? meta.game : '';
    field('outfit').value = meta.outfit ?? '默认';
    field('author').value = meta.author ?? '';
    field('license').value = meta.license ?? '';
    field('tags').value = Array.isArray(meta.tags) ? meta.tags.join(' ') : '';
  }

  async function open({ modelDir, character, game, outfit, author, license, tags }) {
    if (!(await hasDiskBackend())) {
      setStatus?.('当前不是 dev 模式，改元数据请手动编辑模型的 model.json', 'error');
      return;
    }
    currentDir = modelDir;
    fill({ modelDir, character, game, outfit, author, license, tags });
    overlay.classList.add('open');
    setTimeout(() => field('character')?.focus(), 50);
  }

  function close() {
    overlay.classList.remove('open');
  }

  async function submit(ev) {
    ev.preventDefault();
    if (!currentDir) return;
    const meta = {
      character: field('character').value.trim(),
      game: field('game').value.trim() || '未分类',
      outfit: field('outfit').value.trim() || '默认',
      author: field('author').value.trim(),
      license: field('license').value.trim(),
      tags: field('tags')
        .value.split(/[\s,，]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    };
    meta.name = meta.outfit && meta.outfit !== '默认' ? `${meta.character}（${meta.outfit}）` : meta.character;

    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    const res = await saveModelMeta(currentDir, meta);
    if (btn) btn.disabled = false;

    if (res?.ok) {
      setStatus?.(`已保存 ${meta.character} 的元数据`);
      close();
      onSaved?.();
    } else {
      setStatus?.(`元数据保存失败：${res?.error ?? '未知错误'}`, 'error');
    }
  }

  form.addEventListener('submit', submit);
  document.getElementById('modelmeta-cancel')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  return { open, close };
}
