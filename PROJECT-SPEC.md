韩漫阅读器（Manhwa Reader）— 完整项目规格书
项目概要
一个纯前端 + Node.js 本地服务器的漫画阅读器（面向韩漫/条漫 PDF）。所有数据存浏览器 IndexedDB，无需后端数据库。
运行方式：node server.js → http://localhost:8765
依赖：Node.js、pdf.js 3.11.174（CDN）
文件：index.html、app.js、db.js、server.js、启动阅读器.bat、fonts/MaShanZheng-Regular.ttf
一、index.html — 前端页面骨架
关键 DOM 结构
<body>
  #browser-warning          // 浏览器不兼容提示（非 Chrome/Edge 时显示）
  #bookshelf                // 书架主页
    .bs-header              // 标题栏
      h1                    // "📚 我的书架"
      #bs-total             // "共 X 部"
      #bs-search            // 搜索输入框
      #bs-sort              // 排序下拉：recent/name/created
      #bs-settings-btn      // ⚙️ 设置按钮
      #btn-cache-mgr        // 💾 管理缓存按钮
      #bs-add-folder        // 📂 打开文件夹按钮（有 folder picker 时显示）
      #bs-add-files         // 📄 选择文件按钮
      #bs-add-btn           // + 添加漫画按钮
    #startup-note           // 💡 提示：使用 http://localhost 打开可保证缓存持久
    #drag-hint              // 💡 提示：拖拽 PDF 或文件夹到窗口
    .bs-rack#bs-grid        // ← 书架容器（核心！JavaScript 在此渲染书籍卡片）
    #rack-pager             // 分页导航
  #reader.hidden            // 阅读器（初始隐藏）
    #topbar                 // 工具栏
      #btn-back             // ← 书架
      .logo                 // 📖
      #ch-info              // 当前章节信息
      #btn-settings         // ⚙️ 设置
      #btn-set-cover        // 🖼 设封面
      #btn-add-files-reader // 📄 追加文件
      #btn-add-folder-reader// 📂 追加文件夹
      #btn-toggle-sidebar   // ☰ 目录
      #zoom-select          // 缩放选择：60%/75%/90%/100%/125%/150%/适应宽度
    #main                   // 主区域
      #sidebar              // 左侧章节列表（可拖拽调整宽度 180-480px）
        #sidebar-resizer    // 拖拽手柄
        #chapter-list       // 章节项：圆点 + 章节号 + 名称 + 条漫标记
      #viewer-area          // PDF 渲染区（滚动容器）
        #loading            // 加载中动画
        #page-container     // 页面 wrapper 容器
    #bottombar              // 底部控制栏
      #btn-prev-ch          // 上一章
      #btn-prev-pg          // 上一页
      #page-info            // 页码/进度显示
      #page-slider          // 页码滑块
      #btn-next-pg          // 下一页
      #btn-next-ch          // 下一章
  #modal-overlay            // 模态框容器
  #drop-overlay             // 拖拽遮罩
  #toast                    // Toast 提示条
  <input type="file" id="hidden-file-input" multiple>   // 隐藏：导入文件
  <input type="file" id="hidden-cover-input" accept="image/*">  // 隐藏：上传封面
  <script src="db.js"></script>
  <script src="app.js"></script>
