from PIL import Image, ImageChops
import numpy as np
import sys, os

root = r"D:\DeepSeek Harness\vrm-poser\shots"
a = Image.open(os.path.join(root, "xun-sph-on.png")).convert("RGB")
b = Image.open(os.path.join(root, "xun-sph-off.png")).convert("RGB")

na = np.asarray(a, dtype=np.int16)
nb = np.asarray(b, dtype=np.int16)
diff = np.abs(na - nb)
print("mean abs diff:", round(float(diff.mean()), 3))
print("max diff:", int(diff.max()))
changed = (diff.sum(axis=2) > 12)
print("pixels changed >12:", int(changed.sum()), f"({changed.mean()*100:.2f}%)")
ys, xs = np.nonzero(changed)
if len(xs):
    print("bbox x:", int(xs.min()), int(xs.max()), " y:", int(ys.min()), int(ys.max()))

# 裁一块上身/头发区域对比（模型在画面中间偏上）
box = (620, 90, 1010, 560)
ca = a.crop(box)
cb = b.crop(box)
w, h = ca.size
canvas = Image.new("RGB", (w * 2 + 12, h), (30, 30, 34))
canvas.paste(cb, (0, 0))
canvas.paste(ca, (w + 12, 0))
out = os.path.join(root, "sph-compare.png")
canvas.save(out)
print("saved", out)
