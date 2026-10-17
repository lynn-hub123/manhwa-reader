# mobile-readiness-20261011-01 原始命令输出

这些退出码只描述检查进程；可用性裁决见 REPORT.md。逻辑复现中的 QUARANTINE 表示发现缺陷，不是测试成功。

## 主检查 1
tool_chunk_id: f0fa82
outer_exit_code: 0
```json
{"run_id":"mobile-readiness-20261011-01/main-tests","command":"node --test tests/*.test.js","exit_code":0,"stdout":"bookshelf-viewport-contract: PASS\n✔ tests\\bookshelf-viewport-contract.test.js (132.3835ms)\ncapture-canonical-source: PASS\n✔ tests\\capture-canonical-source.test.js (174.7502ms)\ncapture-modal-cleanup: PASS\n✔ tests\\capture-modal-cleanup.test.js (197.1398ms)\ncapture-render-state: PASS\n✔ tests\\capture-render-state.test.js (199.764ms)\ncapture-start: PASS\n✔ tests\\capture-start.test.js (201.4587ms)\ncover-capture-adjustment: PASS\n✔ tests\\cover-capture-adjustment.test.js (218.8226ms)\ncover-capture-canonical: PASS\n✔ tests\\cover-capture-canonical.test.js (181.3373ms)\ncover-capture-geometry: PASS\n✔ tests\\cover-capture-geometry.test.js (190.6392ms)\ncover-capture-preview: PASS\n✔ tests\\cover-capture-preview.test.js (243.2878ms)\ncover-capture-recommendation: PASS\n✔ tests\\cover-capture-recommendation.test.js (242.0628ms)\ncover-recommendation-contract: PASS\n✔ tests\\cover-recommendation-contract.test.js (148.8308ms)\ncover-selection-contract: PASS\n✔ tests\\cover-selection-contract.test.js (150.2146ms)\ngroup-rail-mobile-contract: PASS\n✔ group rail measures intrinsic content and reschedules after layout changes (3.0968ms)\ngrouping-contract: PASS\n✔ tests\\grouping-contract.test.js (147.4575ms)\nlayout-spacing-contract: PASS\n✔ tests\\layout-spacing-contract.test.js (214.7466ms)\n✔ mobile shell exposes installable PWA metadata and offline entry points (3.1747ms)\n✔ mobile reader keeps controls reachable and wires touch interactions (4.2707ms)\n✔ Capacitor scaffold keeps the web app as the native shell source (0.8094ms)\n✔ swipeDirection identifies horizontal page gestures and ignores vertical scrolling (2.468ms)\n✔ clampPinchZoom snaps gesture zoom to supported reader steps (0.387ms)\nnormal-pdf-progress-flow: PASS\n✔ tests\\normal-pdf-progress-flow.test.js (251.868ms)\nrack-interaction: PASS\n✔ tests\\rack-interaction.test.js (178.5508ms)\nrack-shelf-contract: PASS\n✔ tests\\rack-shelf-contract.test.js (181.6835ms)\nrack-static-contract: PASS\n✔ tests\\rack-static-contract.test.js (183.7556ms)\n✔ isWebtoonPage identifies pages taller than the reader threshold (1.3573ms)\n✔ shouldUseWebtoon accepts an early tall page and ignores ordinary pages (0.355ms)\nreading-progress: PASS\n✔ tests\\reading-progress.test.js (161.472ms)\nshelf-ui-contract: PASS\n✔ tests\\shelf-ui-contract.test.js (151.983ms)\ntext-cover-default: PASS\n✔ tests\\text-cover-default.test.js (128.9909ms)\nzoom-anchor: PASS\n✔ tests\\zoom-anchor.test.js (132.7787ms)\nℹ tests 30\nℹ suites 0\nℹ pass 30\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 814.4783\n","stderr":""}
```

## 主检查 2
tool_chunk_id: 938221
outer_exit_code: 0
```json
{"run_id":"mobile-readiness-20261011-01/main-syntax","input":"app.js","expected":"syntax parses","exit_code":0,"stdout":"","stderr":""}
{"run_id":"mobile-readiness-20261011-01/main-syntax","input":"db.js","expected":"syntax parses","exit_code":0,"stdout":"","stderr":""}
{"run_id":"mobile-readiness-20261011-01/main-syntax","input":"mobile-reader.js","expected":"syntax parses","exit_code":0,"stdout":"","stderr":""}
{"run_id":"mobile-readiness-20261011-01/main-syntax","input":"pwa.js","expected":"syntax parses","exit_code":0,"stdout":"","stderr":""}
{"run_id":"mobile-readiness-20261011-01/main-syntax","input":"reader-mode.js","expected":"syntax parses","exit_code":0,"stdout":"","stderr":""}
{"run_id":"mobile-readiness-20261011-01/main-syntax","input":"service-worker.js","expected":"syntax parses","exit_code":0,"stdout":"","stderr":""}
{"run_id":"mobile-readiness-20261011-01/main-syntax","input":"reading-progress.js","expected":"syntax parses","exit_code":0,"stdout":"","stderr":""}
{"run_id":"mobile-readiness-20261011-01/main-syntax","input":"cover-capture.js","expected":"syntax parses","exit_code":0,"stdout":"","stderr":""}
{"run_id":"mobile-readiness-20261011-01/main-syntax","input":"rack-interaction.js","expected":"syntax parses","exit_code":0,"stdout":"","stderr":""}
{"run_id":"mobile-readiness-20261011-01/main-syntax","input":"server.js","expected":"syntax parses","exit_code":0,"stdout":"","stderr":""}
```

