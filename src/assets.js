/**
 * 资源路径：GitHub Pages 的项目站点跑在 /<repo>/ 子路径下，
 * 代码里写死的 '/models/...' 会 404。统一用 assetUrl() 前缀 import.meta.env.BASE_URL。
 */

/** '/models/x' → '/vrm-poser/models/x'（本地开发时 base 就是 '/'） */
export function assetUrl(path) {
  if (!path) return path;
  if (/^(https?:)?\/\//.test(path) || path.startsWith('data:') || path.startsWith('blob:')) return path;
  const base = import.meta.env.BASE_URL || '/';
  if (!path.startsWith('/')) return base + path;
  return base.replace(/\/$/, '') + path;
}
