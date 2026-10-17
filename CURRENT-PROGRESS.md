# 韩漫阅读器 · 当前交接（2026-08-24）

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
4. 当前页判断和滚动保存会忽略尚未渲染的零高度页面，避免适应宽度后跳到错误的页边界。
5. 程序化恢复阅读锚点时临时关闭平滑滚动，避免布局重排后先跳一次、再慢慢滑到目标位置；用户正常翻页的平滑滚动保持不变。
6. 锚点之前的 PDF 页面按最多 3 页一批并行重绘，批次完成后才继续下一批并最终恢复位置，减少 100% 以上和适应宽度切换的等待。

对应测试：`tests/zoom-anchor.test.js`。

## 缩放定位与性能反馈修复（2026-08-24）

- 根因：`#viewer-area` 的 `scroll-behavior: smooth` 作用于缩放后的 `scrollTop` 锚点恢复，导致用户看到中间位置和后续平滑校正两个阶段。
- 修复：`app.js` 新增 `withInstantScroll`，只包裹普通分页 PDF 的自动 `scrollTop`/`scrollIntoView` 恢复，并在操作后还原原滚动设置。
- 回归覆盖：`tests/zoom-anchor.test.js` 验证自动恢复使用 `auto` 且恢复后保留原设置；`tests/normal-pdf-progress-flow.test.js` 同步加载该辅助函数。
- 后续卡顿根因：`restoreNormalPageProgress` 原先逐页等待完整 PDF 像素渲染，高缩放比例下每次布局重排都会暴露中间画面。
- 修复：新增 `renderPagesForRestore`，按最多 3 页并行、批次间等待的方式准备锚点前页面，保留 token 取消保护与原有最终定位。
- 新增回归：`tests/zoom-anchor.test.js` 验证批内并行、批间等待和全部完成后的成功结果。
- 自动验收：12 个 `tests/*.test.js` 全部通过，`node --check app.js`、`node --check db.js`、`git diff --check` 通过，`http://localhost:8765/` 返回 200。

## 连续缩放白屏稳定性（2026-08-26）

- 根因：缩放下拉框连续变更时，旧的高分辨率 PDF 渲染尚未完成就被新的 `reRenderAll` 事务再次取消；同时后台可见页渲染的拒绝没有统一收口，容易在快速切换时形成异步竞态。
- 修复：新增 `requestZoomChange`，缩放请求按“当前一次 + 最后一次”串行执行；只有当前事务完成后才应用下一个目标，避免多个缩放事务同时改写 canvas 和阅读状态。
- 修复：`reRenderAll` 现在返回完整的恢复 Promise；`renderVisiblePages` 等待并处理后台页面渲染结果，取消异常不再泄漏为未处理拒绝。
- 本轮只针对连续切换后的白屏稳定性；每次稳定切换仍可能出现的短暂闪烁/加载感，作为下一轮的独立过渡优化处理。
- 回归覆盖：`tests/zoom-anchor.test.js` 新增快速缩放请求合并测试。

## 性能优化待办（2026-08-30）

- 高倍率普通分页 PDF（尤其 100% 以上和“适应宽度”）的缩放加载时间会随 canvas 像素量增加而变长；目前内容、定位和稳定性均正确，暂不作为功能阻塞项。
- 后续可评估“先显示当前锚点页、再后台补渲染附近页面”、空闲预渲染或按设备能力限制渲染尺寸；优化前需重新验证进度恢复、截图取景和连续缩放白屏稳定性。

## 书架主代码迁移（2026-09-07）

- 已将已确认的书架预览迁入主页面：书架卡片使用窄幅漫画书脊、卷号圆标、腰封和 MANGA 标记，书脊保持紧密整齐排列并保留物理间隔。
- 每本书现在由同一套刚体结构渲染书页、前后封面和书脊，悬停时沿“抽出 → 抬离支点 → 向屏幕倾倒 → 侧转封面”的姿态连续运动，封面图仍来自现有封面数据。
- 悬停由 `rack-interaction.js` 的指针坐标命中计算驱动；`app.js` 在书架捕获阶段统一监听 `pointermove`，刚体展示层不再抢占鼠标命中，快速移向相邻书时会跟随当前指针切换。
- 悬停状态带 40ms 防抖、离架清理和回收期间的层级保持；现有导入、阅读器、进度、封面、缓存和服务端入口未改动。
- 新增 `tests/rack-interaction.test.js` 与 `tests/rack-shelf-contract.test.js`，并完成多书/单书本地页面烟测；完整回归和语法检查通过。

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

