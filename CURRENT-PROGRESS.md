# 韩漫阅读器 · 当前交接（2026-08-23）

## 项目启动与架构

- 主检出目录：`F:\manhwa-reader`，当前 `master` 已包含普通 PDF 页内进度提交 `3e81d3d`；本轮功能已合并到主分支。
- 固定 100% 截图功能此前已合并；本轮在隔离工作树完成普通分页进度保存/恢复后已清理工作树。
- 本地启动：`node server.js`，访问 `http://localhost:8765`；`启动阅读器.bat` 为快捷启动入口。
- 当前功能工作树验收服务使用 `http://localhost:8766/`；`8765` 与 `8766` 属于不同浏览器 origin，IndexedDB 数据互不共享。
- `index.html`：页面骨架与全部 CSS；`app.js`：导入、书架、阅读器、PDF.js canvas 渲染及交互；`db.js`：IndexedDB 封装；`server.js`：Node.js 静态服务器；`fonts/`：本地字体。
- 数据只保存在浏览器 IndexedDB（`bookshelf`、`pdf-cache`、`settings`、`covers`），不依赖后端数据库；PDF.js 3.11.174 仍按既有方式加载。

## 基线恢复与已验证状态

- 已恢复并核对 Phase 2J 基线：持久化、文件/文件夹导入、章节解析、PDF 阅读、普通页/条漫模式、懒加载、进度、缓存、封面候选、搜索排序、日夜主题、书架和快捷键等既有函数保持在 `app.js`/`db.js`/`server.js`。
- 本次功能只扩展“当前画面截图设封面”路径；既有上传封面、文字封面、候选页封面路径未改动其入口。

## 当前画面推荐截图（混合推荐 + 可调整）

1. 阅读器点击“设封面 → 当前画面截图”后，入口弹窗保留并显示“正在生成 100% 画面…”。准备期间共享 capture UI guard 会隔离 reader 快捷键；Escape、取消、背景点击或弹窗替换会使 pending 结果失效并完整清理。
2. 先从已完成 PDF render 的可见 canvas 中确定当前页和阅读焦点，再以 PDF.js `scale:1` 构造固定 100% 取景窗口。PDF.js 通过偏移 transform 直接渲染窗口大小的 canvas，不分配超长整页 100% 位图；阅读器当前的 60%/100%/150%/200%/适应宽度、滚动位置和设置均不改变。
3. 在 100% 窗口内生成最大可用的 `5:7` 候选框；本地像素评分只决定位置，不再把初始推荐缩成 50%/75% 的局部特写。透明像素按白底合成，纯黑/纯白主导与贴边候选受惩罚；输出保持整数 `5n×7n`。
4. 预览提供“使用推荐 / 调整一下 / 取消”。选择调整后进入独立的 100% 漫画画布，而不是覆盖当前缩放的阅读页面；小屏仅等比缩小显示，实际裁切仍取自 100% 源画布。
5. 独立调整画布提供固定 `5:7` 选框、拖动、四个 44×44 内置角柄、恢复推荐位置、保存和取消；窗口 resize/设备旋转会关闭旧坐标画布并提示重新调整，避免选框移出屏幕。
6. 预览与调整具备 modal/焦点/快捷键隔离与幂等清理；直接保存或调整保存失败时保留对应 UI 并允许重试，只有保存结果严格为 `true` 才关闭。当前仍只给一个推荐，不提供多推荐列表或外部 AI/人物识别。

## 新增模块与测试职责

- `cover-capture.js`：无 DOM 的几何工具（含 `computeCanonicalWindow`、`mapRectBetweenBounds`），负责固定 100% 焦点映射、`5:7` 候选和边界约束。
- `app.js`：当前页/焦点选择、PDF.js 窗口化 100% 渲染、内容评分、独立调整画布、Pointer Events、准备/预览/保存清理与错误重试。
- `tests/cover-capture-geometry.test.js`：比例、候选、边界和 tie 行为。
- `tests/cover-capture-recommendation.test.js`：当前可见源、评分、fallback、源像素映射和推荐对象。
- `tests/cover-capture-preview.test.js`：加载/无预览错误、预览三操作、遮罩/Escape、监听清理和重开不重复。
- `tests/cover-capture-adjustment.test.js`：`5:7` 拖动/缩放、四角柄存在、Pointer Events、快捷键拦截、恢复/取消和保存重试。
- `tests/capture-start.test.js`、`tests/capture-ui-contract.test.ps1`：入口调度和预览 CSS/布局契约。
- `tests/capture-render-state.test.js`：PDF render promise 开始/成功/失败/rerender 的推荐资格状态。
- `tests/capture-modal-cleanup.test.js`：重复从 set-cover 进入截图时通用 modal/backdrop 的幂等清理。
- `tests/capture-canonical-source.test.js`：PDF.js `scale:1` 偏移窗口渲染，证明不分配超长整页中间 canvas。
- `tests/cover-capture-canonical.test.js`：60%/100%/150%/200%/适应宽度的焦点一致性、边界夹取与独立画布坐标映射。