## 实际源码的隔离逻辑复现
tool_chunk_id: 06e0d3
outer_exit_code: 0
stderr: 无命令错误输出；VM 逻辑复现，不等同真实浏览器离线测试。
```json
{"run_id":"mobile-readiness-20261011-01/gestures","input":"actual app.js bindMobileReaderGestures executed with synthetic DOM events","cancel":{"expectedPagesTurned":0,"actualPagesTurned":1,"state":"QUARANTINE"},"pinchReturn":{"expectedZoomRequests":["2","1.5"],"actualZoomRequests":["2"],"state":"QUARANTINE"}}
{"run_id":"mobile-readiness-20261011-01/offline-worker","expected":"installed app can resolve PDF worker before any online PDF is opened","cachedMain":true,"cachedWorker":false,"actualResponse":"undefined","networkCalls":["https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js","https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"],"state":"QUARANTINE","scope":"isolated VM logic reproduction, not real-browser offline acceptance"}
```

## 只读验收子 Agent 回执
observer_agent_id: 01a129ea-fef9-70c3-bb32-565cd5e852a9

结论：指定自动检查为 SUCCESS；原生构建就绪为 HOLD；真实手机可用性为 UNKNOWN。不能据此签发完整移动验收通过，P0 总体结论为 BLOCKED（关键运行验证未执行）。

`run_id=mobile-readiness-20261011-01/automated`

输入版本与只读证据：

- 实际 cwd、解析路径、Git 顶层均为 `F:\manhwa-reader`。
- HEAD：`64abde9c8e088ebf4ede51551cbfa0b1db501721`。
- 输入为 HEAD 加当前脏工作区：4 个已跟踪修改、23 个未跟踪文件。
- 检查前后 HEAD、Git status 一致；42 个受检输入的 SHA-256 无变化，完整指纹已保留在工具回执。
- Node `v24.18.1`；Git `2.55.0.windows.3`。

| 检查 | 状态 | 退出码 | stdout / stderr 证据 |
|---|---|---:|---|
| 仓库身份及 HEAD/status | SUCCESS | 0 | 路径、HEAD、脏文件列表已分别回读；stderr 空 |
| `node --test tests/*.test.js` | SUCCESS | 0 | 26 个测试文件；报告 30 tests、30 pass、0 fail、0 skipped；stderr 空 |
| 下列 10 个 JS 逐个 `node --check` | SUCCESS | 每项 0 | 每项 stdout、stderr 均空；仅证明语法可解析 |
| `tests/capture-ui-contract.test.ps1` | SUCCESS | 0 | `capture-ui-contract: PASS`；stderr 空 |
| `git -c safe.directory=F:/manhwa-reader diff --check` | SUCCESS | 0 | stdout 空；stderr 有 4 条 LF→CRLF 警告 |
| 原生工程完整性 | HOLD | 不适用 | 缺依赖清单、锁文件、平台工程和安装包 |
| UI、网络、离线、真实手机 | SKIPPED | 未运行 | `skip_reason=用户指定分工，位于本次执行闭包之外`；可用性保持 UNKNOWN |

逐个语法检查文件：`app.js`、`db.js`、`mobile-reader.js`、`pwa.js`、`reader-mode.js`、`service-worker.js`、`reading-progress.js`、`cover-capture.js`、`rack-interaction.js`、`server.js`。

`diff --check` 警告涉及 `CURRENT-PROGRESS.md`、`app.js`、`db.js`、`index.html`。该检查不覆盖未跟踪文件，不能扩展为全部新增文件的空白检查通过。

测试覆盖缺口及位置：

- [mobile-app-contract.test.js:11](/F:/manhwa-reader/tests/mobile-app-contract.test.js:11)、[同文件:32](/F:/manhwa-reader/tests/mobile-app-contract.test.js:32)：读取源码/JSON 后做 regex 和字段断言，没有运行安装、触摸、布局或离线行为。
- [group-rail-mobile-contract.test.js:11](/F:/manhwa-reader/tests/group-rail-mobile-contract.test.js:11)：源码契约，没有实际测量滚动、字体加载或 MutationObserver 行为。
- [mobile-reader.test.js:5](/F:/manhwa-reader/tests/mobile-reader.test.js:5)、[reader-mode.test.js:5](/F:/manhwa-reader/tests/reader-mode.test.js:5)：确实加载模块并执行纯函数，但没有浏览器触摸事件、PDF 渲染及页面接线验证。
- [mobile-app-contract.test.js:56](/F:/manhwa-reader/tests/mobile-app-contract.test.js:56)：Capacitor 测试只验证配置和 README 文本，不能证明原生工程可构建。
- [capture-ui-contract.test.ps1:2](/F:/manhwa-reader/tests/capture-ui-contract.test.ps1:2)：也是源码/CSS regex 契约，不能证明实际视觉布局。

原生完整性：扫描当前检出的 62 个文件，排除 `.git`、其他 `.worktrees` 和依赖目录；未找到 package.json、任何受检锁文件、Android/iOS 工程、Gradle/Xcode 工程标记或 APK/IPA/AAB。根目录和 `capacitor/` 下的平台目录均不存在。[capacitor/README.md:14](/F:/manhwa-reader/capacitor/README.md:14) 也明确平台工程尚未生成；[配置:4](/F:/manhwa-reader/capacitor/capacitor.config.json:4) 的 `webDir` 不能替代构建工程。

HOLD 放行条件：由主 agent/构建负责人补齐原生工程并提供构建、安装证据；本次未设置放行期限，也未运行安装、生成或构建命令。未修改项目文件、用户数据、配置或远程状态；完整逐命令退出码、stdout、stderr 保留在本次工具回执中。


