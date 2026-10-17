# 移动端前两步实施与验收

run_id: `mobile-mvp-20261011-01`

日期：2026-10-11（Asia/Shanghai）。当前结论：`CONDITIONAL`：前两步本地实现及私有发布已验证；托管交互与真机安装/手势/飞行模式验收未完成。以下早期检查点保留原结论，最新状态见“最终本地与发布证据”。

## 范围与授权

用户批准先做移动交互修复及 PWA 离线两步。最新决定：本轮私有测试，之后再公开。只可上传静态阅读器代码、必要渲染库、字体、图标及其许可证；不得上传 PDF、封面、书架、进度、备份、测试数据、日志、凭据或原仓库历史。原生 Android/iOS 不在本轮范围内。

输入：`F:\manhwa-reader`，HEAD `64abde9c8e088ebf4ede51551cbfa0b1db501721`，master。原先已有 4 个 tracked dirty 文件及多项 untracked，全部保留；`db.js` 的此前改动不属于本轮。

回滚锚点：`C:\Users\夏\AppData\Local\Temp\manhwa-mobile-20261011-44f49056564e4624a148bd4e1790276a` 的逐文件原始副本。不得 reset/checkout/clean 原仓库。

## 早期检查点（不是当前结论）

| case_id | 预期 / 实际 | 状态 | 命令 / 输出证据 |
|---|---|---|---|
| A-RED | 复现手势、fit、worker 缺失 / 19 项中 17 失败 | SUCCESS（RED 证据） | `node --test tests/pwa-offline-flow.test.js tests/mobile-gesture-flow.test.js tests/mobile-fit-width.test.js`，exit 1，chunk 12a65a |
| A-GREEN | 修复手势与 fit / 11 项通过 | SUCCESS | focused tests，exit 0，chunk e40f01 |
| B-RED | 缺少保护边界与真实离线回执 / 5 项失败 | SUCCESS（RED 证据） | PDF engine + PWA status，exit 1，chunk b70d0e |
| B-GREEN | worker、缺资源失败、readiness、PNG、no-eval / 13 项通过 | SUCCESS | focused tests，exit 0，chunk a44a03 |
| REGRESSION-01 | 无既有回归 / 54 项通过，0 失败、0 跳过 | SUCCESS（本地测试范围） | `node --test`，exit 0，chunk aa1095 |
| NARROW-01 | 320px 控件不裁切 / 所有导入按钮 right <= 288，高 >= 44 | SUCCESS（桌面浏览器视口） | CUA 实际 DOM 几何；修复前 right=364.07 被裁切 |
| OFFLINE-STATUS-01 | 缓存完成才就绪 / 关闭旧页面后显示“离线资源已就绪” | SUCCESS（桌面浏览器） | 8767 新页面可见 DOM 文案；不能替代关闭服务测试 |
| IMPORT-01 | 导入→阅读 / 仅完成合成 PDF 选择，停在确认弹窗 | HOLD | 下一步点击确定、命名、阅读，不计整条流程成功 |
| REVIEW-01 | 独立只读验收 / 子 agent 额度中断，无结果 | HOLD | agent `01a12a15-7427-7112-a59d-c9a1af25ec34`；同源只读复核非独立设备/故障域 |
| HOST-01 | 私有静态 HTTPS / 未创建 Site 或上传 | HOLD | 恢复条件：本地真实流程通过、白名单包核对后创建一次 |
| DEVICE-01 | 手机安装、双指、飞行模式复开 / 未运行 | SKIPPED | skip_reason: 无已连接实机；rule: 不将桌面视口当真机；由用户拿私有链接验收 |

stderr：失败 RED 的预期断言/缺文件及模拟注册失败明确保留，未吞掉安装失败。54 项 GREEN 无非预期 stderr。

## 依赖与安全

PDF.js 3.11.174 tarball 从官方 npm registry 下载并验证 SHA-512 integrity 后，只复制原封不动主库、worker 与 LICENSE。第一次使用手写十六进制预期值校验失败，未解包；改为从 registry base64 integrity 直接解码比较后通过（无二次下载）。出处见 `vendor/pdfjs/README.md`。

