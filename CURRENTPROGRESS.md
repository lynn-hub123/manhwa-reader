韩漫阅读器 — 完整项目规格书（Phase 1 → 2J）
项目概览
一个纯前端 + Node.js 本地服务器的漫画（Manhwa）阅读器。用户在浏览器中管理 PDF 漫画、阅读、缓存。
本地运行：node server.js → http://localhost:8765
存储：浏览器 IndexedDB（所有数据在浏览器端，不依赖后端数据库）
核心依赖：pdf.js 3.11.174（CDN）、Node.js HTTP 模块
文件结构与用途
F:\manhwa-reader\
  index.html          — 前端页面（HTML 骨架 + 全部 CSS）
  app.js              — 核心前端逻辑（~53KB，所有交互、渲染、导入、阅读器）
  db.js               — IndexedDB 数据库封装层
  server.js           — Node.js 本地静态文件服务器
  启动阅读器.bat        — 一键启动脚本
  fonts\               — 字体目录
    MaShanZheng-Regular.ttf  — 马善政书法字体（书脊/封面用）
Phase 1：基础框架
书架（bookshelf）
每本书显示封面缩略图 + 书名 + 话数
点击书名进入阅读器
空书架时显示引导提示
阅读器（reader）
顶部工具栏：返回按钮、书名显示、缩放（60%/75%/90%/100%/125%/150%/适应宽度）、目录按钮、设置按钮
左侧可拖拽侧边栏：章节列表，显示章节号、章节名、阅读状态（未读/在读/已读）
主视图区：PDF.js 逐页渲染（canvas）
底部工具栏：上一章、上一页、页码滑动条、下一页、下一章
导入系统
通过 <input type="file"> 选择 PDF 文件
拖拽 PDF 文件/文件夹到窗口
自动从文件名解析章节编号（支持常见韩漫命名格式）
导入时创建新系列或追加到已有系列
server.js 提供 http:// 访问以支持文件夹拖拽
Phase 2A：持久化与跨浏览器
IndexedDB 数据库（db.js）
DB名称：manhwa-reader-db，版本 v2
4 个 Object Store：bookshelf（keyPath: seriesId）— 系列元数据
pdf-cache（keyPath: cacheKey，索引 seriesId）— PDF 二进制缓存
settings（keyPath: key）— 键值设置
covers（keyPath: seriesId）— 封面 dataURL

方法：open(), loadBookshelf(), saveSeries(series), deleteSeries(seriesId), getSettings(), saveSetting(key, value), saveCover(seriesId, dataUrl), loadCover(seriesId), loadAllCovers(), deleteCover(seriesId), savePDF(seriesId, chapterNum, ArrayBuffer), loadPDF(seriesId, chapterNum), pdfExists(seriesId, chapterNum), deleteSeriesPDFs(seriesId), getCacheStats(), getStorageEstimate(), normalizeSeries(s), migrateFromLocalStorage()
关键数据模型：
// Series 对象
{
  seriesId: "uuid",      // 唯一ID
  name: "作品名",
  chapters: [{
    name: "第1话",
    chapterNum: 1,
    pages: 48,           // PDF 总页数
    cached: true,        // 是否已缓存到 IndexedDB
    loaded: false,       // 是否已加载到内存
    status: "unread",    // unread | reading | read
    isWebtoon: false     // 条漫标记
  }],
  lastChNum: 5,          // 最后阅读的章节号
  lastPage: 12,          // 最后阅读的页码（条漫则为滚动百分比 0-100）
  createdAt: "ISO时间戳"
}
跨浏览器文件夹导入
hasFolderPicker 检测：window.showDirectoryPicker 存在时启用文件夹选择按钮
pickFolder()：调用 showDirectoryPicker，递归遍历子目录，收集 PDF
pickFilesViaInput()：通过隐藏 <input type="file" multiple> 选择多个文件
collectFiles(entry, out)：递归读取 FileSystemDirectoryEntry 下所有文件
设置持久化
settings 对象：{ zoom, direction, dualPage, sidebarOpen, theme, webtoonAuto }
所有设置在 db.saveSetting() 中存到 IndexedDB
启动时从 DB 恢复
Phase 2B：封面与缓存
封面系统
默认自动生成：makeTextCover(name) 在 canvas 上渲染渐变背景 + 竖排书法标题 + 装饰图案，输出 JPEG dataURL
导入时自动生成封面并提示用户确认/上传
阅读中截图：startCoverCapture(sid) 在 PDF 渲染页面上拖拽选取区域，裁剪为封面
上传自定义：通过 pickImageCover() 选择本地图片文件，FileReader 转 dataURL
covers 对象：{ [seriesId]: dataURL } 在内存中缓存，DB 中持久化
封面评分：scoreCover(canvas, viewport) 分析画面质量（线条密度、色彩丰富度、中心对比度），自动推荐最佳页面作封面
缓存管理
模态框显示各系列的 PDF 缓存数量和大小
按系列清除缓存按钮
显示 IndexedDB 总用量/配额百分比
封面选择模态框
cover-pick 模态框：显示该系列 PDF 中评分最高的 12 页缩略图
点击缩略图设为封面
恢复默认（重新生成文字封面）
上传自定义图片
Phase 2C：条漫模式 + 性能 + 四主题
条漫（Webtoon）自动检测
detectWebtoon()：检查 PDF 前 3 页，任一页高宽比 > 3 则判定为条漫
条漫模式下：所有页面垂直排列，#viewer-area 自由滚动
方向键重映射：左/右 → 上下滚动 70% 视口
上下键保持章节切换
进度保存为滚动百分比 getScrollProgress() 0-100
底部显示"滚动 72%"而非"3/48 页"
restoreWebtoonScroll(pct) 恢复阅读位置

