'use strict';
// 构建时给 www/pwa-assets.js 打一个唯一版本号。
// 作用：Service Worker 的缓存键由这个版本号决定，版本变了才会丢弃旧缓存、加载新代码。
// 不这样做的话，install -r 装上新包后 WebView 仍会跑 Service Worker 里的旧 app.js。
const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'www', 'pwa-assets.js');
if (!fs.existsSync(target)) {
  console.error('[build-stamp] 找不到 www/pwa-assets.js，请先运行 npm run sync:www');
  process.exit(1);
}

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const version = `build-${stamp}`;

const source = fs.readFileSync(target, 'utf8');
const patched = source.replace(/version:\s*'[^']*'/, `version: '${version}'`);
if (patched === source && !source.includes(`version: '${version}'`)) {
  console.error('[build-stamp] pwa-assets.js 里没有找到 version 字段');
  process.exit(1);
}

fs.writeFileSync(target, patched);
console.log(`[build-stamp] 版本号已写入: ${version}`);