该版本保留 API 兼容，统一按 Mozilla GHSA-wgrm-67xf-hhpq 的官方 workaround 禁用 eval。不是“所有漏洞均已修复”；公开发布前需升级到受支持的已修补渲染库并回归。本应用不上传用户 PDF，不提供云同步；缓存可能被浏览器回收，清除网站数据会删除本地书架。新网址的书架不自动继承 localhost 数据。

官方安全依据：[Mozilla PDF.js advisory](https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq)。本轮用no-eval兼容保护边界，不能作为永久维持旧库的公开发布依据。

## 早期恢复顺序（下方已记录实际推进）

1. 检查 8767 测试服务与现有浏览器 tab，完成真实导入/阅读/倍率/续读与停服务离线冷启动。
2. 只读复核尚未出结果，恢复或重新安排一次受限验收，不计中断为通过。
3. 白名单构建隔离静态部署目录；先查 `.openai/hosting.json`，只创建一次 private Site，立即持久化 opaque ID。凭据仅 stdin，不落盘/日志。
4. 仅隔离部署目录可按 Sites helper 流程 commit/push 静态源码；原仓库保持无 commit/push。
5. 私有部署回读成功后记录 URL/version/deployment；手机验收标记仍未运行，由用户操作。不得擅自转为公开。

## 最终本地与发布证据

输入版本：`mobile-v4-20261011-07`。运行者为主 Agent；只读复核者为上述 V1 子 agent。子 agent 不写文件、不用凭据、不运行打包或浏览器；工具没有独立 OS HOME 隔离能力，不能将同源复核当成独立设备/独立故障域证据。

| case_id | 预期 / 实际 | 状态 | 回执 / 范围 |
|---|---|---|---|
| REGRESSION-07 | 实际代码与旧契约均不回归 / 68/68，0 fail，0 skipped | SUCCESS（本地范围） | `node --test`，exit 0，chunk 046e5a，1753ms；无非预期 stderr |
| SYNTAX-07 | 8 JS 与 diff 无错误 / 通过 | SUCCESS | chunk 323035，exit 0；Git 仅有既存 LF/CRLF 提示，无 whitespace error |
| REVIEW-02 | fit pinch 保持起始模式、缓存故障仍可联网 / 指出2个 Important 后复现修复，复核无该缺口 | SUCCESS（限定代码范围） | RED 6d6e19；SW 13 GREEN 6eeba3；子 agent 26/26 focused、5/5 syntax |
| FIT-PAN-01 | 从横向平移200%恢复fit应可见 / scrollLeft 0、323×452、画面正常 | SUCCESS（桌面视口） | RED 39128f、GREEN 0fb489；RED shell后续命令退出0不算测试通过 |
| FIT-HIDDEN-01 | reader尚隐藏时不得完成1×1渲染 / 等待有效宽度后323×452 | SUCCESS（本地+桌面视口） | proper RED caab70，GREEN 485bc6；初次92bdd4因测试未等实际异步完成是假GREEN，已纠正 |
| FIT-CANCEL-01 | 测量之后 await 续段之前失效，不得启动旧render / render调用0，尺寸未写、idle | SUCCESS（真实函数VM边界） | RED e90c1a：1!=0，exit1；GREEN full 046e5a；只读fit/capture10/10、语法exit0、stderr空 |
| IMPORT-02 | 完成实际导入到阅读 / 数字命名合成PDF已进入“手机阅读验收”第1话 | SUCCESS（桌面IAB） | CUA chooser上传备份目录合成001-mobile-smoke.pdf；确认、命名由主Agent输入，机械操作优先Jev |
| READER-02 | 可读、可平移、可操作 / 200%宽1200px，水平滚动到848.67可见右边；fit回零；第2页/目录可打开 | SUCCESS（桌面390视口） | 实际DOM几何+截图；不能当原生手指触摸证据 |
| OFFLINE-COLD-07 | 关闭服务+旧页面，冷打开后worker与PDF可用且续读正确 / 第2页正文真正显示，3画布323×452 | SUCCESS（桌面IAB390×844） | 自建8768 session82432停止，exit1为主动Ctrl-C；chunk324ba7只余8765/PID7768。重新创建tab11，Jev点击后主Agent等render complete并截图 |
| HOST-PRIVATE-01 | 部署已保存精确源状态且仅owner / version1 succeeded；source SHA一致；owner-only | SUCCESS（托管控制面） | create一次，identity落盘chunk3362b6；private deploy pending→succeeded；见 PRIVATE-DEPLOYMENT.json |
| HOST-UI-01 | 线上登录/加载/离线就绪实际可用 / 打开线上时浏览器工具超时，后续初始化失效 | HOLD | 一次原生js_reset仍无法初始化，停止重试；未获得线上UI证据，不把控制面成功等同交互通过 |
| HOST-ARCHIVE-01 | 后端存档字节与本地可独立比较 / 尚未取到后端存档字节，摘要不同 | UNKNOWN | 来源get_site_version；本轮记录年龄0，不能推断格式相同；最大保留期到下一次发布决策，届时仍不明则人工处理，不据此放行公开 |
| DEVICE-02 | 实机安装、双指、飞行模式重开 / 无实机连接，未运行 | SKIPPED | skip_reason: 无已连接真机；rule: physical-device-not-desktop-viewport；按PHONE-TEST.md由用户验收 |
| WEBTOON-UI-01 | 条漫真实浏览器完整路径 / 只创建高600×1800合成fixture，未跑此浏览器路径 | SKIPPED | rule: disclose-unexecuted-path；分类与进度既有自动用例通过不替代该路径 |

