#!/usr/bin/env node
// dsh-whale-floating — 一键把桌面悬浮窗补丁应用到 dsh-desktop
// 用法:
//   node scripts/apply-desktop-patch.js [dsh-desktop 项目路径]
// 默认目标: 与本插件平级的 dsh-desktop 目录
// 流程: 备份原 main.js -> 锚点合并 -> 注入悬浮窗实现块 -> 拷贝 floating.html / floating-preload.js / assets
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;
const PLUGIN_ROOT = path.resolve(HERE, '..');
const DESKTOP_DIR = path.join(PLUGIN_ROOT, 'desktop');
const MARKER = 'DESKTOP_WHALE_FLOATING_V1';

const IMPL_START = '// ---------- 系统托盘 + 桌面鲸鱼悬浮窗 ----------';
const IMPL_END = '// ---------- 应用生命周期 ----------';

function fail(msg) {
  console.error('[dsh-whale-floating] x ' + msg);
  process.exit(1);
}

function resolveTarget() {
  const arg = process.argv[2];
  if (arg) return path.resolve(arg);
  const sibling = path.resolve(PLUGIN_ROOT, '..', 'dsh-desktop');
  if (fs.existsSync(path.join(sibling, 'src', 'main.js'))) return sibling;
  fail('未找到 dsh-desktop。请显式传入路径：node scripts/apply-desktop-patch.js <dsh-desktop 目录>');
}

/** 从 desktop/main.js（已验证的完整实现）截取悬浮窗实现块。 */
function extractImplementation() {
  const full = fs.readFileSync(path.join(DESKTOP_DIR, 'main.js'), 'utf8');
  const s = full.indexOf(IMPL_START);
  const e = full.indexOf(IMPL_END);
  if (s < 0 || e < 0 || e <= s) fail('desktop/main.js 中找不到实现锚点');
  return full.slice(s, e) + '\n';
}

function main() {
  const target = resolveTarget();
  const mainPath = path.join(target, 'src', 'main.js');
  if (!fs.existsSync(mainPath)) fail('目标缺少 src/main.js: ' + mainPath);

  let source = fs.readFileSync(mainPath, 'utf8');
  if (source.includes(MARKER)) {
    console.log('[dsh-whale-floating] ok 已检测到补丁标记，跳过（幂等）。如需重打请先还原备份。');
    process.exit(0);
  }

  // 1) 备份
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(target, 'src', 'main.js.whale-' + stamp + '.bak');
  fs.writeFileSync(backupPath, source, 'utf8');
  console.log('[dsh-whale-floating] ok 已备份原 main.js ->', backupPath);

  // 2) 锚点替换（每处必须恰好匹配 1 次）
  const edits = [
    {
      id: 'require',
      old: "const { app, BrowserWindow, dialog, Menu } = require('electron');",
      new: "const { app, BrowserWindow, dialog, Menu, Tray, nativeImage, screen, ipcMain } = require('electron');",
    },
    {
      id: 'state',
      old: 'let currentWorkspace = null;\nlet mainWindow = null;',
      new: 'let currentWorkspace = null;\nlet mainWindow = null;\n// ' + MARKER + '\nlet trayIcon = null;\nlet floatingWindow = null;\nconst FLOATING_SIZE = 148;\nconst FLOATING_DOCK_SIZE = 60;\nconst FLOATING_DOCK_GAP = 10;\nlet floatingDocked = false;\nlet floatingDockEdge = null;\nlet floatingDockAnchor = null;\nlet floatingDockTimer = null;\nlet floatingDragOffset = null;',
    },
    {
      id: 'minimize',
      old: "  win.on('closed', () => {\n    mainWindow = null;\n    cleanupChild();\n    if (!isSmoke) app.quit();\n  });",
      new: "  // " + MARKER + " 缩小到系统托盘：隐藏主窗口并显示鲸鱼悬浮窗\n  win.on('minimize', (e) => {\n    if (isSmoke) return;\n    e.preventDefault();\n    win.hide();\n    showFloatingWindow();\n  });\n\n  win.on('closed', () => {\n    mainWindow = null;\n    cleanupChild();\n    if (!isSmoke) app.quit();\n  });",
    },
    {
      id: 'createTray-call',
      old: '      createMainWindow(port);\n    } catch (err) {',
      new: '      createMainWindow(port);\n      if (!isSmoke) createTray();\n    } catch (err) {',
    },
    {
      id: 'second-instance',
      old: "  app.on('second-instance', () => {\n    if (mainWindow) {\n      if (mainWindow.isMinimized()) mainWindow.restore();\n      mainWindow.focus();\n    }\n  });",
      new: "  app.on('second-instance', () => {\n    if (mainWindow) showMainWindow();\n  });",
    },
    {
      id: 'before-quit',
      old: "  app.on('before-quit', () => { quitting = true; cleanupChild(); });",
      new: "  app.on('before-quit', () => {\n    quitting = true;\n    cleanupChild();\n    if (floatingWindow && !floatingWindow.isDestroyed()) floatingWindow.destroy();\n    floatingWindow = null;\n    if (trayIcon) { trayIcon.destroy(); trayIcon = null; }\n  });",
    },
  ];

  for (const e of edits) {
    const count = source.split(e.old).length - 1;
    if (count !== 1) {
      fail('锚点 "' + e.id + '" 匹配 ' + count + ' 次（应为 1）。你的 dsh-desktop 版本可能不同，请手动合并 desktop/main.js。备份：' + backupPath);
    }
    source = source.split(e.old).join(e.new);
  }

  // 3) 在生命周期标记前插入实现块
  const idx = source.indexOf(IMPL_END);
  if (idx < 0) fail('找不到生命周期标记，无法插入悬浮窗实现（备份：' + backupPath + '）');
  const impl = extractImplementation();
  source = source.slice(0, idx) + impl + source.slice(idx);

  // 4) 写入
  fs.writeFileSync(mainPath, source, 'utf8');

  // 5) 拷贝附属文件（不覆盖用户已有的主图）
  const copyDst = path.join(target, 'src');
  fs.mkdirSync(path.join(copyDst, 'assets'), { recursive: true });
  for (const f of ['floating.html', 'floating-preload.js']) {
    fs.copyFileSync(path.join(DESKTOP_DIR, f), path.join(copyDst, f));
  }
  for (const f of ['whale-dock.png', 'whale-512.png', 'whale-180.png']) {
    const dest = path.join(copyDst, 'assets', f);
    if (!fs.existsSync(dest)) fs.copyFileSync(path.join(DESKTOP_DIR, 'assets', f), dest);
  }

  console.log('[dsh-whale-floating] ok 补丁完成。');
  console.log('[dsh-whale-floating]   1) 可选：复制你的鲸鱼娘图到 ' + path.join(copyDst, 'assets', 'whale-girl.png'));
  console.log('[dsh-whale-floating]   2) 重新打包 dsh-desktop：npm run build:win:dir');
  console.log('[dsh-whale-floating]   3) 重启应用。详见 README.md');
}

main();