设置面板"条漫自动识别"开关（开/关），持久化
性能优化（Fire-and-Forget）
closeReader()：先切 UI（200ms 淡出），后异步落盘，不阻塞用户操作
删除系列：立即从 bookshelf splice + re-render，后台异步清理缓存和封面
saveProgress()：异步保存，不阻塞翻页
四主题 UI（Phase 2C 版）
主题：薄荷(mint) / 暮樱(sakura) / 海盐(seasalt) / 晨雾(morning，默认)
全部 CSS 变量化，[data-theme] 切换
设置面板下拉选择，IndexedDB 持久化
Phase 2D：主题重设计 + 多项修复
主题重设计（1亮3暗）
替换 Phase 2C 的四轻主题为：
晨雾 morning（亮）— 暖白/米色
薄暮 dusk（暖暗·默认）— 深棕/琥珀，暖光氛围
苔原 moss（冷暗）— 灰绿/冷调
暗星 star（极暗）— 深蓝/冷紫
四套主题分别配置了独立的：
--dot-unread, --dot-reading, --dot-read（侧边栏圆点颜色）
书架阴影（--shelf-shadow, --book-shadow）
强调色（--accent, --accent-hover）
各项修复
loadChapter 降级：若 cached 标记丢失但 DB 中实际存在 PDF，通过 pdfExists + loadPDF 双重重试恢复 cached=true
书架设置按钮：header 新增 ⚙️ 设置按钮，复用 settings modal
拖拽不自动追加到单系列：删除 bookshelf.length===1 分支，统一走 add-choose 选择框
默认缩放 150%：zoom:'1.5', fitWidth=false, zoom-select 默认 150%
Phase 2E：交互式陈列架（封面优先版）
将书架从简单网格改为实体书架风格：
.bs-rack：flex 容器，perspective: 1400px
.rack-book：每本书带 3D 变换，transform-style: preserve-3d
.rack-cover：封面卡片，aspect-ratio: 0.68（漫画比例），左侧书脊装饰、右侧阴影
applyRackSizing(n)：根据书本数量动态计算书宽和重叠量书越多越窄越重叠：7+本 → 40px 重叠，3本 → 24px
宽度 108-200px 自适应

分页系统：rackPage 变量，每页 12 本
选择状态（.selected）轻微上浮
Phase 2F：懒加载 + 快捷键
懒加载
renderVisiblePages()：只渲染视口 ±400px 范围内的 PDF 页面
scroll 事件节流：150ms debounce
每批最多 3 页并发渲染
章节预取：prefetchNextSafe() 后台加载下两章
键盘快捷键（全局）
按键	功能
方向右 / D	下一页（条漫：下滚）
方向左 / A	上一页（条漫：上滚）
方向下 / S	下一章
方向上 / W	上一章
F	适应宽度
B	切换侧边栏
Esc	返回书架