正常通过截图：`reader-390-offline-resume.png`，SHA256 `A9EB714C8E57AEB16CB959CB5EC47DD3EF761327A39326443E9F1E61F3E239E8`。320px书架截图：`shelf-320-fixed.png`，SHA256 `220325E3A44A81055B14347E467005484EAA366959EBBB08A36980755355883F`。

历史反例保留为 `reader-390-offline-before-layout-fix.png`：页码2/3但可见PAGE3、前两画布1×1；它明确为未通过，不用来声称续读成功。

Jev只负责合成/非敏感本地页面机械动作，经配置原样调用 `typesafe/jev-1.13-20260917`。最终冷打开一决策一点击，5401ms API、6071ms循环；因1步预算返回step_limit，主Agent用新的DOM+视觉判断验收，不把返回状态当通过。截图、上传、输入、下拉倍率、水平滚轮与判断由CUA处理；私有认证页面未发送给Jev。早期AX名称含ID造成model_blocked，按已观察全名alias处理，没有更换模型或降低门槛。

## 私有托管身份、版本与产物

- URL：https://manhwa-reader-private-test-20261011.yuelin-x528.chatgpt.site
- project_id：`appgprj_6acb8d1caa48819191186b7f7e6697c8`，仅创建1次。身份清单：`F:\sites\manhwa-reader-private-test\.openai\hosting.json`，原仓库不另建部署身份。
- 版本：1；version_id：`appgprj_6acb8d1caa48819191186b7f7e6697c8~appgver_d7b9a77700e881918ea8d1ba8fcc796d`。
- deployment_id：`appgdep_6acb8dfd6518819191d84a90d58f16ac`，状态succeeded，updated_at `2026-10-11T13:24:27.199646+00:00`。私有操作没有改变共享策略；get_site回读custom/revision1，只owner、0访客、0群组。
- 仅隔离部署目录Git源提交并推送：`df19f0e3ad937b15958e34ca415c9adca1ed30ad`。Sites workflow经stdin隐式凭据推送并回查；恢复open回执chunk6c4d16；get_site_version回读该SHA一致。原HEAD仍 `64abde9c8e088ebf4ede51551cbfa0b1db501721`，原仓库无本轮commit/push。
- 静态包真实24文件/7,529,808 bytes，逐项SHA见STATIC-ARTIFACT.json，chunk225d9f。隔离Git共26文件（24资产+.gitattributes+hosting）；运行包25文件（24资产+hosting）。实际解包并逐项比较24资产摘要，计数25，chunkae3f50；不含用户PDF、封面、书架、fixture、审计或凭据。
- 本地gzip：4,288,447 bytes，SHA256 `cc40e5bae36fa4bb220ae4fc6afc63917b3043acbed06fb315dbe62c4fdfce45`；解压tar：7,557,120 bytes，SHA256 `5dbe16e15f31c274a3ebeb3ce69b9c1e7b5d86d00517ee6faeb8f778a6194520`。后端记录format tar/25文件/7,557,120 bytes，content_hash `sha256:92139cbfc5bf0d6756db4669147d673cfd0a2307b9826f98c9bc448c9a34857d`。未取得后端存档字节，不能把不同摘要说成完全一致；线上UI/资源内容复核仍HOLD。
- 原版本05、06的部署dist已移入 `F:\sites\manhwa-reader-artifacts` 的对应版本目录，可恢复，无递归删除。第一次07 CLI误传两个参数，被“拒绝覆盖非空输出”阻止（chunk5b30b7，exit1），按声明的单输出参数重跑成功，无原仓库文件被覆盖。
- Sites helper首轮已推源、打包GNU tar因Windows盘符当远端失败（chunkf4d212），保留提交/站点，未重建或重复发布。仅调整官方Bash packager调用为POSIX路径，chunk39204b成功；未改插件脚本，未走远端build fallback。
- 凭据仅session内存/隐藏stdin；不写argv、日志、Git remote、hosting或工作区。发布之后清除了主Agent的凭据/带token响应缓存。这里的JSON回执删去临时签名截图URL及所有token。

