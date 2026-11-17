import { parseCatalogText, addExtraEntries, loadExtraEntries, saveExtraEntries } from './catalogImport.js';

/**
 * 导入面板：粘贴 → 预览 → 导入（存 localStorage）→ 可导出完整 JSON 落盘。
 * 只处理用户粘贴的文本，不做任何抓取。
 */
export function createCatalogImportUI({ onImported, setStatus }) {
  const overlay = document.getElementById('catimport');
  const textarea = document.getElementById('catimport-text');
  const gameInput = document.getElementById('catimport-game');
  const preview = document.getElementById('catimport-preview');
  const stat = document.getElementById('catimport-stat');
  if (!overlay || !textarea) return { open() {}, close() {} };

  let parsed = [];

  const renderPreview = () => {
    if (!preview) return;
    preview.textContent = '';
    if (!parsed.length) return;
    for (const e of parsed.slice(0, 200)) {
      const row = document.createElement('div');
      row.className = 'catimport-row';
      const name = document.createElement('strong');
      name.textContent = e.character;
      const meta = document.createElement('span');
      meta.textContent = `${e.game} · ${e.sourceUrl.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)}`;
      row.append(name, meta);
      preview.appendChild(row);
    }
  };

  function parse() {
    const { entries, errors } = parseCatalogText(textarea.value, gameInput?.value?.trim() || '未分类');
    parsed = entries;
    if (stat) {
      stat.textContent = `解析出 ${entries.length} 条${errors.length ? `，${errors.length} 行有问题` : ''}`;
    }
    renderPreview();
    return parsed;
  }

  function apply() {
    if (!parsed.length) parse();
    if (!parsed.length) {
      setStatus?.('没有解析出条目，检查一下粘贴内容', 'error');
      return;
    }
    const total = addExtraEntries(parsed);
    setStatus?.(`已导入 ${parsed.length} 条（本地新增共 ${total} 条，导出 JSON 才能落盘）`);
    close();
    onImported?.();
  }

  async function exportJson() {
    // 合并：仓库里的 catalog + 本地新增
    let fileEntries = [];
    try {
      const res = await fetch('/catalog/models.json');
      if (res.ok) {
        const data = await res.json();
        fileEntries = Array.isArray(data.entries) ? data.entries : [];
      }
    } catch {
      /* 忽略 */
    }
    const byUrl = new Map(fileEntries.map((e) => [e.sourceUrl || e.id, e]));
    for (const e of loadExtraEntries()) byUrl.set(e.sourceUrl || e.id, e);
    const merged = {
      format: 'model-catalog/1',
      updatedAt: new Date().toISOString().slice(0, 10),
      note: '只放页面链接，不放模型文件。sourceUrl 为空表示还没补，界面上点不动。',
      entries: [...byUrl.values()],
    };
    const blob = new Blob([JSON.stringify(merged, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'models.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus?.('已下载 models.json，替换 public/catalog/ 下的同名文件即可');
    void saveExtraEntries;
  }

  function open() {
    overlay.classList.add('open');
    if (!textarea.value) {
      textarea.value = '';
    }
    parse();
  }
  function close() {
    overlay.classList.remove('open');
  }

  document.getElementById('catimport-close')?.addEventListener('click', close);
  document.getElementById('catimport-parse')?.addEventListener('click', parse);
  document.getElementById('catimport-apply')?.addEventListener('click', apply);
  document.getElementById('catimport-export')?.addEventListener('click', exportJson);
  textarea.addEventListener('input', () => {
    parsed = [];
    if (stat) stat.textContent = '';
    if (preview) preview.textContent = '';
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  return { open, close };
}