</body>
关键 CSS 类名（必须与 app.js 生成的 HTML 一致）
.bs-rack — 书架主容器，display:flex; perspective:1200px
.bs-rack::after — 书架层板伪元素（木质阴影）
.rack-book — 书脊卡片，flex:0 0 auto; transform-style:preserve-3d
.rack-spine — 书脊本体，background:var(--spine-bg)
.rack-spine-title — 书脊标题，writing-mode:vertical-rl; font-family:'Ma Shan Zheng'
.rack-cover-pull — hover 时抽出的封面卡片
.rack-progress / .rack-progress-fill — 进度条
.rack-add — 添加按钮卡片
.rack-menu-btn — 菜单按钮
.change-cover-btn — 换封面按钮
CSS 主题变量（日夜双主题）
:root, [data-theme="night"] {
  --bg:#1B1F24; --surface:#232930; --surface2:#2A323B; --card:#272E36;
  --accent:#7FA8A0; --accent-hover:#93BAB1;
  --accent-soft:rgba(127,168,160,0.14); --accent-glow:rgba(127,168,160,0.28);
  --text:#E3E8EC; --text2:#9AA4AE; --text3:#5E6A76;
  --border:#35404A; --shadow:0 5px 20px rgba(0,0,0,0.35);
  --dot-unread:#4A555E; --dot-reading:#D4A24C; --dot-read:#7BB79A;
  --shelf:#252B31; --shelf-edge:#3A454F; --shelf-shadow:rgba(0,0,0,0.45);
  --book-shadow:rgba(0,0,0,0.45); --book-spine:rgba(255,255,255,0.06);
  --radius:8px;
}
[data-theme="day"] {
  --bg:#F6F4EF; --surface:#FFFFFF; --surface2:#F1F4EF; --card:#FFFFFF;
  --accent:#7FA08A; --accent-hover:#94B49C;
  --accent-soft:rgba(127,160,138,0.12); --accent-glow:rgba(127,160,138,0.2);
  --text:#3A423E; --text2:#7C8581; --text3:#B4BAB6;
  --border:#E4E7E2; --shadow:0 4px 16px rgba(0,0,0,0.06);
  --dot-unread:#C2C9C4; --dot-reading:#C99B3F; --dot-read:#5F9676;
  --shelf:#E9ECE7; --shelf-edge:#CBD2CB; --shelf-shadow:rgba(0,0,0,0.12);
  --book-shadow:rgba(0,0,0,0.16); --book-spine:rgba(255,255,255,0.4);
}
@font-face
@font-face {
  font-family: 'Ma Shan Zheng';
  src: url('fonts/MaShanZheng-Regular.ttf') format('truetype');
  font-display: swap;
}
二、db.js — IndexedDB 数据库层
数据库名：manhwa-reader-db，版本 v2，4 个 Object Store：
Store	keyPath	索引	用途
bookshelf	seriesId	—	系列元数据
pdf-cache	cacheKey	seriesId	PDF 二进制缓存
settings	key	—	键值设置
covers	seriesId	seriesId(unique)	封面 dataURL


