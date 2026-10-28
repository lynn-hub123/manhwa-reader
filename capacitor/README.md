# Capacitor 原生壳（可选）

PWA 是当前可直接运行的移动版本；Capacitor 配置在 `capacitor.config.json`，原生壳的打包链只同步根目录的网页资源（不另起一套数据层）。

## Android

已生成 `android/` 工程，路径如下：

```text
npx cap add android          # 首次生成
npm run cap:sync             # 把根目录资源同步到 android/app/src/main/assets/public
npm run cap:apk              # assembleDebug（本地调试用，debug 签名）
# 正式发布：准备好 android/signing.properties 后
cd android && ./gradlew assembleRelease   # 或 bundleReleaseAab
```

signing.properties 模板见 `android/signing.properties.example`，包含 keystore 路径、密码、key alias 和 key 密码。把真实值写进去但**不要提交到仓库**（已被 `.gitignore` 忽略）。

## iOS（尚未生成平台目录）

当前仓库没有 `ios/` 目录，也没有在 `package.json` 里声明 `@capacitor/ios`。原因：
- iOS 只能在 **macOS + Xcode 环境**生成和打包，本仓库最初是在 Windows 上开发；
- iOS 签名证书需要 Apple 开发者账号，本项目没有预存。

补齐步骤：
1. 在 Mac 上拉取仓库，`npm install && npm run sync:www`
2. `npm i -D @capacitor/ios`
3. `npx cap add ios && npx cap sync ios && npx cap open ios`
4. 在 Xcode 里配置 Bundle Identifier（与 Android 保持一致：`com.lynnhub.manhwareader`）、Signing Certificate、Info.plist 里的「文件访问权限」（PDF 选择器依赖 UIDocumentPickerViewController）

iOS 原生壳同样复用网页端的 IndexedDB 持久化和 CapacitorFilePicker 插件（`readData` → `path` + `fetch` 读取）。在正式补齐之前，iOS 用户可直接通过 Safari 访问 PWA 并「添加到主屏幕」获得接近原生的体验（但 Safari 清理站点数据会清空整个书架，且 iOS 有 1GB / 8 周的存储限制）。

## 原生壳的统一原则

- `webDir` 指向同步后的静态目录（默认 `www/`），不要把用户导入的 PDF 打进原生包；
- 所有数据仍在 IndexedDB（4MB 分块，头尾校验），跨平台无需迁移；
- 发布前必须跑 `npm run sync:www`，并手工确认 APK/AAB 的 assets 里不含 `*.apk`、`*.pdf`、`*.md`、`*.bak` 等项目源码或说明文件。