## 普通分页 PDF 页内进度（已实现）

1. 普通分页除 `lastPage` 外，还保存 `lastPageProgress`（0～1），表示阅读锚点落在当前页内的比例；滚动同一页时也会更新。
2. 重新打开时先按保存页码建立页面布局，再按页内比例恢复到同一段漫画内容；缩放比例和窗口大小变化不会把位置固定在原始像素。
3. 旧记录没有 `lastPageProgress` 时回退到原来的该页页首行为；条漫仍使用原有整体滚动百分比恢复。
4. 章节切换和异步加载带 token 保护，旧章节恢复不会覆盖新章节进度。

对应模块和测试：`reading-progress.js`、`tests/reading-progress.test.js`、`tests/normal-pdf-progress-flow.test.js`。

## 缩放阅读锚点（已实现）

1. 普通 PDF 在缩放、适应宽度和窗口变化前，按当前阅读窗口 30% 锚点即时确定页面与页内比例，不依赖滚动事件的防抖状态。
2. 重渲染完成后恢复同一页面内的内容位置；条漫继续恢复整体滚动百分比。
3. 快速连续缩放使用恢复代次保护，旧的异步渲染不能覆盖最后一次缩放结果。

对应测试：`tests/zoom-anchor.test.js`。

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
node tests/capture-canonical-source.test.js       PASS
node tests/cover-capture-canonical.test.js        PASS
node tests/normal-pdf-progress-flow.test.js       PASS
node tests/reading-progress.test.js               PASS
node tests/zoom-anchor.test.js                    PASS
powershell -NoProfile -ExecutionPolicy Bypass -File tests/capture-ui-contract.test.ps1  PASS
node --check app.js                             PASS
node --check reading-progress.js                 PASS
node --check cover-capture.js                   PASS
node --check db.js                              PASS
node --check server.js                          PASS
git diff --check                                PASS
```

## 功能提交

- 功能：`c43fa80`、`87d0e02`、`41c3778`、`a540dd9`。
- 早期回归/修复：`471d685`、`c91c4c2`、`c7dc100`。
- 最终 review 修复代码：`25a8b3f`（渲染资格、保存重试、键盘/焦点隔离、四角 resize、评分、44px 目标及 modal/crop Minor）。
- 固定 100% 取景：`8bbd130`；审查修复：`cad5ebc`（窗口化 PDF.js 渲染、准备期快捷键隔离、resize/旋转安全退出及缩放矩阵测试）。
- 用户已确认固定 100% 取景的核心视觉流程通过；最终合并仍 pending，等待用户选择整合方式。

## 限制与未决项

- 目前只提供一个推荐；没有人物/人脸识别，也没有外部服务或 AI 模型。
- 固定 100% 取景、独立调整画布与跨缩放对比的核心观感已由用户确认通过；移动触摸手感、日/夜视觉层叠和完整刷新持久化清单未单独确认。
- 高瘦普通分页页面的页内阅读进度保存/恢复已实现；仍需用户在真实 PDF 上做一次刷新/重进人工验收。
- `CURRENT-PROGRESS.md` 是当前简要交接；`CURRENTPROGRESS.md` 是旧的 Phase 1→2J 完整参考，不能当作当前状态。

## 下一步

启动 `node server.js` 后，用一个有较高页面的普通分页 PDF：在第 2 页中段滚动、返回书架或刷新，再重新打开，确认回到同一段内容；再切换缩放比例重复一次，并确认条漫百分比恢复没有变化。