暴露的全局对象：const db = new ManhwaDB()
完整 API
db.open()                         → Promise<IDBDatabase>
db.loadBookshelf()                → Promise<Series[]>
db.saveSeries(series)             → Promise<void>
db.deleteSeries(seriesId)         → Promise<void>
db.getSettings()                  → Promise<{key:value}>
db.saveSetting(key, value)        → Promise<void>
db.saveCover(seriesId, dataUrl)   → Promise<void>
db.loadCover(seriesId)            → Promise<dataUrl|null>
db.loadAllCovers()                → Promise<{seriesId,dataUrl}[]>
db.deleteCover(seriesId)          → Promise<void>
db.savePDF(seriesId, chNum, ArrayBuffer) → Promise<void>
db.loadPDF(seriesId, chNum)       → Promise<ArrayBuffer>
db.pdfExists(seriesId, chNum)     → Promise<boolean>
db.deleteSeriesPDFs(seriesId)     → Promise<void>
db.getCacheStats()                → Promise<{[seriesId]:{count,size}}>
db.getStorageEstimate()           → Promise<{usage,quota,pct}|null>
db.normalizeSeries(s)             → Series（补全缺省字段）
db.migrateFromLocalStorage()      → Promise<boolean>（从 localStorage 迁移旧数据）
cacheKey 格式：${seriesId}_${chapterNum}
数据模型
// Series
{
  seriesId: "uuid-string",
  name: "作品名称",
  chapters: [{
    name: "第1话",
    chapterNum: 1,      // Infinity = 无编号
    pages: 48,           // PDF 总页数（加载后回填）
    cached: true,        // PDF 是否已存入 IndexedDB
    loaded: false,       // 是否已加载到内存
    status: "unread",    // "unread" | "reading" | "read"
    isWebtoon: false     // 条漫标记（加载后回填）
  }],
  lastChNum: 5,          // 最后阅读章节号
  lastPage: 12,          // 最后页码（条漫则为 0-100 的滚动百分比）
  createdAt: "2024-01-01T00:00:00.000Z"
}
三、app.js — 核心前端逻辑
全局状态变量
let bookshelf = []              // Series 数组
let currentSeries = null        // 当前打开的 seriesId
let chapters = []               // 当前系列的章节数组
let currentChIdx = -1           // 当前章节索引
let currentPage = 1             // 当前页码
let pdfDoc = null               // PDF.js 文档对象
let renderTasks = []            // 进行中的渲染任务
let zoom = 1.5                  // 缩放倍数（默认 150%）
let fitWidth = false            // 是否适应宽度
let renderedPages = new Set()   // 已渲染页号集合
let scrollTimer = null          // 滚动防抖定时器
let prefetchQueue = []          // 预取队列
let prefetching = false         // 是否正在预取
let chapterLoadToken = 0        // 章节加载令牌（防止竞态）
let hasFolderPicker = false     // 是否支持 showDirectoryPicker
let _pendingFiles = null        // 暂存拖入的文件
let _pendingFilesMode = 'drop'  // 拖入模式
let covers = {}                 // {seriesId: dataURL}
let settings = {                // 用户设置
  zoom: '1.5',
  direction: 'scroll',
  dualPage: false,
  sidebarOpen: true,
  theme: 'night',
  webtoonAuto: true
}
let searchQuery = ''            // 搜索关键词
let sortMode = 'recent'         // 排序模式
let isWebtoon = false           // 当前章是否为条漫
let webtoonScrollPct = 0        // 条漫滚动百分比
let rackPage = 0                // 书架当前页
核心函数（按调用顺序）
初始化
initApp()
  → 检测浏览器兼容
  → 检测 showDirectoryPicker 支持
  → 从 DB 读取设置和书架数据
  → 加载封面缓存
  → renderBookshelf()
书架渲染
renderBookshelf()
  → 排序（searchQuery + sortMode）
  → 分页（PAGE_SIZE=12）
  → 调用 applyRackSizing(n) 计算 CSS 变量
  → 生成 HTML（每本书 = .rack-book > .rack-spine + .rack-cover-pull + 按钮 + .rack-progress）
  → 绑定事件：click→openSeries, change-cover-btn, rack-menu-btn, rack-add
  → 更新分页导航

applyRackSizing(n)
  → 根据可用宽度计算：--rack-spine-w(40-64px), --rack-cover-w(书脊×3.2), --rack-spine-gap, --rack-add-w

spineColor(name)
  → 书名哈希 → HSL(hue, 42%, 42%)
导入流程
拖拽 → dropHandler(dt)
  → 提取 PDF 文件（files + items → getAsEntry → collectFiles 递归）
  → 暂存到 _pendingFiles
  → 如果书架为空 → 直接 createSeries
  → 否则 → showModal('add-choose') 让用户选择新建还是追加

showModal('add-choose')
  → 选择"新建" → showModal('add-name')
  → 选择"追加" → 下拉选已存在系列
  → 确认 → createSeries(name, files) 或 importFilesToSeries(sid, files)

createSeries(name, files)
  → 生成 seriesId(uuid)
  → 按文件名解析 chapterNum（支持 "第1话" "01" "(1)" "ch01" 等格式）
  → 生成文字封面 makeTextCover(name)
  → 保存到 DB + bookshelf
  → 后台缓存 PDF 到 IndexedDB
