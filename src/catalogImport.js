/**
 * 目录条目的半自动导入。
 *
 * 只处理"用户自己复制粘贴的内容"，不做任何抓取：
 * 在模之屋页面复制「角色名 + 链接」，粘进来，解析成 catalog 条目。
 *
 * 支持的粘贴格式（尽量宽容）：
 *   阿维狄亚	https://www.aplaybox.com/details/model/EtLbLO00D4aC
 *   阿维狄亚, https://...
 *   阿维狄亚 | 鸣潮 | https://...
 *   - 阿维狄亚 https://...
 *   https://...                      （只有链接时角色名留空）
 */

const STORAGE_KEY = 'vrm-poser:catalog-extra:v1';
const URL_RE = /https?:\/\/[^\s,，|、"'）)】\]]+/i;

export function parseCatalogText(text, defaultGame = '未分类') {
  const entries = [];
  const errors = [];
  const seen = new Set();

  const lines = String(text ?? '').split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;

    const m = line.match(URL_RE);
    if (!m) {
      errors.push({ line: i + 1, text: raw, reason: '没有链接' });
      return;
    }
    const sourceUrl = m[0].replace(/[.,，。]$/, '');
    if (seen.has(sourceUrl)) return; // 同一条链接粘两次
    seen.add(sourceUrl);

    // 去掉链接后剩下的部分：按分隔符切，看看有没有"角色 / 游戏"两段
    const rest = line.replace(m[0], '').replace(/^[\s,，|、\-–—:：]+|[\s,，|、\-–—:：]+$/g, '');
    const parts = rest
      .split(/[\t|,，、]+/)
      .map((p) => p.replace(/^[\s\-–—•*·]+/, '').trim())
      .filter(Boolean);

    const character = parts[0] ?? '';
    const game = parts[1] ?? defaultGame;

    const token = sourceUrl.split('/').filter(Boolean).pop() ?? String(i + 1);
    entries.push({
      id: `cat-${token}`,
      game: game || defaultGame,
      character: character || '未命名',
      outfit: '默认',
      fileName: '',
      source: '模之屋',
      sourceUrl,
      author: '',
      license: '见原页面说明',
      tags: [game || defaultGame].filter(Boolean),
      note: character ? '' : '角色名待补',
    });
  });

  return { entries, errors };
}

// ---------- 本地暂存（导入后立刻在目录里出现） ----------

export function loadExtraEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function saveExtraEntries(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function addExtraEntries(entries) {
  const cur = loadExtraEntries();
  const byUrl = new Map(cur.map((e) => [e.sourceUrl, e]));
  for (const e of entries) byUrl.set(e.sourceUrl, e);
  const next = [...byUrl.values()];
  saveExtraEntries(next);
  return next.length;
}

export function clearExtraEntries() {
  saveExtraEntries([]);
}
