# 韩漫阅读器 · 当前交接（2026-08-23）

## 项目启动与架构

- 主检出目录：`F:\manhwa-reader`，当前为 `master@ba00baf`；本轮未在主检出目录修改文件。
- 功能工作树：`F:\manhwa-reader\.worktrees\recommended-cover-capture`，分支 `feature/recommended-cover-capture`；最终修复代码提交为 `25a8b3f`。
- 本地启动：`node server.js`，访问 `http://localhost:8765`；`启动阅读器.bat` 为快捷启动入口。
- `index.html`：页面骨架与全部 CSS；`app.js`：导入、书架、阅读器、PDF.js canvas 渲染及交互；`db.js`：IndexedDB 封装；`server.js`：Node.js 静态服务器；`fonts/`：本地字体。
- 数据只保存在浏览器 IndexedDB（`bookshelf`、`pdf-cache`、`settings`、`covers`），不依赖后端数据库；PDF.js 3.11.174 仍按既有方式加载。

## 基线恢复与已验证状态

- 已恢复并核对 Phase 2J 基线：持久化、文件/文件夹导入、章节解析、PDF 阅读、普通页/条漫模式、懒加载、进度、缓存、封面候选、搜索排序、日夜主题、书架和快捷键等既有函数保持在 `app.js`/`db.js`/`server.js`。
- 本次功能只扩展“当前画面截图设封面”路径；既有上传封面、文字封面、候选页封面路径未改动其入口。

## 当前画面推荐截图（混合推荐 + 可调整）

1. 阅读器点击“设封面 → 从当前阅读页面截图”后，先关闭入口弹窗并在下一帧显示“正在分析当前画面…”。
2. 只在 `#viewer-area` 与浏览器视口相交、且 `page.render(...).promise` 已成功完成的 PDF canvas 中选取可见面积最大的一个；rendering、失败、取消、rerender 与 teardown 状态均不可参与推荐。不扫描整章、不请求外部服务、不做人脸/人物识别。
3. 在可见区域内生成 `5:7` 候选框，以本地像素内容评分后推荐一个构图；透明像素按白底合成，纯黑/纯白主导与贴近边缘的候选受连续惩罚。评分或预览失败时退回居中的 `5:7` 框。预览与保存均按源 PDF canvas 分辨率做坐标映射和裁切，输出为整数 `5n×7n`。
4. 预览提供“使用推荐 / 调整一下 / 取消”。预览和调整均具备 modal 语义、首操作焦点、Tab/Shift+Tab 焦点环绕、reader 快捷键隔离与退出后的焦点恢复；调整仍显式拦截 Escape、方向键及 `W/A/S/D/F/B`，滚轮监听使用 capture/non-passive 配对清理。
5. “调整一下”显示固定 `5:7` 选框，可拖动、用四个 44×44 内置角柄按水平或垂直 pointer 投影缩放、恢复推荐位置、保存或取消；合法 `60×84` 窄推荐不会被强制扩到 80px。
6. 本波次后，“使用推荐”的直接保存与调整后的保存发生裁切/存储失败时都会保留各自 UI，提示“封面保存失败，请重试”并允许重试；只有保存结果严格为 `true` 才关闭。当前产品策略只给出一个推荐，不提供多推荐列表。

## 新增模块与测试职责

- `cover-capture.js`：无 DOM 的几何工具（`fitRect`、`buildCandidates`、`chooseCandidate`、`clampRect`），负责 `5:7` 候选和边界约束。
- `app.js`：可见 canvas 选择、内容评分、源坐标裁切、推荐预览、Pointer Events 调整、清理/错误重试及既有保存入口整合。
- `tests/cover-capture-geometry.test.js`：比例、候选、边界和 tie 行为。
- `tests/cover-capture-recommendation.test.js`：当前可见源、评分、fallback、源像素映射和推荐对象。
- `tests/cover-capture-preview.test.js`：加载/无预览错误、预览三操作、遮罩/Escape、监听清理和重开不重复。
- `tests/cover-capture-adjustment.test.js`：`5:7` 拖动/缩放、四角柄存在、Pointer Events、快捷键拦截、恢复/取消和保存重试。
- `tests/capture-start.test.js`、`tests/capture-ui-contract.test.ps1`：入口调度和预览 CSS/布局契约。
- `tests/capture-render-state.test.js`：PDF render promise 开始/成功/失败/rerender 的推荐资格状态。
- `tests/capture-modal-cleanup.test.js`：重复从 set-cover 进入截图时通用 modal/backdrop 的幂等清理。

## 本任务自动化证据（2026-08-23）

以下命令均在 feature worktree 执行并返回成功：

```text
node tests/cover-capture-adjustment.test.js       PASS
node tests/cover-capture-preview.test.js          PASS
node tests/cover-capture-recommendation.test.js   PASS
node tests/capture-render-state.test.js            PASS
node tests/capture-modal-cleanup.test.js            PASS
node tests/cover-capture-geometry.test.js         PASS
node tests/capture-start.test.js                  PASS
powershell -NoProfile -ExecutionPolicy Bypass -File tests/capture-ui-contract.test.ps1  PASS
node --check app.js                             PASS
node --check cover-capture.js                   PASS
node --check db.js                              PASS
node --check server.js                          PASS
git diff --check                                PASS
```

## 功能提交

- 功能：`c43fa80`、`87d0e02`、`41c3778`、`a540dd9`。
- 早期回归/修复：`471d685`、`c91c4c2`、`c7dc100`。
- 最终 review 修复代码：`25a8b3f`（渲染资格、保存重试、键盘/焦点隔离、四角 resize、评分、44px 目标及 modal/crop Minor）。
- 最终合并仍 pending，不能把浏览器视觉或触摸验收当作已完成。

## 限制与未决项

- 目前只提供一个推荐；没有人物/人脸识别，也没有外部服务或 AI 模型。
- 实际渲染图像观感、触摸设备手感、日/夜视觉层叠和真实浏览器刷新后的持久化仍待人工验收。
- 高瘦普通分页页面的页内阅读进度恢复仍未修复（条漫滚动百分比恢复与本功能无关）。
- `CURRENT-PROGRESS.md` 是当前简要交接；`CURRENTPROGRESS.md` 是旧的 Phase 1→2J 完整参考，不能当作当前状态。

## 下一步

在 `feature/recommended-cover-capture` 分支按 `docs/ACCEPTANCE-CHECKLIST.md` 执行普通页与长条页的真实浏览器验收（含窄窗口、触摸、日/夜主题和刷新持久化），然后进行最终 review/integration。合并后再处理高瘦普通分页的页内阅读进度恢复。