封面系统
makeTextCover(name)
  → Canvas 600×840 渲染：渐变背景 + 边框 + 装饰圈 + 竖排标题 + "· MANHWA ·" 副标题
  → 字体：'Ma Shan Zheng','Zhi Mang Xing','STXingkai','KaiTi','STKaiti',serif
  → 输出 JPEG dataURL

startCoverCapture(sid)
  → 遮罩层 + 十字光标
  → mousedown/mousemove/mouseup 绘制矩形选择框
  → 映射到 PDF 实际坐标
  → 裁剪 canvas → setSeriesCover()

pickImageCover(sid)
  → 触发隐藏 <input type="file" accept="image/*">
  → FileReader → dataURL → setSeriesCover()

setSeriesCover(sid, dataUrl)
  → db.saveCover(sid, dataUrl)
  → covers[sid] = dataUrl
  → 更新书架显示

loadCoverCandidates(sid)
  → 加载第一章 PDF，渲染前 12 页缩略图
  → scoreCover() 多维度评分排序（面板线密度、色彩丰富度、中心对比度、白色覆盖率）
  → 返回最佳候选列表
阅读器
openSeries(id)
  → currentSeries = id
  → 200ms 淡出书架 → 显示阅读器
  → renderChapterList()
  → loadChapter(上次阅读的章节索引)
  → 恢复上次页码/滚动位置

closeReader()
  → 保存进度（fire-and-forget）
  → 取消所有渲染任务
  → 销毁 pdfDoc
  → 200ms 淡出阅读器 → 显示书架

loadChapter(i)
  → chapterLoadToken++ 防竞态
  → 标记当前章为 "reading"，上一章为 "read"
  → 从 DB 加载 PDF（若 cached 标记丢失则 pdfExists+loadPDF 双重降级恢复）
  → pdfjsLib.getDocument → 检测条漫 detectWebtoon()
  → 生成 page-wrapper DOM（每个 wrapper 内含 canvas + label）
  → renderVisiblePages() 懒加载
  → prefetchNextSafe(i) 预取下两章

detectWebtoon()
  → 检查前 3 页，任一高宽比 > 3 → 判定为条漫

renderVisiblePages()
  → 读取 viewer-area 滚动位置
  → 只渲染视口 ±400px 内的页面
  → 每批 3 页并发

goToPage(n) → page-wrapper.scrollIntoView
nextPage/prevPage → 条漫：scrollWebtoon(±70%视口) | 分页：goToPage
nextChapter/prevChapter → loadChapter(i±1)
键盘快捷键
键	功能
方向右 / D	下一页（条漫：下滚）
方向左 / A	上一页（条漫：上滚）
方向上 / W	上一章
方向下 / S	下一章
F	适应宽度
B	切换侧边栏
Esc	返回书架


模态框系统
showModal(type, data)
  types: 'add-choose', 'add-name', 'delete-confirm', 'cache-mgr',
         'settings', 'cover-pick', 'set-cover', 'cover-select', 'rack-menu'

settings 模态框：缩放/方向/双页/侧边栏/主题/条漫开关 → db.saveSetting()
cache-mgr：getCacheStats + getStorageEstimate
delete-confirm：确认删除 + 可选清除缓存
cover-pick：loadCoverCandidates 的 12 格缩略图网格
搜索与排序
bs-search input → searchQuery → renderBookshelf（实时）
bs-sort change → sortMode → renderBookshelf
  排序规则：
    - recent: 按 lastChNum 降序
    - name: localeCompare('zh')
    - created: 按 createdAt 降序