启动 `node server.js` 后，用一个有较高页面的普通分页 PDF：先连续快速切换 `100% → 125% → 150% → 适应宽度`，确认浏览器不再整页白屏；再在每次等待稳定后重复切换，记录仍存在的闪烁/加载感，作为下一轮过渡优化输入。最后在第 2 页中段滚动、返回书架或刷新，确认回到同一段内容；并确认条漫百分比恢复没有变化。

## 移动端前两步修复（2026-10-11，私有测试阶段）

- run_id：`mobile-mvp-20261011-01`。用户批准先完成移动交互、PWA 离线两步；本轮仅私有 HTTPS 测试，公开发布与原生打包不在授权范围内。
- 已修改：适应宽度不再受前一次倍率影响；触摸取消不翻页；放大页横向拖动用于平移；双指缩放可回到起始倍率；320px 导入按钮换行且高度至少 44px。
- 已实现：本地 PDF 主库和 worker、完整原子预缓存、独立离线就绪回执、仅清理本阅读器旧缓存、缓存缺失明确失败、PNG 安装图标；PDF 读取统一强制 `isEvalSupported:false`。
- 当前结论 `CONDITIONAL`：两步本地实现及私有部署已有证据；托管页面的实际交互与手机真机验收仍未完成。资源版本 `mobile-v4-20261011-07`。
- 最近完整自动回归：`node --test`，68 项通过、0 失败、0 跳过（最终 exit 0，chunk a80b55）；8 个 JS 文件语法及 diff 检查通过（908079）。行为测试与源契约测试并存，不等于手机真机通过。
- 桌面 IAB 手机视口实际验证：合成 PDF 导入→命名→阅读；200% 横向平移可到右边界；恢复适应宽度后清零横向偏移；页码与更多/目录控件可用；关闭 8768 测试服务和页面后冷打开，真正的第2页画面恢复，3 个画布均为 323×452。320px 导入按钮均在视口内且高 >=44px。
- 曾出现“页码2/3但前两画布1×1”的假象；视觉复核未放行，修复了隐藏阅读器的可测量宽度等待。保留修复前截图，当前通过截图为 `reader-390-offline-resume.png`。
- 只读复核已恢复；fit pinch、缓存故障降级、等待后取消竞态均经过 RED→GREEN。最后定向 fit/capture 10/10 通过，本次限定范围无剩余 Important；不代表独立设备验收。
- 私有链接： https://manhwa-reader-private-test-20261011.yuelin-x528.chatgpt.site 。Sites 版本1，deployment `succeeded`；访问策略回读仅 owner、0 外部访客、0 群组，未公开。
- 部署身份只保存在 `F:\sites\manhwa-reader-private-test\.openai\hosting.json`：`appgprj_6acb8d1caa48819191186b7f7e6697c8`。只对该隔离目录 commit/push，部署 source SHA `df19f0e3ad937b15958e34ca415c9adca1ed30ad`。原仓库 HEAD 未变。
- 实际上传为24项白名单静态资产+托管配置（25文件），不含 PDF、书架、封面、测试、日志或凭据。云端 source SHA 回读一致；云端存档摘要与本地 tar 摘要不同且没有云端存档字节可比，不能声称存档逐字节一致或托管页面已验收。
- 托管浏览器验收 `HOLD`：浏览器工具打开线上链接超时，恢复初始化失败；一次原生 reset 后仍失败，已停止重试。未诊断为站点故障，未绕过登录或改为公开。手机安装、双指手感、飞行模式复开 `SKIPPED`（无已连接真机）。下一步请按 `PHONE-TEST.md` 人工验收，再决定后续修复；公开前还须升级受支持的已修补 PDF 渲染库并回归。
- 保留原启动方式，未修改 `server.js`。未提交或推送原仓库，未公开发布。用于 QA 的 `http://localhost:8767` 与原书架 8765 隔离。
- 原文件备份：`C:\Users\夏\AppData\Local\Temp\manhwa-mobile-20261011-44f49056564e4624a148bd4e1790276a`。恢复只能逐文件比较该备份，不能用 Git reset 覆盖此前未提交改动。
- 详情与后续结果见 `docs/audits/2026-10-11-mobile-mvp/REPORT.md`。继续时先检查真实页面和部署身份；不要重复创建 Sites。
- 本轮自建 8767/8768 测试服务均已停止；8765/PID7768 保留。没有执行额度重置。
