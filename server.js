'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = __dirname;
const PORT = process.env.PORT || 8765;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.map': 'application/json',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (urlPath === '/') urlPath = '/index.html';

    // Prevent path traversal
    const safePath = path.normalize(path.join(ROOT, urlPath));
    if (!safePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.stat(safePath, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404);
        res.end('Not Found: ' + urlPath);
        return;
      }
      const ext = path.extname(safePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      });
      fs.createReadStream(safePath).pipe(res);
    });
  } catch (e) {
    res.writeHead(500);
    res.end('Server Error: ' + e.message);
  }
});

server.listen(PORT, () => {
  const url = 'http://localhost:' + PORT;
  console.log('韩漫阅读器已启动: ' + url);
  console.log('按 Ctrl+C 停止服务器');
  // Auto-open browser
  const cmd = process.platform === 'win32'
    ? 'start "" "' + url + '"'
    : process.platform === 'darwin'
      ? 'open "' + url + '"'
      : 'xdg-open "' + url + '"';
  exec(cmd, (err) => { if (err) console.log('请手动打开: ' + url); });
});