输入框内有焦点时不触发快捷键
Phase 2G：搜索、排序、日夜主题
搜索
<input class="bs-search"> 实时搜索，searchQuery 变量
大小写不敏感，匹配系列名称
排序
<select id="bs-sort"> 三种排序模式
recent：按最后阅读章节号降序（默认）
name：按名称拼音排序 localeCompare('zh')
created：按添加时间降序
日夜主题（替换四主题）
将 4 套主题简化为 2 套极精致的：
夜（night，默认）：冷灰蓝调，--bg:#1B1F24，暗色书架
日（day）：奶白/薄荷调，--bg:#F6F4EF，亮色书架
CSS 变量完备：bg, surface, surface2, card, accent, accent-hover, accent-soft, accent-glow, text, text2, text3, border, shadow, dot-unread, dot-reading, dot-read, shelf, shelf-edge, shelf-shadow, book-shadow, book-spine
Phase 2H：右键菜单与更多交互
右键删除
contextmenu 事件监听 .rack-book
弹出 delete-confirm 模态框：确认删除系列 + 可选清除缓存
其他交互
rack-menu-btn：每本书右上角 ⋯ 菜单按钮，hover 显示
change-cover-btn：每本书"换封面"按钮，hover 显示
showModal('rack-menu', {sid})：书名右键菜单（重命名/删除等）
侧边栏拖拽调整宽度：sidebar-resizer 鼠标拖拽，180-480px 范围
Toast：底部弹性滑入，cubic-bezier(.34,1.56,.64,1)，2秒自动消失
Phase 2I：封面截图优化
截图选择器
阅读器中点击"设封面"→ 模态框选择"从当前页截图"→ 进入截图模式
半透明遮罩 + 十字光标
拖拽选取矩形区域，自动映射到 PDF 实际坐标
裁剪并保存为封面 JPEG
封面候选系统
loadCoverCandidates(sid)：异步加载第一章，渲染 12 页缩略图
scoreCover(canvas, viewport)：多维度评分（面板线密度、色彩丰富度、中心对比度、白色覆盖率）
自动推荐最佳页面
Phase 2J：字体 + 规整叠放
@font-face
URL 从 jsDelivr CDN 改为 jsDelivr GitHub 代理（国内更稳定）
Ma Shan Zheng：马善政书法体，用于书脊/封面
Zhi Mang Xing：志莽行书体，备选
规整叠放
去除 Phase 2E 的大幅度旋转/错位
书保持水平对齐
仅保留轻微层次阴影模拟厚度
--stack-y: 0px; --stack-r: 0deg
CSS 变量完整清单
:root, [data-theme="night"] {
  --bg: #1B1F24;           /* 页面背景 */
  --surface: #232930;       /* 卡片/模态框背景 */
  --surface2: #2A323B;      /* 输入框/按钮背景 */  
  --card: #272E36;          /* 封面卡片背景 */
  --accent: #7FA8A0;        /* 强调色（青绿） */
  --accent-hover: #93BAB1;  /* 强调色 hover */
  --accent-soft: rgba(127,168,160,0.14);  /* 微弱强调 */
  --accent-glow: rgba(127,168,160,0.28);  /* 发光强调 */
  --text: #E3E8EC;          /* 主文字 */
  --text2: #9AA4AE;         /* 次文字 */
  --text3: #5E6A76;         /* 弱文字 */
  --border: #35404A;        /* 边框 */
  --shadow: 0 5px 20px rgba(0,0,0,0.35);  /* 通用阴影 */
  --dot-unread: #4A555E;    /* 未读圆点 */
  --dot-reading: #D4A24C;   /* 在读圆点（金色） */
  --dot-read: #7BB79A;      /* 已读圆点（绿色） */
  --shelf: #252B31;         /* 书架层板颜色 */
  --shelf-edge: #3A454F;    /* 书架边缘 */
  --shelf-shadow: rgba(0,0,0,0.45); /* 书架阴影 */
  --book-shadow: rgba(0,0,0,0.45); /* 书本阴影 */
  --book-spine: rgba(255,255,255,0.06); /* 书脊高光 */
  --radius: 8px;
}

