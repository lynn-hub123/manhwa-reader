@echo off
cd /d "%~dp0"
chcp 65001 >nul
title 韩漫阅读器
echo 服务器启动中...
node server.js
pause