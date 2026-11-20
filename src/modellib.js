import { getThumb, setThumb as saveThumb } from './thumbs.js';
import { listLocalModels } from './modelStore.js';

/**
 * 角色库：首屏的模型选择界面。
 * 数据来自 /models/index.json（由 scripts/scan-models.mjs 扫描生成）。
 * 卡片缩略图用 IndexedDB 缓存，第一次打开某个模型后自动补上。
 */
export function createModelLibrary({ onPick, onDelete, onEdit, setStatus }) {
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

  // 缩略图是否已缓存：id -> boolean（批量烘焙要靠它判断"谁还没图"）
  const thumbState = new Map();
  const bakeStatusEl = document.getElementById('modellib-bake');

  async function loadIndex() {
    if (index) return index;
    let disk = { games: [], models: [] };
    try {
      const res = await fetch('/models/index.json');
      if (res.ok) disk = await res.json();
    } catch (err) {
      console.warn('[modellib] 索引读取失败', err);
    }
    // 合并浏览器收藏库（用户拖进来、存在 IndexedDB 的模型）
    const local = await listLocalModels();
    const models = [...(disk.models ?? []), ...local];
    const games = [...new Set(models.map((m) => m.game).filter(Boolean))];
    index = { games, models };
    return index;
  }

  /** 收藏库变动后重新读（上传/删除模型时调用） */
  function reload() {
    index = null;
    if (opened) {
      loadIndex().then(() => {
        renderTabs();
        renderGrid();
      });
    }
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

    // 同一游戏 + 同一角色归成一张卡，多套服装在卡内切换
    const groups = new Map();
    for (const model of list) {
      const key = `${model.game ?? ''}|${model.character ?? model.name}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(model);
    }
    if (countEl) countEl.textContent += ` · ${groups.size} 个角色`;

    for (const [, models] of groups) {
      // 默认服装优先当封面
      models.sort((a, b) => (a.outfit === '默认' ? -1 : 0) - (b.outfit === '默认' ? -1 : 0));
      const model = models[0];
      const multi = models.length > 1;
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
      name.textContent = model.character || model.name;
      const sub = document.createElement('span');
      sub.textContent = multi
        ? `${model.game} · ${models.length} 套服装`
        : `${model.game} · ${(model.size / 1048576).toFixed(1)} MB`;
      meta.append(name, sub);
      card.appendChild(meta);

      // 多套服装：卡内一排 pill，点哪套加载哪套
      if (multi) {
        const pills = document.createElement('div');
        pills.className = 'outfit-pills';
        for (const m of models) {
          const pill = document.createElement('span');
          pill.className = 'outfit-pill';
          pill.textContent = m.outfit || '默认';
          pill.title = `加载 ${m.name}`;
          pill.addEventListener('click', (ev) => {
            ev.stopPropagation();
            close();
            onPick(m);
          });
          pills.appendChild(pill);
        }
        card.appendChild(pills);
      }

      if (model.source === 'local') {
        const badge = document.createElement('span');
        badge.className = 'local-badge';
        badge.textContent = '本地收藏';
        card.appendChild(badge);
      }

      // 编辑元数据（只对磁盘模型开放：浏览器里的模型没有 model.json）
      if (model.source !== 'local' && onEdit) {
        const edit = document.createElement('span');
        edit.className = 'model-act edit';
        edit.title = '编辑元数据';
        edit.textContent = '✎';
        edit.addEventListener('click', (ev) => {
          ev.stopPropagation();
          onEdit(model);
        });
        card.appendChild(edit);
      }

      // 删除
      if (onDelete) {
        const del = document.createElement('span');
        del.className = 'model-act del';
        del.title = '删除这个模型';
        del.textContent = '✕';
        del.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          const ok = window.confirm(`确定删除「${model.name}」？\n${model.source === 'local' ? '会从浏览器收藏库移除' : `会删除 public/models/${model.id}/ 整个目录`}`);
          if (!ok) return;
          await onDelete(model);
          reload();
        });
        card.appendChild(del);
      }

      if (model.license) card.title = model.license;

      card.addEventListener('click', () => {
        close();
        onPick(model);
      });

      grid.appendChild(card);
      // 已缓存的缩略图
      getThumb(thumbKey(model.id)).then((dataUrl) => {
        thumbState.set(model.id, !!dataUrl);
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

  /** 还没缩略图的模型（供批量烘焙用） */
  function needsThumbs() {
    return (index?.models ?? []).filter((m) => thumbState.get(m.id) === false);
  }

  function setBakeStatus(text) {
    if (!bakeStatusEl) return;
    bakeStatusEl.textContent = text || '';
    bakeStatusEl.hidden = !text;
  }

  return { open, close, reload, setThumb, needsThumbs, setBakeStatus, isOpen: () => opened };
}





