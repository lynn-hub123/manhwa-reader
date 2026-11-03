@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."

echo ========================================
echo   韩漫阅读器 · 手机一键更新
echo   不卸载、不清数据、不手动传文件
echo ========================================
echo.

rem --- 定位 JDK 与 Android SDK ---
if exist ".jdk21\jdk-21.0.12.1+1\bin\java.exe" set "JAVA_HOME=%cd%\.jdk21\jdk-21.0.12.1+1"
if "%JAVA_HOME%"=="" if exist "%ProgramFiles%\Java" for /d %%d in ("%ProgramFiles%\Java\jdk*") do set "JAVA_HOME=%%~fd"
if "%ANDROID_HOME%"=="" if exist "F:\Sdk\platform-tools\adb.exe" set "ANDROID_HOME=F:\Sdk"
if "%ANDROID_HOME%"=="" if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"

if "%JAVA_HOME%"=="" (
  echo [错误] 没找到 JDK，请把 JDK 放到 .jdk21 目录，或设置 JAVA_HOME。
  pause
  exit /b 1
)
if "%ANDROID_HOME%"=="" (
  echo [错误] 没找到 Android SDK，请设置 ANDROID_HOME。
  pause
  exit /b 1
)
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%"

rem --- 检查手机 ---
adb get-state >nul 2>&1
if errorlevel 1 (
  echo [错误] 没检测到已授权手机。请插 USB、开「USB 调试」，并在手机上点「允许」。
  pause
  exit /b 1
)
for /f "tokens=2" %%m in ('adb shell getprop ro.product.model 2^>nul') do set "MODEL=%%m"
echo 已连接设备: %MODEL%
echo.

echo [1/4] 同步前端资源...
call npm run sync:www >nul || goto :fail

echo [2/4] 写入新版本号（让 Service Worker 丢弃旧缓存）...
node tools\build-stamp.js || goto :fail

echo [3/4] 同步到 Android 工程...
call npx cap sync android >nul || goto :fail

echo [4/4] 编译并覆盖安装（保留书架数据）...
pushd android
call gradlew.bat installDebug
set "GRADLE_EXIT=%errorlevel%"
popd
if not "%GRADLE_EXIT%"=="0" goto :fail

echo.
echo ✓ 完成。手机上直接打开「韩漫阅读器」即可，书架和已导入的漫画都还在。
echo.
pause
exit /b 0

:fail
echo.
echo ✗ 失败了，把上面的报错发给我。
pause
exit /b 1
