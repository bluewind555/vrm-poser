/**
 * PNG 导出面板。
 *
 * 只负责收集参数（尺寸 / 是否透明底），真正的渲染在 main.js 里做——那里才有
 * renderer / camera / scene / outlineEffect。
 */
export function createExportUI({ onExport, setStatus }) {
  const overlay = document.getElementById('exportpng');
  const form = document.getElementById('exportpng-form');
  if (!overlay || !form) return { open() {}, close() {} };

  const sizeSel = form.querySelector('[name="size"]');
  const alphaChk = form.querySelector('[name="transparent"]');
  const bgSel = form.querySelector('[name="background"]');
  const statusEl = document.getElementById('exportpng-status');

  const syncBg = () => {
    if (bgSel) bgSel.disabled = alphaChk.checked;
  };
  alphaChk?.addEventListener('change', syncBg);

  function open() {
    syncBg();
    if (statusEl) statusEl.textContent = '';
    overlay.classList.add('open');
  }

  function close() {
    overlay.classList.remove('open');
  }

  async function submit(ev) {
    ev.preventDefault();
    const size = Number(sizeSel?.value ?? 0); // 0 = 当前画面
    const transparent = !!alphaChk?.checked;
    const bg = bgSel?.value || '#12141a';
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    if (statusEl) statusEl.textContent = '渲染中…';
    try {
      const result = await onExport({ longEdge: size, transparent, background: bg });
      if (result?.ok) {
        if (statusEl) statusEl.textContent = `已导出 ${result.width}×${result.height}`;
        setStatus?.(`已导出 PNG ${result.width}×${result.height}`);
        close();
      } else {
        if (statusEl) statusEl.textContent = `失败：${result?.error ?? '未知错误'}`;
        setStatus?.(`导出失败：${result?.error ?? ''}`, 'error');
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  form.addEventListener('submit', submit);
  document.getElementById('exportpng-cancel')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  return { open, close };
}