## P0 范围化验收与剩余条件

依据已读取的P0模板报告，结论CONDITIONAL，不宣称通用无人值守Agent框架整体P0通过。本任务是一次性静态修复，非调度/网络Feed/记忆平台。

| ID | 当前结论 | 证据或排除规则 |
|---|---|---|
| P0-01 | SKIPPED | rule: nonrecurring-static-workflow；无调度器，无新增自动化 |
| P0-02 | SUCCESS（任务范围） | offline CHECKING/READY/INCOMPLETE/UNAVAILABLE/TIMEOUT，存储独立UNKNOWN/PERSISTENT/BEST_EFFORT；报告的HOLD/UNKNOWN/SKIPPED未并为成功。通用Feed的EMPTY/FILTERED_ALL等不适用 |
| P0-03 | CONDITIONAL | RED→GREEN+真实离线图片、read-only复核、发布/访问/源版本回读；线上UI与实机不计通过 |
| P0-04 | SKIPPED | rule: nonrecurring-static-workflow；不伪造cycle计数或心跳 |
| P0-05 | SUCCESS（本轮授权范围） | 用户选本轮私有测试；只private publish，0公开发布/新增访客/账户重置 |
| P0-06 | SUCCESS（本地/控制面范围） | run_id、基线、备份、版本、测试exit/stderr、产物逐项SHA、源SHA、部署ID/策略回读均保留；独立设备未有证据 |
| P0-07 | CONDITIONAL | 源/包/截图/关键skills摘要冻结；实机与线上加载版本未取得 |
| P0-08 | SUCCESS（本轮文件及版本） | hosting原子身份落盘后回读；生成包实际解包24摘要+25计数；进度/报告/回执均独立文件，可重放；不把文件存在当交互完成 |
| P0-09 | SUCCESS（本轮安全） | 单写者、脏基线原副本、失败截图与旧版本追加保留；无用户数据上传或记忆更新；未绕过登录 |
| P0-10 | CONDITIONAL | HOST-UI负责人主Agent/用户联合，实机用户执行；截止下一次公开发布决策前，未完成不公开。UNKNOWN存档差异同样不得无限保留；未安排后台无限重试 |
| P0-11 | SUCCESS（披露范围） | 68测试分母含旧源契约，不当真机通过率；3页普通合成PDF而非真实用户整书；线上UI/条漫浏览器/实机排除项明确 |
| P0-12 | SUCCESS（本轮边界） | 仅已批准A/B、私有静态托管；不原生打包、不公开、不新增插件/帐号/云同步、不重置额度 |

