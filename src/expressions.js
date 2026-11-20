/**
 * 表情（morph）面板。
 *
 * PMX 的表情是顶点 morph：加载器已经把 type=1 的 morph 建成 morph target，
 * 并把 type=0 的组展开成"一个名字驱动多个 target"。这里只负责收集权重、调 applyMorphs。
 */

/** 常用表情的候选名（不同模型命名不一，按顺序找第一个存在的） */
const PRESETS = [
  { label: '微笑', names: ['にっこり', '笑い', '喜び', 'smile'] },
  { label: '开心', names: ['喜び', 'にっこり', '笑い'] },
  { label: '生气', names: ['怒り', '怒り目', 'angry'] },
  { label: '难过', names: ['悲しむ', '困る', 'sad'] },
  { label: '惊讶', names: ['びっくり', 'びっくり左', 'surprised'] },
  { label: '眨眼', names: ['まばたき', 'ウィンク', 'blink'] },
  { label: '闭眼', names: ['ウィンク２', 'ウィンク', 'まばたき'] },
  { label: '张嘴', names: ['あ', 'ワ', '口上'] },
];

export function createExpressionPanel({ getAvatar, setStatus }) {
  const listEl = document.getElementById('expression-list');
  const presetEl = document.getElementById('expression-presets');
  const resetBtn = document.getElementById('btn-expr-reset');
  const countEl = document.getElementById('expression-count');
  if (!listEl || !presetEl) return { attach() {}, reset() {} };

  const weights = new Map(); // 用户手动设的：name -> 0..1
  const ephemeral = new Map(); // 自动眨眼这类瞬时叠加，不写回滑条
  const motionExpr = new Map(); // 动作自带的情绪表情（播放期间生效）
  let morphs = [];

  const apply = () => {
    const avatar = getAvatar();
    if (!avatar?.applyMorphs) return;
    const map = {};
    for (const [name, w] of weights) if (w > 0.001) map[name] = w;
    // 动作表情垫底，瞬时值（眨眼）再叠加，取较大者，避免翻倍
    for (const [name, w] of motionExpr) if (w > 0.001 && !map[name]) map[name] = w;
    for (const [name, w] of ephemeral) if (w > 0.001) map[name] = Math.max(map[name] ?? 0, w);
    avatar.applyMorphs(map);
  };

  const paint = () => {
    for (const row of listEl.children) {
      const name = row.dataset.name;
      const w = weights.get(name) ?? 0;
      const input = row.querySelector('input');
      const out = row.querySelector('output');
      if (input) input.value = String(w);
      if (out) out.textContent = `${Math.round(w * 100)}%`;
      row.classList.toggle('active', w > 0.01);
    }
  };

  function attach(avatar) {
    weights.clear();
    morphs = avatar?.morphList ?? [];
    listEl.textContent = '';
    if (countEl) countEl.textContent = morphs.length ? `${morphs.length} 个可调（${new Set(morphs.map((m) => m.panel)).size} 组）` : '';

    if (!morphs.length) {
      const p = document.createElement('p');
      p.className = 'hint small';
      p.textContent = '当前模型没有顶点表情（VRM 人偶不支持）';
      listEl.appendChild(p);
      paintPresets();
      return;
    }

    // 只展示有意义的：跳过明显的左右分体（*左/*右），它们由组表情驱动
    const shown = morphs.filter((m) => !/[左右]$/.test(m.name));
    for (const m of shown) {
      const row = document.createElement('div');
      row.className = 'expr-row';
      row.dataset.name = m.name;

      const label = document.createElement('span');
      label.className = 'expr-name';
      label.textContent = m.name;
      label.title = m.englishName || m.name;

      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '1';
      input.step = '0.05';
      input.value = '0';
      input.addEventListener('input', () => {
        weights.set(m.name, Number(input.value));
        apply();
        paint();
      });

      const out = document.createElement('output');
      out.textContent = '0%';

      row.append(label, input, out);
      listEl.appendChild(row);
    }
    paintPresets();
    paint();

    // 自动眨眼：优先找 まばたき
    blink.morph = morphs.find((m) => m.name === 'まばたき')?.name ?? morphs.find((m) => /まばたき|blink/i.test(m.name))?.name ?? null;
    if (blink.enabled && blink.morph) scheduleBlink();
    else clearTimeout(blink.timer);
    refreshBlinkButton();
  }

  function paintPresets() {
    const names = new Set((getAvatar()?.morphList ?? []).map((m) => m.name));
    for (const btn of presetEl.children) {
      const preset = PRESETS.find((p) => p.label === btn.dataset.label);
      const hit = preset?.names.find((n) => names.has(n));
      btn.disabled = !hit;
      btn.title = hit ? `对应表情：${hit}` : '当前模型没有这个表情';
      btn.dataset.morph = hit ?? '';
    }
  }

  function setOnly(name, value = 1) {
    weights.clear();
    if (name) weights.set(name, value);
    apply();
    paint();
  }

  /** 动作播放时套用情绪表情：传候选名数组，取第一个当前模型有的 */
  function setMotionExpression(candidates = []) {
    motionExpr.clear();
    // 用户已经手动设了表情就不抢：否则会出现"又生气又微笑"的怪脸
    const userHasExpression = [...weights.values()].some((w) => w > 0.01);
    if (candidates?.length && !userHasExpression) {
      const names = new Set((getAvatar()?.morphList ?? []).map((m) => m.name));
      const hit = candidates.find((n) => names.has(n));
      if (hit) motionExpr.set(hit, 1);
    }
    apply();
    return [...motionExpr.keys()][0] ?? null;
  }

  function clearMotionExpression() {
    if (!motionExpr.size) return;
    motionExpr.clear();
    apply();
  }

  /** 当前手动表情（用于存进姿势） */
  function getWeights() {
    const out = {};
    for (const [name, w] of weights) if (w > 0.01) out[name] = Math.round(w * 100) / 100;
    return out;
  }

  /** 从姿势里恢复表情（整体替换手动层） */
  function setWeights(map) {
    weights.clear();
    for (const [name, w] of Object.entries(map ?? {})) {
      if (typeof w === 'number' && w > 0.001) weights.set(name, Math.min(1, w));
    }
    apply();
    paint();
  }

  function reset() {
    weights.clear();
    ephemeral.clear();
    apply();
    paint();
  }

  // ---------- 自动眨眼 ----------
  // 人对"完全不眨眼"极其敏感，静置时加一个随机眨眼循环，观感立刻不一样。
  const blink = {
    enabled: true,
    morph: null,
    timer: null,
    closing: false,
  };

  const BLINK_CLOSE_MS = 90;

  function blinkOnce() {
    if (!blink.enabled || !blink.morph) return;
    ephemeral.set(blink.morph, 1);
    apply();
    setTimeout(() => {
      // 20% 概率连眨两下，更像真人
      const double = Math.random() < 0.2;
      ephemeral.delete(blink.morph);
      apply();
      if (double) {
        setTimeout(() => {
          ephemeral.set(blink.morph, 1);
          apply();
          setTimeout(() => {
            ephemeral.delete(blink.morph);
            apply();
          }, BLINK_CLOSE_MS);
        }, 120);
      }
    }, BLINK_CLOSE_MS);
  }

  function scheduleBlink() {
    clearTimeout(blink.timer);
    if (!blink.enabled || !blink.morph) return;
    // 2.2~6.5 秒随机，和人眼真实频率接近
    const wait = 2200 + Math.random() * 4300;
    blink.timer = setTimeout(() => {
      blinkOnce();
      scheduleBlink();
    }, wait);
  }

  const autoBtn = document.getElementById('btn-autoblink');

  function refreshBlinkButton() {
    if (!autoBtn) return;
    const has = !!blink.morph;
    autoBtn.disabled = !has;
    autoBtn.textContent = '自动眨眼：' + (has && blink.enabled ? '开' : '关');
    autoBtn.title = has ? `使用表情「${blink.morph}」` : '当前模型没有眨眼表情';
  }

  function setBlinkEnabled(on) {
    blink.enabled = !!on;
    if (!blink.enabled) {
      clearTimeout(blink.timer);
      if (blink.morph) {
        ephemeral.delete(blink.morph);
        apply();
      }
    } else {
      scheduleBlink();
    }
    refreshBlinkButton();
  }

  autoBtn?.addEventListener('click', () => {
    setBlinkEnabled(!blink.enabled);
    setStatus?.('自动眨眼：' + (blink.enabled ? '开' : '关'));
  });

  for (const p of PRESETS) {
    const btn = document.createElement('button');
    btn.className = 'btn ghost small';
    btn.textContent = p.label;
    btn.dataset.label = p.label;
    btn.addEventListener('click', () => {
      const hit = btn.dataset.morph;
      if (!hit) return;
      setOnly(hit);
      setStatus?.(`表情：${p.label}（${hit}）`);
    });
    presetEl.appendChild(btn);
  }

  resetBtn?.addEventListener('click', () => {
    reset();
    setStatus?.('已清空所有表情');
  });

  return { attach, reset, setBlinkEnabled, setMotionExpression, clearMotionExpression, getWeights, setWeights };
}




