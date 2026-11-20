import {
  HUMANOID_BONES,
  POSE_FORMAT,
  applyPose,
  capturePose,
  getEulerDegrees,
  getHipsOffset,
  resetAll,
  resetBone,
  setEulerDegrees,
  setHipsOffset,
  snapToGround,
} from './pose.js';

const STORAGE_KEY = 'vrm-poser:presets';

const BUILTIN = [
  { id: 'neutral', label: '自然站立', file: '/poses/neutral.json' },
  { id: 'wave', label: '招手', file: '/poses/wave.json' },
  { id: 'sit', label: '坐姿', file: '/poses/sit.json' },
];

const AXES = ['x', 'y', 'z'];

export function createUI({ getAvatar, onLoadFile, onLoadFiles, onUseMannequin, onFrame, onPoseImages, onBeforePose, onAfterPose, onCaptureMeta }) {
  const $ = (id) => document.getElementById(id);

  const statusEl = $('status');
  const boneSelect = $('bone');
  const jsonArea = $('json');
  const presetBox = $('presets');
  const hipsSlider = $('hips-y');
  const hipsOut = $('hips-y-v');
  const sliders = {};
  const outputs = {};

  let currentBone = 'spine';
  let applying = false;
  let boneHint = $('bone-hint');

  for (const axis of AXES) {
    sliders[axis] = $(`rot-${axis}`);
    outputs[axis] = $(`rot-${axis}-v`);
  }

  // name → 中文名，置信度提示用
  const BONE_LABEL = Object.fromEntries(HUMANOID_BONES.map((b) => [b.name, b.label]));

  // ---------- 骨骼下拉 ----------
  const groups = new Map();
  for (const bone of HUMANOID_BONES) {
    if (!groups.has(bone.group)) {
      const og = document.createElement('optgroup');
      og.label = bone.group;
      boneSelect.appendChild(og);
      groups.set(bone.group, og);
    }
    const opt = document.createElement('option');
    opt.value = bone.name;
    opt.textContent = `${bone.label}  ${bone.name}`;
    groups.get(bone.group).appendChild(opt);
  }
  boneSelect.value = currentBone;

  // ---------- 状态 ----------
  function setStatus(text, kind = 'info') {
    statusEl.textContent = text;
    statusEl.dataset.kind = kind;
  }

  // ---------- 滑条同步 ----------
  function syncSliders() {
    const avatar = getAvatar();
    if (!avatar) return;
    const [x, y, z] = getEulerDegrees(avatar.humanoid, currentBone);
    const values = { x, y, z };
    for (const axis of AXES) {
      sliders[axis].value = String(values[axis]);
      outputs[axis].textContent = `${values[axis].toFixed(1)}°`;
    }
    const has = !!avatar.humanoid?.getNormalizedBoneNode?.(currentBone);
    boneHint.textContent = has ? '' : '（当前模型缺少该骨骼，已跳过）';

    const [hx, hy, hz] = getHipsOffset(avatar.humanoid);
    hipsSlider.value = String(hy);
    hipsOut.textContent = `${hy.toFixed(2)} m`;
  }

  /** 主循环里每帧调用：外部改了姿势（比如换模型）时保持 UI 一致 */
  let lastSync = 0;
  function syncFromAvatar() {
    const now = performance.now();
    if (now - lastSync < 120) return; // 滑条不需要 60fps
    lastSync = now;
    if (!applying) syncSliders();
  }

  for (const axis of AXES) {
    sliders[axis].addEventListener('input', () => {
      const avatar = getAvatar();
      if (!avatar) return;
      const next = AXES.map((a) => Number(sliders[a].value));
      applying = true;
      setEulerDegrees(avatar.humanoid, currentBone, next);
      applying = false;
      syncSliders();
    });
  }

  boneSelect.addEventListener('change', () => {
    currentBone = boneSelect.value;
    syncSliders();
  });

  hipsSlider.addEventListener('input', () => {
    const avatar = getAvatar();
    if (!avatar) return;
    const [x, , z] = getHipsOffset(avatar.humanoid);
    applying = true;
    setHipsOffset(avatar.humanoid, [x, Number(hipsSlider.value), z]);
    applying = false;
    hipsOut.textContent = `${Number(hipsSlider.value).toFixed(2)} m`;
  });

  // ---------- 姿势应用 ----------
  function currentPose(name = 'untitled') {
    const avatar = getAvatar();
    if (!avatar) return null;
    const extra = onCaptureMeta?.() ?? {};
    return capturePose(avatar.humanoid, name, {
      scaleHint: 1,
      rig: avatar.kind,
      savedAt: new Date().toISOString(),
      ...extra,
    });
  }

  /** PMX 模型没有实体归一化骨骼，接地要用真实骨骼坐标；顺便先跑一次重定向 */
  function groundAvatar(avatar) {
    avatar.retarget?.();
    avatar.root.updateMatrixWorld(true);
    return snapToGround(avatar.root, avatar.humanoid, {
      // 脚骨到鞋底的距离由 loader 量好；不补偿的话"骨骼贴地"= 鞋底埋进地面
      clearance: avatar.groundClearance ?? 0.03,
      getBoneWorldPosition: avatar.getBoneWorldPosition?.bind(avatar) ?? null,
      getLowestY: avatar.getLowestWorldY?.bind(avatar) ?? null,
    });
  }

  let currentPoseId = null;

  function applyPoseData(pose, { ground = true, poseId = null } = {}) {
    onBeforePose?.(); // 应用姿势前先停掉正在播放的动作，否则两边打架
    if (poseId) currentPoseId = poseId;
    const avatar = getAvatar();
    if (!avatar || !pose) return;
    if (pose.format && pose.format !== POSE_FORMAT) {
      console.warn('[pose] 未知格式', pose.format);
    }
    applying = true;
    const result = applyPose(avatar.humanoid, pose);
    if (ground) groundAvatar(avatar);
    applying = false;
    syncSliders();
    setPoseConfidence(pose.meta?.confidence ?? null);

    // 姿势里带了表情就一起还原
    onAfterPose?.(pose);

    const miss = result.missing.length ? `，跳过缺失骨骼 ${result.missing.length} 根` : '';
    setStatus(`已应用「${pose.name || '未命名'}」：${result.applied} 根骨骼${miss}`);
    return result;
  }

  /** 动作播放期间锁住姿势面板，避免"改了没反应"的困惑 */
  function setPoseLocked(locked) {
    document.body.classList.toggle('pose-locked', !!locked);
    const hint = $('pose-lock-hint');
    if (hint) {
      hint.hidden = !locked;
      hint.textContent = locked ? '动作播放中：姿势编辑已暂停，点「停止」后恢复' : '';
    }
  }

  // ---------- 置信度（图片生成的姿势用） ----------
  // 图片估计出来的关节有可信度差异：把低分的骨骼在列表里标出来，
  // 用户点一下就选中，直接用滑条微调 —— 比"看着别扭但不知道哪不对"强。
  const confBox = $('confidence');
  let poseConfidence = null;

  function paintBoneOptions() {
    for (const opt of boneSelect.querySelectorAll('option')) {
      if (!opt.dataset.label) opt.dataset.label = opt.textContent.replace(/\s*[⚠?]+$/, '');
      const score = poseConfidence?.[opt.value];
      const mark = typeof score === 'number' && score < 0.8 ? ' ⚠' : '';
      opt.textContent = opt.dataset.label + mark;
    }
  }

  function renderConfidenceList() {
    if (!confBox) return;
    confBox.textContent = '';
    if (!poseConfidence) return;
    const low = Object.entries(poseConfidence)
      .filter(([, v]) => typeof v === 'number' && v < 0.8)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 8);
    if (!low.length) {
      confBox.textContent = '各关节置信度都不错，可以直接用。';
      return;
    }
    const head = document.createElement('div');
    head.textContent = '这些关节估计得不太准，点一下选中再微调：';
    confBox.appendChild(head);
    for (const [name, score] of low) {
      const chip = document.createElement('button');
      chip.className = 'chip warn';
      chip.textContent = `${BONE_LABEL[name] || name} ${Math.round(score * 100)}%`;
      chip.addEventListener('click', () => {
        boneSelect.value = name;
        boneSelect.dispatchEvent(new Event('change'));
      });
      confBox.appendChild(chip);
    }
  }

  function setPoseConfidence(conf) {
    poseConfidence = conf && typeof conf === 'object' ? conf : null;
    paintBoneOptions();
    renderConfidenceList();
  }

  // ---------- 镜像 / 覆盖保存 / 撤销 ----------
  // 由 main.js 通过 bindPoseEditing 注入实现（需要 capturePose / poseStore）
  const editHandlers = { onMirror: null, onOverwrite: null, onRevert: null };
  function bindPoseEditing(handlers = {}) {
    Object.assign(editHandlers, handlers);
    $('btn-mirror')?.addEventListener('click', () => editHandlers.onMirror?.());
    $('btn-overwrite')?.addEventListener('click', () => editHandlers.onOverwrite?.(currentPoseId));
    $('btn-revert')?.addEventListener('click', () => editHandlers.onRevert?.(currentPoseId));
  }

  // ---------- 预设 ----------
  function loadSaved() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function persistSaved(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  async function renderPresets() {
    presetBox.textContent = '';
    for (const preset of BUILTIN) {
      const btn = document.createElement('button');
      btn.className = 'chip';
      btn.textContent = preset.label;
      btn.addEventListener('click', async () => {
        try {
          const res = await fetch(preset.file);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          applyPoseData(await res.json(), { poseId: `p-${preset.id}` });
        } catch (err) {
          setStatus(`预设读取失败：${err.message}`, 'error');
        }
      });
      presetBox.appendChild(btn);
    }

    for (const preset of loadSaved()) {
      const wrap = document.createElement('div');
      wrap.className = 'chip saved';

      const btn = document.createElement('button');
      btn.className = 'chip-main';
      btn.textContent = preset.name || '未命名';
      btn.addEventListener('click', () => applyPoseData(preset));
      wrap.appendChild(btn);

      const del = document.createElement('button');
      del.className = 'chip-del';
      del.textContent = '×';
      del.title = '删除该预设';
      del.addEventListener('click', () => {
        persistSaved(loadSaved().filter((p) => p.name !== preset.name));
        renderPresets();
      });
      wrap.appendChild(del);

      presetBox.appendChild(wrap);
    }
  }

  $('btn-save').addEventListener('click', () => {
    const pose = currentPose();
    if (!pose) return;
    const name = window.prompt('预设名称', `姿势 ${new Date().toLocaleTimeString()}`);
    if (!name) return;
    pose.name = name;
    persistSaved([...loadSaved().filter((p) => p.name !== name), pose]);
    renderPresets();
    setStatus(`已保存预设「${name}」`);
  });

  // ---------- 导入 / 导出 ----------
  $('btn-copy').addEventListener('click', async () => {
    const pose = currentPose();
    if (!pose) return;
    const text = JSON.stringify(pose, null, 2);
    jsonArea.value = text;
    try {
      await navigator.clipboard.writeText(text);
      setStatus('当前姿势 JSON 已复制');
    } catch {
      jsonArea.select();
      setStatus('已写入文本框（浏览器拒绝剪贴板，请手动复制）');
    }
  });

  $('btn-apply').addEventListener('click', () => {
    const raw = jsonArea.value.trim();
    if (!raw) return;
    try {
      applyPoseData(JSON.parse(raw));
    } catch (err) {
      setStatus(`JSON 解析失败：${err.message}`, 'error');
    }
  });

  // ---------- 其它按钮 ----------
  $('btn-bone-reset').addEventListener('click', () => {
    const avatar = getAvatar();
    if (!avatar) return;
    resetBone(avatar.humanoid, currentBone);
    syncSliders();
  });

  $('btn-all-reset').addEventListener('click', () => {
    const avatar = getAvatar();
    if (!avatar) return;
    resetAll(avatar.humanoid);
    setHipsOffset(avatar.humanoid, [0, 0, 0]);
    groundAvatar(avatar);
    syncSliders();
    setStatus('已全部归零');
  });

  $('btn-ground').addEventListener('click', () => {
    const avatar = getAvatar();
    if (!avatar) return;
    const d = groundAvatar(avatar);
    setStatus(`接地校正 ${d >= 0 ? '+' : ''}${d.toFixed(3)} m`);
  });

  $('btn-frame').addEventListener('click', () => onFrame());

  const fileInput = $('file');
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (file) await handleFile(file);
    fileInput.value = '';
  });

  // 选整个文件夹：PMX + 贴图一起载入
  const folderInput = $('folder');
  if (folderInput) {
    folderInput.addEventListener('change', async () => {
      const files = folderInput.files;
      if (files && files.length) await onLoadFiles(files);
      folderInput.value = '';
    });
  }

  // 从图片生成姿势（可多选，多张会做融合）
  const poseImageInput = $('pose-image');
  if (poseImageInput && onPoseImages) {
    poseImageInput.addEventListener('change', async () => {
      const files = [...(poseImageInput.files ?? [])];
      poseImageInput.value = '';
      if (!files.length) return;
      setStatus(files.length > 1 ? `正在从 ${files.length} 张图估计并融合…` : '正在从图片估计姿势…');
      try {
        const ok = await onPoseImages(files);
        if (!ok) setStatus('图里没找到人（可换背景更干净、人物更完整的图）', 'error');
      } catch (err) {
        console.error(err);
        setStatus(`图片生成姿势失败：${err.message}`, 'error');
      }
    });
  }

  async function handleFile(file) {
    return onLoadFile(file);
  }

  $('btn-mannequin').addEventListener('click', () => onUseMannequin());

  // ---------- 生命周期 ----------
  function onAvatarChange(next) {
    const avatar = next;
    const disabled = !avatar;
    for (const btn of document.querySelectorAll('.needs-avatar')) btn.disabled = disabled;
    if (!avatar) return;
    // 换模型后把骨骼下拉里缺失的项标灰
    for (const opt of boneSelect.querySelectorAll('option')) {
      const has = !!avatar.humanoid?.getNormalizedBoneNode?.(opt.value);
      opt.disabled = !has;
      opt.textContent = opt.textContent.replace(/（缺）$/, '') + (has ? '' : '（缺）');
    }
    paintBoneOptions();
    syncSliders();
  }

  renderPresets();

  return {
    setStatus,
    onAvatarChange,
    syncFromAvatar,
    syncSliders,
    applyPoseData,
    setPoseLocked,
    bindPoseEditing,
    get currentPoseId() {
      return currentPoseId;
    },
    setCurrentPoseId(id) {
      currentPoseId = id;
    },
    currentPose,
    handleFile,
  };
}





