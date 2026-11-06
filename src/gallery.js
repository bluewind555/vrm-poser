import { getThumb, setThumb, clearThumbs } from './thumbs.js';
import { getOverride, hasOverride, countOverrides } from './poseStore.js';

/**
 * 姿势库画廊：卡片网格 + 搜索 + 缩略图懒烘焙。
 * 缩略图是"用当前模型现烤"的，不是第三方图片——所以换模型/改渲染都会自动重烤。
 */
export function createGallery({ bakeThumb, onApply, setStatus, getCacheKey, onEditState }) {
  const overlay = document.getElementById('gallery');
  const grid = document.getElementById('gallery-grid');
  const searchInput = document.getElementById('gallery-search');
  const countEl = document.getElementById('gallery-count');
  const hiddenBtn = document.getElementById('gallery-hidden');
  if (!overlay || !grid) return { open() {}, close() {}, reload() {} };

  const HIDDEN_KEY = 'vrm-poser:hidden-poses';
  const loadHidden = () => {
    try {
      return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]'));
    } catch {
      return new Set();
    }
  };
  const saveHidden = (set) => {
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set]));
    } catch {
      /* 存不下就算了 */
    }
  };
  let hidden = loadHidden();

  let poses = null;
  let keyword = '';
  let baking = false;
  let opened = false;
  let showHidden = false;

  async function loadManifest() {
    if (poses) return poses;
    try {
      const res = await fetch('/poses/manifest.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      poses = Array.isArray(data.poses) ? data.poses : [];
    } catch (err) {
      console.warn('[gallery] manifest 读取失败', err);
      poses = [];
    }
    return poses;
  }

  function matches(pose) {
    const isHidden = hidden.has(pose.id);
    if (isHidden && !showHidden) return false;
    if (!keyword) return true;
    const hay = `${pose.name} ${pose.category ?? ''} ${(pose.tags ?? []).join(' ')}`.toLowerCase();
    return hay.includes(keyword.toLowerCase());
  }

  function renderGrid() {
    grid.textContent = '';
    const list = (poses ?? []).filter(matches);
    if (countEl) {
      const hiddenCount = hidden.size;
      countEl.textContent = `${list.length} / ${poses?.length ?? 0} 个姿势${hiddenCount && !showHidden ? `（已隐藏 ${hiddenCount}）` : ''}`;
    }
    if (hiddenBtn) {
      hiddenBtn.hidden = hidden.size === 0;
      hiddenBtn.textContent = showHidden ? '取消显示已隐藏' : `显示已隐藏 (${hidden.size})`;
    }
    if (!list.length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = poses?.length ? '没有匹配的姿势' : '姿势清单是空的';
      grid.appendChild(empty);
      return;
    }
    for (const pose of list) {
      const card = document.createElement('button');
      card.className = 'pose-card';
      card.type = 'button';
      if (hidden.has(pose.id)) card.classList.add('is-hidden');

      // 筛选：把不满意的初稿隐藏（可随时恢复）
      const hideBtn = document.createElement('span');
      hideBtn.className = 'pose-hide';
      hideBtn.title = hidden.has(pose.id) ? '恢复显示' : '隐藏这个姿势';
      hideBtn.textContent = hidden.has(pose.id) ? '↺' : '✕';
      hideBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (hidden.has(pose.id)) hidden.delete(pose.id);
        else hidden.add(pose.id);
        saveHidden(hidden);
        renderGrid();
      });
      card.appendChild(hideBtn);

      const thumb = document.createElement('div');
      thumb.className = 'pose-thumb';
      thumb.dataset.poseId = pose.id;
      const img = document.createElement('img');
      img.alt = pose.name;
      img.loading = 'lazy';
      thumb.appendChild(img);
      card.appendChild(thumb);

      const meta = document.createElement('div');
      meta.className = 'pose-meta';
      const name = document.createElement('strong');
      name.textContent = pose.name;
      const cat = document.createElement('span');
      cat.textContent = pose.category ?? '';
      meta.append(name, cat);
      card.appendChild(meta);

      // 标记：躺卧类由单目估计不可信，提示需要手工修
      if ((pose.flags ?? []).includes('lying')) {
        const warn = document.createElement('span');
        warn.className = 'pose-flag';
        warn.textContent = '需手修';
        warn.title = '躺卧姿势单目估计不可靠（检测器对躺着的人基本失效）';
        card.appendChild(warn);
      }

      card.addEventListener('click', async () => {
        try {
          // 有覆盖版本就用覆盖的（用户改过的）
          const override = getOverride(pose.id);
          if (override) {
            onApply({ ...override, id: pose.id }, pose);
            close();
            return;
          }
          const res = await fetch(pose.file);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          onApply({ ...(await res.json()), id: pose.id }, pose);
          close();
        } catch (err) {
          setStatus?.(`姿势读取失败：${err.message}`, 'error');
        }
      });

      // 已修改标记
      if (hasOverride(pose.id)) {
        const edited = document.createElement('span');
        edited.className = 'pose-edited';
        edited.textContent = '已改';
        edited.title = '这个姿势有覆盖保存的修改';
        card.appendChild(edited);
      }

      grid.appendChild(card);
    }
  }

  /** 逐个把没有缓存缩略图的姿势烤出来（不阻塞界面） */
  async function bakeMissing() {
    if (baking || !poses) return;
    baking = true;
    try {
      for (const pose of poses) {
        const key = await getCacheKey(pose);
        const cached = await getThumb(key);
        if (cached) {
          applyThumbToCard(pose.id, cached);
          continue;
        }
        if (!opened) break;
        const dataUrl = await bakeThumb(pose);
        if (dataUrl) {
          await setThumb(key, dataUrl);
          applyThumbToCard(pose.id, dataUrl);
        }
      }
    } finally {
      baking = false;
    }
  }

  function applyThumbToCard(poseId, dataUrl) {
    const holder = grid.querySelector(`.pose-thumb[data-pose-id="${poseId}"]`);
    const img = holder?.querySelector('img');
    if (img) {
      img.src = dataUrl;
      holder.classList.add('ready');
    }
  }

  async function open() {
    opened = true;
    overlay.classList.add('open');
    await loadManifest();
    renderGrid();
    // 先把已缓存的图贴出来，再慢慢烤缺的
    for (const pose of poses ?? []) {
      const cached = await getThumb(await getCacheKey(pose));
      if (cached) applyThumbToCard(pose.id, cached);
    }
    bakeMissing();
  }

  function close() {
    opened = false;
    overlay.classList.remove('open');
    onEditState?.(countOverrides());
  }

  function reload() {
    poses = null;
    if (opened) open();
  }

  document.getElementById('gallery-close')?.addEventListener('click', close);
  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && opened) close();
  });
  searchInput?.addEventListener('input', () => {
    keyword = searchInput.value.trim();
    renderGrid();
  });
  hiddenBtn?.addEventListener('click', () => {
    showHidden = !showHidden;
    renderGrid();
  });
  document.getElementById('gallery-rebake')?.addEventListener('click', async () => {
    await clearThumbs();
    setStatus?.('已清空缩略图缓存，重新烘焙中…');
    grid.querySelectorAll('.pose-thumb.ready').forEach((el) => {
      el.classList.remove('ready');
      const img = el.querySelector('img');
      if (img) img.removeAttribute('src');
    });
    bakeMissing();
  });

  return { open, close, reload };
}


