# 素材与许可（重要）

本仓库**只包含代码与自制数据**，不包含任何第三方模型、贴图或参考图。
下面这些资源需要你自己放到指定位置，运行时才会生效。

## 1. 模型文件（`public/models/`）

| 文件/目录 | 用途 | 怎么获取 |
| --- | --- | --- |
| `public/models/weilina/` | 默认加载的「维琳娜」 | 从模之屋下载后解压到此目录 |
| `public/models/xun/` | 测试用的「浔」 | 同上 |
| `public/models/sample-vrm1.vrm` | 官方示例 VRM（默认模型的兜底） | 从 three-vrm 示例资源获取；没有也不影响，会退回程序化人偶 |

> 本机的 `public/models/weilina/`、`public/models/xun/` 已写进 `.gitignore`：
> 这两个模型的 `使用规则.txt` 明确**禁止二次配布**，不允许随代码分发。

## 2. 姿态估计（`public/models/mediapipe/`，约 34 MB）

浏览器内跑 MediaPipe Pose Landmarker 需要两个东西，都在 `.gitignore` 里：

```powershell
# 1) npm 包里的 WASM 运行时
Copy-Item node_modules\@mediapipe\tasks-vision\wasm\* public\models\mediapipe\wasm\ -Force

# 2) 官方模型（lite 5.8 MB / full 9.4 MB，二选一，lite 够用）
# https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
# https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task
```

MediaPipe 由 Google 发布，Apache-2.0 许可。

## 3. 参考图（`public/models/posedata/`、`public/models/batch/`）

来自 [ai-pose-gallery-zh](https://github.com/anhao/ai-pose-gallery-zh) 的姿势参考图，
版权归原作者（ギア / Anhao）。**仅用于本地测试**，已在 `.gitignore` 中排除，
请勿随代码分发。

## 4. 仓库里有的东西（可自由使用）

- 全部源代码（`src/`、`scripts/`）
- 姿势 JSON（`public/poses/`）——由本项目生成或手工制作
- 文档（`README.md`、`docs/`、`项目管理/` 若包含）
- 动作 VMD（`public/motions/`）——由 `scripts/make-idle-vmd.mjs` 生成

## 5. 许可证范围说明

仓库的 `LICENSE` 是 **MIT**，只覆盖上面第 4 节列出的内容（本项目自己写的代码与数据）。

**不覆盖、也不代表授权**任何第三方内容：

| 内容 | 版权/许可 |
| --- | --- |
| 各游戏角色的 PMX/VRM 模型与贴图 | 版权归原厂与模型作者；`使用规则.txt` 通常写"禁止二次配布"，因此**不在仓库里** |
| 模之屋（AplayBox）等站点的页面与资源 | 仅收录**页面链接**（`public/catalog/`），不托管文件 |
| MediaPipe 运行时 | Apache-2.0（Google），部署时从官方 CDN/包内获取 |
| three.js / @pixiv/three-vrm / mmd-parser | 各自许可证，见 `package.json` 依赖 |

使用本项目加载任何模型前，请自行确认该模型的授权条款。