负向场景证据：缺worker原子安装失败、cache open/match异常在线回退/离线503、registration成功不宣称离线、取消手势不翻页、捕获UI不缩放、hidden viewport timeout清理RAF、测量后取消、非空输出拒绝覆盖、仅清理本阅读器旧缓存/保留无关缓存。审批超时、网络Feed EMPTY/FILTERED_ALL、完整产品回滚和实机触摸均未执行，不补造通过。

保留的Minor：早期无数字PDF名在既有章节推断会显示“第Infinity话”，数字命名fixture显示正常；它不是本轮新引入，公开前处理。条漫真实浏览器与手机测试需补充，公开前还需受支持的已修补PDF.js升级与回归，不把no-eval workaround称为全部漏洞修复。

## 环境、清理与恢复

Node 24.18.1；Git 2.55.0.windows.3；Sites 1.0.0；Computer Use 26.1007.21434；superpowers 6.4.2。关键规则摘要：Sites SKILL `5A942CDA3C1A22A94B71F24ACE3E3489B6E5DD72B1EC9DA69D17FD400031647A`；Jev SKILL `8A16109872151D84A6CF9ADECFFE3C7FE0F1D48CCF9ECED5291DEF3E743F4F01`；P0 checklist `ADCD2ED9AD3D7438F1E29BF5C83F2D9E8C01A64325E04571B82553D55A08F968`。

app.js SHA256 `BD732E660362D70886FEE9DAC564C3A53CF72C43B1B23CF98D35CB0C200C6C4E`；pwa-assets `4C54C6FDEFDF75D2F58145DCF34342C86C034D4E06C43A5C3F63556DBD1EEE81`。db.js仍为原脏基线 `F1C503E38E6A6CDA8A385FADD1A16592AC9E68A5BFB9104DCDA85026E1914E82`，server.js仍为 `88706A717AF6FAB460E720BFEA2F6F5532E3D14FEDA071464F2A436A98E61AD1`。

自建8767与8768均主动Ctrl-C停止，chunk50d88b、260e0a；监听回读chunk84b9c2仅8765/PID7768，原服务保留。请求了临时viewport.reset，随后批次开线上页超时，复位完成状态无法独立确认；工具初始化故障后未用另一个驱动/终端CDP绕过，也未操作用户其他标签页。工具创建的临时页按产品默认回收；线上入口通过正常Codex展示工具交给用户。

回滚只逐文件比较开始前备份；原仓库脏数据不得reset/checkout/clean。部署副作用已发生但仅private，任何撤销、删除或权限变更需用户方向，不自动删除站点。下一轮必须复用已落盘project_id及现有版本，不重复create；先做PHONE-TEST实际登录/加载/安装/离线复开，再决定必要修复。

## 最后收尾回执

最终 `node --test` 再跑68/68、0 fail/0 skipped，exit0、1557ms，chunka80b55；8文件syntax和diff check再次通过，chunk908079，exit0。Unified exec合并stdout/stderr，本地完整测试未见非预期诊断；syntax/diff检查的stderr只见Git已披露的LF/CRLF提示，不能把合并输出冒称为独立捕获的空stderr。产品app/pwa-assets/db/server四个摘要再次与上方锚点相同。

`PRE-RUN-BASELINE.diff` 是开始前真实脏文件副本对当前文件的只读diff，不是HEAD对当前的混合diff；新文件/资源摘要另见STATIC-ARTIFACT.json。测试仍可按上方命令重放，不需要推送原仓库。

Codex `open_in_codex` 私有URL展示请求返回queued；只证明已排队，未声称页面已显示或加载成功。后续点击本报告URL或PHONE-TEST里的URL由用户实际验收。没有自动取消私有发布，没有转为公开，也没有执行额度重置。
