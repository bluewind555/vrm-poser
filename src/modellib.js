import { getThumb, setThumb as saveThumb } from './thumbs.js';

/**
 * 角色库：首屏的模型选择界面。
 * 数据来自 /models/index.json（由 scripts/scan-models.mjs 扫描生成）。
 * 卡片缩略图用 IndexedDB 缓存，第一次打开某个模型后自动补上。
 */
export function createModelLibrary({ onPick, setStatus }) {
  const overlay = document.getElementById('modellib');
  const grid = document.getElementById('modellib-grid');
  const searchInput = document.getElementById('modellib-search');
  const tabsEl = document.getElementById('modellib-tabs');
  const countEl = document.getElementById('modellib-count');
  if (!overlay || !grid) return { open() {}, close() {}, setThumb() {}, isOpen: () => false };

  let index = null;
  let game = '全部';
  let keyword = '';
  let opened = false;

  const thumbKey = (id) => `model:${id}`;

  async function loadIndex() {
    if (index) return index;
    try {
      const res = await fetch('/models/index.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      index = await res.json();
    } catch (err) {
      console.warn('[modellib] 索引读取失败', err);
      index = { games: [], models: [] };
    }
    return index;
  }

  function matches(m) {
    if (game !== '全部' && m.game !== game) return false;
    if (!keyword) return true;
    const hay = `${m.name} ${m.character} ${m.game} ${m.outfit} ${(m.tags ?? []).join(' ')}`.toLowerCase();
    return hay.includes(keyword.toLowerCase());
  }

  function renderTabs() {
    if (!tabsEl || !index) return;
    tabsEl.textContent = '';
    const games = ['全部', ...(index.games ?? [])];
    for (const g of games) {
      const btn = document.createElement('button');
      btn.className = `tab${g === game ? ' active' : ''}`;
      btn.textContent = g;
      btn.addEventListener('click', () => {
        game = g;
        renderTabs();
        renderGrid();
      });
      tabsEl.appendChild(btn);
    }
  }

  async function renderGrid() {
    grid.textContent = '';
    const list = (index?.models ?? []).filter(matches);
    if (countEl) countEl.textContent = `${list.length} / ${index?.models?.length ?? 0} 个模型`;

    if (!list.length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = index?.models?.length
        ? '没有匹配的角色'
        : '还没有模型：把解压后的模型文件夹拖进页面即可导入';
      grid.appendChild(empty);
      return;
    }

    for (const model of list) {
      const card = document.createElement('button');
      card.className = 'model-card';
      card.type = 'button';

      const thumb = document.createElement('div');
      thumb.className = 'model-thumb';
      thumb.dataset.modelId = model.id;
      const img = document.createElement('img');
      img.alt = model.name;
      img.loading = 'lazy';
      thumb.appendChild(img);

      const placeholder = document.createElement('span');
      placeholder.className = 'model-placeholder';
      placeholder.textContent = model.character.slice(0, 1);
      thumb.appendChild(placeholder);
      card.appendChild(thumb);

      const meta = document.createElement('div');
      meta.className = 'model-meta';
      const name = document.createElement('strong');
      name.textContent = model.name;
      const sub = document.createElement('span');
      sub.textContent = `${model.game} · ${(model.size / 1048576).toFixed(1)} MB`;
      meta.append(name, sub);
      card.appendChild(meta);

      if (model.license) card.title = model.license;

      card.addEventListener('click', () => {
        close();
        onPick(model);
      });

      grid.appendChild(card);
      // 已缓存的缩略图
      getThumb(thumbKey(model.id)).then((dataUrl) => {
        if (!dataUrl) return;
        img.src = dataUrl;
        thumb.classList.add('ready');
        placeholder.remove();
      });
    }
  }

  async function open() {
    opened = true;
    overlay.classList.add('open');
    await loadIndex();
    renderTabs();
    renderGrid();
    void setStatus;
  }

  function close() {
    opened = false;
    overlay.classList.remove('open');
  }

  /** 模型载入后补上卡片缩略图 */
  async function setThumb(modelId, dataUrl) {
    if (!modelId || !dataUrl) return;
    // 注意：这里必须用别名 saveThumb，否则会掉进"自己调自己"的无限递归
    await saveThumb(thumbKey(modelId), dataUrl);
    const holder = grid.querySelector(`.model-thumb[data-model-id="${modelId}"]`);
    const img = holder?.querySelector('img');
    if (img) {
      img.src = dataUrl;
      holder.classList.add('ready');
      holder.querySelector('.model-placeholder')?.remove();
    }
  }

  searchInput?.addEventListener('input', () => {
    keyword = searchInput.value.trim();
    renderGrid();
  });
  document.getElementById('modellib-close')?.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && opened) close();
  });

  return { open, close, setThumb, isOpen: () => opened };
}
