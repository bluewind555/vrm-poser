const STORAGE_KEY = 'vrm-poser:tuning:v3';

export const TUNING_DEFAULTS = {
  outlineOn: true,
  outline: 0.002, // 描边粗细（世界单位）
  shading: 0.85, // 明暗下限：1.0 = 纯平，0.55 = 强对比
  key: 2.0, // 主光强度
  ambient: 1.1, // 环境光强度
  rim: 0.9, // 轮廓光强度
  sph: 0.55, // 球面贴图（头发/金属高光）强度，0 = 关闭
  contact: 0.85, // 接触阴影浓度，0 = 关闭
};

const NUMERIC = ['outline', 'shading', 'key', 'ambient', 'rim', 'sph', 'contact'];

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    const state = { ...TUNING_DEFAULTS };
    for (const key of Object.keys(TUNING_DEFAULTS)) {
      const v = saved[key];
      if (key === 'outlineOn') {
        if (typeof v === 'boolean') state[key] = v;
      } else if (typeof v === 'number' && Number.isFinite(v)) {
        state[key] = v;
      }
    }
    return state;
  } catch {
    return { ...TUNING_DEFAULTS };
  }
}

/**
 * 渲染调节面板：描边 / 明暗 / 三盏灯的强度。
 * 状态存在 localStorage，改完立刻 apply，刷新后保留。
 */
export function createTuning({ apply, setStatus = null }) {
  const $ = (id) => document.getElementById(id);
  const state = load();

  const rows = [
    { key: 'outline', input: 'tune-outline', out: 'tune-outline-v', digits: 4 },
    { key: 'shading', input: 'tune-shading', out: 'tune-shading-v', digits: 2 },
    { key: 'key', input: 'tune-key', out: 'tune-key-v', digits: 2 },
    { key: 'ambient', input: 'tune-ambient', out: 'tune-ambient-v', digits: 2 },
    { key: 'rim', input: 'tune-rim', out: 'tune-rim-v', digits: 2 },
    { key: 'sph', input: 'tune-sph', out: 'tune-sph-v', digits: 2 },
    { key: 'contact', input: 'tune-contact', out: 'tune-contact-v', digits: 2 },
  ];

  const sync = () => {
    for (const row of rows) {
      const input = $(row.input);
      const out = $(row.out);
      if (input) input.value = String(state[row.key]);
      if (out) out.textContent = Number(state[row.key]).toFixed(row.digits);
    }
    const box = $('tune-outline-on');
    if (box) box.checked = state.outlineOn;
  };

  const persist = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* 存不下就算了 */
    }
  };

  const commit = () => {
    apply(state);
    sync();
    persist();
  };

  // 拖动过程中就写盘（节流 250ms），拖动被中途打断也不会丢
  let saveTimer = 0;
  const schedulePersist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 250);
  };

  for (const row of rows) {
    const input = $(row.input);
    if (!input) continue;
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      state[row.key] = v;
      apply(state);
      const out = $(row.out);
      if (out) out.textContent = v.toFixed(row.digits);
      schedulePersist();
    });
    input.addEventListener('change', () => {
      persist();
      setStatus?.('渲染设置已保存');
    });
  }

  const onBox = $('tune-outline-on');
  if (onBox) {
    onBox.addEventListener('change', () => {
      state.outlineOn = onBox.checked;
      commit();
    });
  }

  const resetBtn = $('btn-tune-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      Object.assign(state, TUNING_DEFAULTS);
      commit();
    });
  }

  sync();
  apply(state);

  return { state, apply: () => apply(state) };
}