[data-theme="day"] {
  --bg: #F6F4EF;
  --surface: #FFFFFF; --surface2: #F1F4EF; --card: #FFFFFF;
  --accent: #7FA08A; --accent-hover: #94B49C;
  --accent-soft: rgba(127,160,138,0.12); --accent-glow: rgba(127,160,138,0.2);
  --text: #3A423E; --text2: #7C8581; --text3: #B4BAB6;
  --border: #E4E7E2; --shadow: 0 4px 16px rgba(0,0,0,0.06);
  --dot-unread: #C2C9C4; --dot-reading: #C99B3F; --dot-read: #5F9676;
  --shelf: #E9ECE7; --shelf-edge: #CBD2CB; --shelf-shadow: rgba(0,0,0,0.12);
  --book-shadow: rgba(0,0,0,0.16); --book-spine: rgba(255,255,255,0.4);
}
app.js 完整函数清单
函数	行号(约)	用途
initApp()	15	入口：检测浏览器兼容、读取设置、加载书架、渲染
renderBookshelf()	70	渲染书架 HTML，绑定事件
applyRackSizing(n)	150	根据书本数量计算 CSS 变量（宽度、重叠）
findSeries(id)	170	在 bookshelf 中查找系列
saveSeriesBg(s)	175	异步保存系列到 DB
showAddModal()	180	显示添加漫画模态框
showModal(type, data)	200	通用模态框系统
closeModal()	350	关闭模态框
importFilesToSeries(sid, files)	370	导入 PDF 文件到系列
createSeries(name, files)	420	创建新系列并导入
makeTextCover(name)	500	Canvas 生成书法文字封面
captureCurrentPageAsCover()	560	截取当前 PDF 页面作封面
startCoverCapture(sid)	580	进入截图选取模式
pickImageCover(sid)	640	选择本地图片文件作封面
setSeriesCover(sid, dataUrl)	660	保存封面到 DB 和内存
loadCoverCandidates(sid)	690	加载 PDF 首页候选封面缩略图
scoreCover(canvas, vp)	750	封面质量多维度评分
openSeries(id)	810	打开漫画，进入阅读器
closeReader()	850	返回书架（fire-and-forget）
renderChapterList()	880	渲染侧边栏章节列表
highlightChapter(i)	900	高亮当前章节
setChapterStatus(i, status)	910	设置章节阅读状态
detectWebtoon()	920	条漫自动检测（前3页高宽比>3）
getScrollProgress()	930	获取条漫滚动百分比
restoreWebtoonScroll(pct)	940	恢复条漫滚动位置
loadChapter(i)	960	加载指定章节
prefetchNextSafe(i)	1040	预取下两章到内存
drainPrefetchSafe()	1050	后台消费预取队列
renderPage(pn)	1070	渲染单页 PDF
renderVisiblePages()	1100	懒加载可见页面
reRenderAll()	1120	缩放变化时重新渲染所有页面
goToPage(n)	1130	跳转到指定页
nextPage()	1140	下一页
prevPage()	1150	上一页
scrollWebtoon(dir)	1160	条漫方向滚动
nextChapter()	1170	下一章
prevChapter()	1180	上一章
updateNavButtons()	1190	更新上下章按钮状态
updatePageInfo()	1200	更新底部页码显示
saveProgress()	1210	保存阅读进度
dropHandler(dt)	1250	拖拽文件/文件夹处理
collectFiles(entry, out)	1320	递归收集文件夹内文件
showToast(m)	1340	Toast 通知


事件绑定（在 initApp 之后全局绑定）：
viewer-area.scroll → 滚动时更新当前页/进度 + 触发懒加载
page-slider.input → 拖拽页码滑块跳转
zoom-select.change → 缩放切换
btn-back.click → 返回书架
btn-toggle-sidebar.click → 切换侧边栏
btn-prev-pg/btn-next-pg.click → 翻页
btn-prev-ch/btn-next-ch.click → 翻章
btn-cache-mgr.click → 缓存管理
bs-settings-btn/btn-settings.click → 设置面板
btn-set-cover.click → 设封面
bs-search.input → 实时搜索
bs-sort.change → 排序切换
文件选择/文件夹选择按钮 → 导入流程
keydown 全局 → 键盘快捷键
dragover/dragenter/dragleave/drop 全局 → 拖拽
resize 全局 → 适应宽度 + 书架自适应
contextmenu .rack-book → 右键删除
已知 Bug
当前 index.html 和 app.js 可能存在类名不匹配（根源：此前编辑时文件损坏，从旧备份恢复导致 HTML 主体使用了旧版元素结构）。需确保：
<div class="bs-rack" id="bs-grid">（非 bs-shelf）
.rack-book、.rack-spine、.rack-cover 等 CSS 类名与 app.js 中生成的 HTML 一致
@font-face 引用的字体路径存在，或使用后备字体
所有 <script> 标签正确引用 db.js 和 app.js