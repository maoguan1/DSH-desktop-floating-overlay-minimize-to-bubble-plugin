@echo off
chcp 65001 >nul
setlocal ENABLEDELAYEDEXPANSION
title dsh-whale-floating 一键安装

echo ============================================
echo   dsh-whale-floating 一键安装（Windows）
echo   步骤：装插件壳 -^> 打桌面补丁 -^> 重新打包
echo ============================================
echo.

REM ---------- 0. 检测工作目录 ----------
set "PLUGIN_DIR=%CD%"
if not exist "%PLUGIN_DIR%\package.json" (
  echo [错误] 没找到 package.json，请在解压后的 dsh-whale-floating 文件夹里运行本脚本。
  pause
  exit /b 1
)

REM ---------- 1. 检测必需命令 ----------
where git >nul 2>nul || (echo [错误] 未找到 git，请先安装 https://git-scm.com & pause & exit /b 1)
where node >nul 2>nul || (echo [错误] 未找到 node，请先安装 Node.js 20+ & pause & exit /b 1)
where dsh >nul 2>nul || (echo [提示] 未在 PATH 找到 dsh 命令，将跳过插件壳安装，只打桌面补丁。)
echo [ok] git / node 就绪

REM ---------- 2. 输入 dsh-desktop 路径 ----------
set "DESTDIR="
if not "%1"=="" (set "DESTDIR=%1")
if "%DESTDIR%"=="" (
  set /p DESTDIR=请输入 dsh-desktop 项目路径（回车默认用当前目录上一级 .\dsh-desktop）: 
)
if "%DESTDIR%"=="" set "DESTDIR=%PLUGIN_DIR%\..\dsh-desktop"
if not exist "%DESTDIR%\src\main.js" (
  echo [错误] 目标目录里没有 src/main.js，确认路径：%DESTDIR%
  pause
  exit /b 1
)
echo [ok] 目标 dsh-desktop: %DESTDIR%

REM ---------- 3. 安装插件壳（web profile） ----------
dsh plugin --profile web add "%PLUGIN_DIR%" 2>nul
if errorlevel 1 (
  echo [跳过] 插件壳安装未执行（没有 dsh 命令或 profile 未初始化），不影响悬浮窗补丁。
) else (
  echo [ok] 插件壳已安装到 web profile
)

REM ---------- 4. 打桌面补丁 ----------
echo [..] 打桌面补丁（自动备份原 main.js）...
node "%PLUGIN_DIR%\scripts\apply-desktop-patch.js" "%DESTDIR%"
if errorlevel 1 (
  echo [错误] 桌面补丁失败，请查看上方报错。
  pause
  exit /b 1
)
echo [ok] 桌面补丁完成

REM ---------- 5. 重新打包 ----------
echo.
echo [..] 重新打包桌面应用，请稍等（几分钟）...
echo     提示：如果正在运行 DeepSeek Harness，请先退出，否则打包会因文件占用失败。
pause
pushd "%DESTDIR%"
npm run build:win:dir
if errorlevel 1 (
  echo [错误] 打包失败，请检查 dsh-desktop 依赖是否完整（npm install）。
  popd
  pause
  exit /b 1
)
popd
echo.
echo ============================================
echo   安装完成！请到如下目录启动新版本：
echo   %DESTDIR%\release\win-unpacked\DeepSeek Harness Desktop.exe
echo   最小化窗口即可看到桌面鲸鱼悬浮窗。
echo ============================================
pause
