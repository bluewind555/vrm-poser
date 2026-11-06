/**
 * 姿势覆盖层：浏览器里对姿势库条目的修改（覆盖保存）。
 *
 * 姿势文件是静态资源，浏览器写不了盘；所以修改存在 localStorage，
 * 应用/烘焙缩略图时优先读覆盖。需要落盘时用「导出覆盖」把 JSON 下载下来，
 * 替换 public/poses/ 下对应文件即可。
 */

const KEY = 'vrm-poser:pose-overrides:v1';

function loadAll() {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? JSON.parse(raw) : {};
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function saveAll(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/** @returns {object|null} 覆盖后的姿势 */
export function getOverride(poseId) {
  if (!poseId) return null;
  return loadAll()[poseId]?.pose ?? null;
}

/** 覆盖时间戳，用作缩略图缓存键的一部分 */
export function getOverrideStamp(poseId) {
  if (!poseId) return 0;
  return loadAll()[poseId]?.at ?? 0;
}

export function setOverride(poseId, pose) {
  if (!poseId) return false;
  const all = loadAll();
  all[poseId] = { at: Date.now(), pose };
  return saveAll(all);
}

export function clearOverride(poseId) {
  const all = loadAll();
  if (!(poseId in all)) return false;
  delete all[poseId];
  return saveAll(all);
}

export function hasOverride(poseId) {
  return poseId in loadAll();
}

export function countOverrides() {
  return Object.keys(loadAll()).length;
}

export function exportOverrides() {
  return JSON.stringify(loadAll(), null, 2);
}