其他
右键 .rack-book → contextmenu → showModal('delete-confirm')
侧边栏拖拽：sidebar-resizer mousedown/mousemove/mouseup，180-480px
Toast：底部弹性滑入，cubic-bezier(.34,1.56,.64,1)，2秒后消失
resize 事件：fitWidth 时 reRenderAll() + applyRackSizing()
prefers-reduced-motion：全部动画降级
完整事件绑定清单
viewer-area         scroll (防抖150ms)     → 更新页码/进度 + 懒加载 + saveProgress
page-slider         input                   → goToPage()
zoom-select         change                  → reRenderAll() + 持久化
btn-back            click                   → closeReader()
btn-toggle-sidebar  click                   → sidebar.classList.toggle('hidden')
btn-prev-pg         click                   → prevPage()
btn-next-pg         click                   → nextPage()
btn-prev-ch         click                   → prevChapter()
btn-next-ch         click                   → nextChapter()
btn-cache-mgr       click                   → showModal('cache-mgr')
bs-settings-btn     click                   → showModal('settings')
btn-settings        click                   → showModal('settings')
btn-set-cover       click                   → showModal('set-cover')
bs-search           input                   → searchQuery + renderBookshelf()
bs-sort             change                  → sortMode + renderBookshelf()
bs-add-folder       click                   → showAddModal() (folder模式)
bs-add-files        click                   → showAddModal() (input模式)
btn-add-files-reader click                  → pickFilesViaInput → importFilesToSeries
btn-add-folder-reader click                 → pickFolder → importFilesToSeries
sidebar-resizer     mousedown → 全局mousemove/mouseup → 拖拽调整宽度
document            keydown                  → 快捷键
document            dragover/dragenter/dragleave/drop → 拖拽系统
document            contextmenu(.rack-book)  → 右键删除
window              resize                   → fitWidth?reRenderAll + applyRackSizing
四、server.js — 本地服务器
http.createServer 监听 localhost:8765
/: → 重定向 index.html
路径穿越防护（path.normalize + startsWith 检查）
MIME 映射：.html/.js/.css/.json/.png/.jpg/.svg/.pdf/.ttf/.woff2
自动 charset=utf-8
启动时用 exec('start "" "http://localhost:8765"') 自动打开浏览器
五、启动脚本 — 启动阅读器.bat
@echo off
cd /d "%~dp0"
chcp 65001 >nul
title 韩漫阅读器
echo 服务器启动中...
node server.js
pause
六、功能总览（Phase 1 → 2J）
书架展示（书脊优先 + hover 抽出封面 + 竖排标题 + 层板）
拖拽导入（PDF 文件/文件夹，自动解析章节号）
文件选择导入（新增/追加到已有系列）
阅读器（PDF.js 渲染，章节导航，页码滑块）
条漫自动检测（前 3 页高宽比 > 3 → 滚动模式）
条漫进度（百分比记录 + 恢复）
阅读进度记录（lastChNum + lastPage）
键盘快捷键（方向键/WASD/F/B/Esc）
IndexedDB 持久化（bookshelf/pdf-cache/settings/covers 四个 store）
跨浏览器文件夹导入（showDirectoryPicker + 递归收集）
设置持久化（缩放/方向/双页/侧边栏/主题/条漫开关）
文字封面生成（Canvas + 书法字体）
阅读中截图设封面（拖拽选取 + 坐标映射）
上传图片设封面（FileReader → dataURL）
封面候选推荐（评分排序）
缓存管理（按系列统计/清除，空间配额显示）
日夜双主题（CSS 变量切换）
实时搜索（名称匹配）
三种排序（最近阅读/名称/添加时间）
分页书架（PAGE_SIZE=12）
懒加载（视口 ±400px，每批 3 页）
章节预取（下两章后台加载）
右键删除（确认 + 可选清除缓存）
侧边栏拖拽调整宽度（180-480px）
阅读状态圆点（unread=灰/reading=金/read=绿）
Toast 通知（弹性动画）
页面切换淡入淡出（200ms）
无障碍动画降级（prefers-reduced-motion）
自适应书脊宽度（根据书本数量动态计算）
书脊颜色哈希（每本书独特 HSL 色）
阅读器内追加文件
书名右键菜单
Firebase-and-forget 性能模式（closeReader/delete/saveProgress 异步落盘）
loadChapter cached 标记丢失自动降级恢复