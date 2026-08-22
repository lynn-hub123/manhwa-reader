# 韩漫阅读器 · 当前进度与下一步（2026-08-09）

## 项目结构
- 入口：F:\manhwa-reader\index.html
- 文件：index.html、app.js、db.js、server.js、启动阅读器.bat
- 本地运行：node server.js → http://localhost:8765
- 已完成阶段：Phase 1 → 2J（持久化、跨浏览器导入、条漫、懒加载、快捷键、缓存、封面、搜索排序、日夜主题、交互书架等）

## 最新完成（本次对话）

### ✅ 书脊优先书架（Spine-First Bookshelf）
1. **默认书脊展示**：每本书显示为窄书脊（40-64px），竖排标题用马善政书法字体展示在书脊上
2. **hover 抽出封面**：鼠标悬停时书向前倾斜抽出（translateY + rotateX + translateZ），封面从书脊侧面旋转翻出（rotateY 动画）
3. **书架层板**：`bs-rack::after` 伪元素模拟木质书架层板，书籍底部对齐
4. **书脊颜色**：每本书根据书名哈希生成独特的 HSL 颜色，像真实书店彩色书脊
5. **封面比例**：保持 0.68 宽高比，抽出封面宽度 = 书脊宽度 × 3.2
6. **进度条**：阅读进度条显示在书脊底部
7. **物理感动画**：抽出时书身倾斜 + 前移 + 封面旋转，非简单 scale 放大
8. **无障碍**：`prefers-reduced-motion` 时动画降级

### ✅ 字体修复
- `@font-face` 改为本地引用：`fonts/MaShanZheng-Regular.ttf`
- Zhi Mang Xing 不可用时 fallback 到 Ma Shan Zheng（同一 ttf）

### 代码改动摘要
- **index.html**：书脊优先 CSS（`.rack-spine`、`.rack-spine-title`、`.rack-cover-pull`、`.bs-rack::after` 等），本地字体引用
- **app.js**：
  - 新增 `spineColor(name)` — 根据书名生成 HSL 书脊颜色
  - `renderBookshelf()` — 生成书脊优先 HTML，传递 `--spine-bg` CSS 变量
  - `applyRackSizing(n)` — 计算书脊宽度（40-64px）、封面宽度、间距

## 待办
- [ ] 在实际浏览器中测试书脊书架的视觉效果和交互动画
- [ ] 确认封面更换/截图功能在新书架中正常工作
- [ ] 如需更多中文字体，可下载 Zhi Mang Xing 等字体到 fonts/ 目录

## 验证方式
- node --check app.js / db.js ✓
- 打开 http://localhost:8765 人工测试书架交互
- prefers-reduced-motion 时动画降级