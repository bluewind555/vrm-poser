import { getThumb } from './thumbs.js';

/**
 * 模型目录：只放"去模之屋下载"的入口，不含模型文件。
 *
 * 与角色库的关系：
 * - 角色库 = 本机已有的模型（public/models/index.json）
 * - 目录   = 想收藏的清单（public/catalog/models.json）
 * 两者靠文件名/角色名匹配，目录卡片上就能看出"已收藏 / 去下载"。
 */

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/\.(pmx|vrm|glb)$/i, '')
    .replace(/[\s_\-()（）【】[\]]+/g, '');

export function createCatalog({ onPick, setStatus }) {
  const overlay = document.getElementById('catalog');
  const grid = document.getElementById('catalog-grid');
  const searchInput = document.getElementById('catalog-search');
  const tabsEl = document.getElementById('catalog-tabs');
  const countEl = document.getElementById('catalog-count');
  if (!overlay || !grid) return { open() {}, close() {}, isOpen: () => false };

  let entries = null;
  let localModels = [];
  let game = '全部';
  let keyword = '';
  let opened = false;

  async function load() {
    if (entries) return;
    const [cat, idx] = await Promise.all([
      fetch('/catalog/models.json').then((r) => (r.ok ? r.json() : { entries: [] })).catch(() => ({ entries: [] })),
      fetch('/models/index.json').then((r) => (r.ok ? r.json() : { models: [] })).catch(() => ({ models: [] })),
    ]);
    entries = Array.isArray(cat.entries) ? cat.entries : [];
    localModels = Array.isArray(idx.models) ? idx.models : [];
  }

  /** 目录条目 → 本机模型（按文件名优先，再按角色名） */
  function findLocal(entry) {
    const byFile = entry.fileName
      ? localModels.find((m) => norm(m.fileName).includes(norm(entry.fileName)) || norm(entry.fileName).includes(norm(m.fileName)))
      : null;
    if (byFile) return byFile;
    return localModels.find((m) => norm(m.character) === norm(entry.character) && norm(m.game) === norm(entry.game)) ?? null;
  }

  function matches(entry) {
    if (game !== '全部' && entry.game !== game) return false;
    if (!keyword) return true;
    const hay = `${entry.character} ${entry.game} ${entry.outfit} ${(entry.tags ?? []).join(' ')}`.toLowerCase();
    return hay.includes(keyword.toLowerCase());
  }

  function renderTabs() {
    if (!tabsEl) return;
    tabsEl.textContent = '';
    const games = ['全部', ...new Set((entries ?? []).map((e) => e.game).filter(Boolean))];
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

  function renderGrid() {
    grid.textContent = '';
    const list = (entries ?? []).filter(matches);
    let owned = 0;
    if (countEl) countEl.textContent = `${list.length} / ${entries?.length ?? 0} 条目录`;

    if (!list.length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = '目录是空的，往 public/catalog/models.json 里加条目即可';
      grid.appendChild(empty);
      return;
    }

    for (const entry of list) {
      const local = findLocal(entry);
      if (local) owned += 1;

      const card = document.createElement('button');
      card.className = `model-card catalog-card${local ? ' owned' : ''}`;
      card.type = 'button';

      const thumb = document.createElement('div');
      thumb.className = 'model-thumb';
      const img = document.createElement('img');
      img.alt = entry.character;
      thumb.appendChild(img);
      const placeholder = document.createElement('span');
      placeholder.className = 'model-placeholder';
      placeholder.textContent = entry.character.slice(0, 1);
      thumb.appendChild(placeholder);
      card.appendChild(thumb);

      const meta = document.createElement('div');
      meta.className = 'model-meta';
      const name = document.createElement('strong');
      name.textContent = entry.character;
      const sub = document.createElement('span');
      sub.textContent = `${entry.game}${entry.outfit && entry.outfit !== '默认' ? ` · ${entry.outfit}` : ''}`;
      meta.append(name, sub);
      card.appendChild(meta);

      const badge = document.createElement('span');
      badge.className = `cat-badge${local ? ' owned' : ''}`;
      badge.textContent = local ? '已收藏' : entry.sourceUrl ? '去下载' : '待补链接';
      card.appendChild(badge);

      if (entry.author || entry.license) {
        card.title = [entry.author && `作者：${entry.author}`, entry.license && `许可：${entry.license}`]
          .filter(Boolean)
          .join('\n');
      }

      if (local) {
        getThumb(`model:${local.id}`).then((dataUrl) => {
          if (!dataUrl) return;
          img.src = dataUrl;
          thumb.classList.add('ready');
          placeholder.remove();
        });
        card.addEventListener('click', () => {
          close();
          onPick(local);
        });
      } else {
        card.addEventListener('click', () => {
          if (!entry.sourceUrl) {
            setStatus?.(`「${entry.character}」的下载链接还没补，编辑 public/catalog/models.json`, 'error');
            return;
          }
          window.open(entry.sourceUrl, '_blank', 'noopener');
          setStatus?.(`已在浏览器打开「${entry.character}」的模之屋页面，下载解压后拖回页面即可入库`);
        });
      }

      grid.appendChild(card);
    }

    if (countEl && owned) countEl.textContent += `（已收藏 ${owned}）`;
  }

  async function open() {
    opened = true;
    overlay.classList.add('open');
    await load();
    renderTabs();
    renderGrid();
  }

  function close() {
    opened = false;
    overlay.classList.remove('open');
  }

  searchInput?.addEventListener('input', () => {
    keyword = searchInput.value.trim();
    renderGrid();
  });
  document.getElementById('catalog-close')?.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && opened) close();
  });

  return { open, close, isOpen: () => opened };
}
