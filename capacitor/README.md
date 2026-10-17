# Capacitor 原生壳（可选）

PWA 是当前可直接运行的移动版本；这个目录保留了 Capacitor 的最小配置，网页资源仍来自项目根目录，IndexedDB、PDF 缓存和阅读进度不需要迁移到另一套数据层。

在安装 Node/npm、Android Studio/Android SDK 后，可以在本目录执行：

```text
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap add android
npx cap sync android
npx cap open android
```

iOS 壳需要在 macOS/Xcode 环境执行 `npm install @capacitor/ios`、`npx cap add ios` 和 `npx cap sync ios`。本项目当前环境没有为 Android/iOS 生成平台目录，也没有签名证书；发布包仍需在对应平台完成 SDK、设备和 signing 配置。

原生壳必须把根目录作为 `webDir`，并通过 Capacitor 的本地 WebView 加载 `index.html`。不要把用户导入的 PDF 放入原生包；它们继续由文件选择器导入并写入 IndexedDB。
