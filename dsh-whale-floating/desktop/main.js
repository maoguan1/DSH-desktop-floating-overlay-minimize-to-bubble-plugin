// dsh-desktop — DeepSeek Harness 桌面端主进程
// 职责：解析 dsh CLI 位置 → 确定工作区（首次启动弹窗选择，菜单可随时更换）→
//       以子进程拉起 dsh web（指定端口）→ 就绪后用窗口加载其 Web UI →
//       窗口关闭/退出时清理子进程。
const { app, BrowserWindow, dialog, Menu, Tray, nativeImage, screen, ipcMain } = require('electron');
const { spawn, execFileSync } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_NAME = 'DeepSeek Harness Desktop';
const DEFAULT_PORT = 3170;
const PORT_ATTEMPTS = 10;            // 端口占用时最多向后尝试的次数
// 首次启动时 dsh 会初始化 profile（在 profile 目录内安装插件依赖），可能耗时数分钟，
// 因此就绪超时要给足；可用环境变量 DSH_DESKTOP_BOOT_TIMEOUT 覆盖（毫秒）。
const BOOT_TIMEOUT_MS = Number(process.env.DSH_DESKTOP_BOOT_TIMEOUT) || 180_000;

// ---------- 命令行参数 ----------
const argv = process.argv.slice(process.defaultApp ? 2 : 1);
const isSmoke = argv.includes('--smoke');
const portArgIdx = argv.indexOf('--port');
const basePort = portArgIdx >= 0 ? Number(argv[portArgIdx + 1]) || DEFAULT_PORT : DEFAULT_PORT;

// ---------- 工作区（= 沙箱可写根，可任意盘符） ----------
let currentWorkspace = null;
let mainWindow = null;
let trayIcon = null;
let floatingWindow = null;
// ---- 悬浮窗贴边 dock 状态 ----
const FLOATING_SIZE = 148;
const FLOATING_DOCK_SIZE = 60;
const FLOATING_DOCK_GAP = 10;
let floatingDocked = false;
let floatingDockEdge = null;   // 'left' | 'right' | 'top' | 'bottom'
let floatingDockAnchor = null; // { x, y }
let floatingDockTimer = null;
let floatingDragOffset = null; // { dx, dy } 抓取点相对窗口左上角的偏移

function workspaceStorePath() {
  return path.join(app.getPath('userData'), 'workspace.json');
}

function loadSavedWorkspace() {
  try {
    const data = JSON.parse(fs.readFileSync(workspaceStorePath(), 'utf8'));
    if (typeof data.workspace === 'string' && data.workspace.length > 0) return data.workspace;
  } catch { /* 无存档或损坏，忽略 */ }
  return null;
}

function saveWorkspace(ws) {
  try {
    fs.mkdirSync(path.dirname(workspaceStorePath()), { recursive: true });
    fs.writeFileSync(workspaceStorePath(), JSON.stringify({ workspace: ws }, null, 2), 'utf8');
  } catch (err) {
    console.error('[dsh-desktop] 保存工作区配置失败:', err);
  }
}

function desktopOrHome() {
  const desktop = path.join(os.homedir(), 'Desktop');
  return fs.existsSync(desktop) ? desktop : os.homedir();
}

/**
 * 解析初始工作区（优先级）：
 * 1) 环境变量 DSH_DESKTOP_WORKSPACE；
 * 2) 上次保存的配置（workspace.json）；
 * 3) 首次启动：弹窗让用户选择任意文件夹（D:/E: 等任意盘符均可），并保存；
 * 4) 用户取消或自检模式下：回退到桌面（不可用则主目录）。
 */
async function resolveWorkspaceInitial() {
  const envWs = process.env.DSH_DESKTOP_WORKSPACE;
  if (envWs) return envWs;
  const saved = loadSavedWorkspace();
  if (saved && fs.existsSync(saved)) return saved;
  if (!isSmoke) {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: `选择工作区文件夹（${APP_NAME}）`,
        buttonLabel: '选为工作区',
        defaultPath: desktopOrHome(),
        properties: ['openDirectory', 'createDirectory'],
      });
      if (!canceled && filePaths && filePaths[0]) {
        saveWorkspace(filePaths[0]);
        return filePaths[0];
      }
    } catch (err) {
      console.error('[dsh-desktop] 工作区选择对话框失败:', err);
    }
  }
  return desktopOrHome();
}

// ---------- 解析 dsh CLI ----------
function resolveNode() {
  // 在 Electron 主进程里 process.execPath 是 electron.exe，必须用真正的 node.exe
  return process.env.DSH_DESKTOP_NODE || 'node';
}

/** 打包进应用资源的 dsh 运行时目录（node.exe + dsh 包），未打包时为 null。 */
function bundledRuntime() {
  const root = path.join(process.resourcesPath, 'runtime');
  const node = path.join(root, 'node.exe');
  const bin = path.join(root, 'dsh', 'lib', 'bin.js');
  return fs.existsSync(node) && fs.existsSync(bin) ? { node, bin } : null;
}

function resolveDshLauncher() {
  // 1) 显式指定（最优先）：DSH_DESKTOP_DSH_BIN 指向 @deepseek-ai/dsh/lib/bin.js
  const explicit = process.env.DSH_DESKTOP_DSH_BIN;
  if (explicit && fs.existsSync(explicit)) {
    return { cmd: resolveNode(), args: [explicit], shell: false };
  }
  // 2) 打包进应用的运行时（完全自包含，无需全局安装 dsh/node）
  const bundled = bundledRuntime();
  if (bundled) {
    return { cmd: bundled.node, args: [bundled.bin], shell: false };
  }
  // 3) 通过 npm 全局根目录定位
  try {
    const npmRoot = execFileSync('npm', ['root', '-g'], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    const bin = path.join(npmRoot, '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    if (fs.existsSync(bin)) {
      return { cmd: resolveNode(), args: [bin], shell: false };
    }
  } catch {
    /* 忽略，走 PATH 兜底 */
  }
  // 4) PATH 兜底（Windows 下 dsh.cmd 需要 shell）
  return { cmd: 'dsh', args: [], shell: process.platform === 'win32' };
}

function spawnDsh(port) {
  const launcher = resolveDshLauncher();
  const args = [...launcher.args, '--profile', 'web', '--port', String(port)];
  const workspace = currentWorkspace;
  try {
    fs.mkdirSync(workspace, { recursive: true });
  } catch { /* 目录已存在或不可创建时交由 dsh 报错 */ }
  console.log(`[dsh-desktop] 启动 dsh web: ${launcher.cmd} ${args.join(' ')} (端口 ${port}, 工作区 ${workspace})`);
  const child = spawn(launcher.cmd, args, {
    cwd: workspace,
    env: {
      ...process.env,
      // 与 web profile 的 sandbox-policy patch 联动：
      // 沙箱保持 workspace-write，工作区根固定为 workspace（任意盘符均可），写入直接落盘
      DSH_WORKSPACE: workspace,
      DSH_PERMISSION_MODE: process.env.DSH_PERMISSION_MODE || 'workspace-write',
    },
    stdio: 'inherit', // 直接继承控制台输出；打包为 GUI 时无控制台则自动丢弃
    windowsHide: true,
    shell: launcher.shell,
  });
  child.on('error', (err) => {
    console.error('[dsh-desktop] 子进程启动失败:', err);
  });
  return child;
}

// ---------- 等待服务就绪 ----------
function waitForServer(port, timeoutMs) {
  const url = `http://127.0.0.1:${port}`;
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => {
        if (Date.now() > deadline) return resolve(false);
        setTimeout(tick, 400);
      });
      req.setTimeout(1500, () => req.destroy());
    };
    tick();
  });
}

// ---------- 启动 dsh web（含端口回退） ----------
async function bootDshWeb() {
  let lastErr = null;
  for (let i = 0; i < PORT_ATTEMPTS; i++) {
    const port = basePort + i;
    const child = spawnDsh(port);
    const exited = new Promise((resolve) =>
      child.once('exit', (code, sig) => resolve(`exit=${code}${sig ? '/' + sig : ''}`)));
    const ready = waitForServer(port, BOOT_TIMEOUT_MS).then((ok) => (ok ? 'ready' : 'timeout'));

    const outcome = await Promise.race([ready, exited]);
    if (outcome === 'ready') return { port, child };

    lastErr = outcome;
    console.error(`[dsh-desktop] 端口 ${port} 未就绪（${outcome}），清理后尝试下一个端口`);
    child.kill();
    // 等子进程真正退出再尝试下一个端口，避免两个 dsh 并发初始化同一 profile 目录
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once('exit', resolve);
    });
  }
  throw new Error(`在 ${PORT_ATTEMPTS} 个端口上均未能启动 dsh web（最后错误: ${lastErr}）。` +
    '请确认 dsh CLI 可用且 DSH_HOME 配置正确。');
}

let childProc = null;
let quitting = false;
let restarting = false;

// Windows 下整树终止（dsh 会派生 pnpm 等子进程，只 kill 直接子进程会留孤儿）
function killTree(pid) {
  if (!pid) return;
  try {
    execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch {
    /* 进程已退出，忽略 */
  }
}

function cleanupChild() {
  if (childProc) killTree(childProc.pid);
  childProc = null;
}

function attachChildExitHandler(child) {
  child.on('exit', (code) => {
    console.error(`[dsh-desktop] dsh web 进程退出 (code=${code})`);
    if (!quitting && !restarting && !isSmoke) {
      dialog.showErrorBox(APP_NAME,
        `dsh web 进程意外退出 (code=${code})，应用即将关闭。`);
      app.quit();
    }
  });
}

function showBootError(err) {
  const win = new BrowserWindow({
    width: 720,
    height: 420,
    title: APP_NAME,
    autoHideMenuBar: true,
  });
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    `<!doctype html><html><head><meta charset="utf-8"><title>${APP_NAME} - 启动失败</title></head>
     <body style="font-family:system-ui;padding:32px;line-height:1.7">
       <h2>无法启动 DeepSeek Harness</h2>
       <pre style="background:#f5f5f5;padding:12px;border-radius:8px;white-space:pre-wrap">${String(err.message || err)}</pre>
       <p>请确认：<br>1. 磁盘空间充足<br>
       2. 工作区目录存在且可写<br>
       3. 网络可用（首次初始化需联网）</p>
     </body></html>`));
}

function createMainWindow(port) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: `${APP_NAME} — ${currentWorkspace}`,
    autoHideMenuBar: true,
    backgroundColor: '#0f1115',
    show: !isSmoke,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  mainWindow = win;

  win.loadURL(`http://127.0.0.1:${port}`);
  win.on('page-title-updated', (e) => e.preventDefault()); // 保持统一标题

  if (isSmoke) {
    win.webContents.once('did-finish-load', () => {
      console.log(`SMOKE_OK http://127.0.0.1:${port}`);
      // 强制退出：整树终止 dsh 子进程，再 process.exit 立即结束，
      // 避免任何残留句柄/子进程让进程或调用方管道无法收尾
      setTimeout(() => {
        cleanupChild();
        try {
          execFileSync('taskkill', ['/pid', String(process.pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
          });
        } catch { /* ignore */ }
        process.exit(0);
      }, 1200);
    });
    win.webContents.once('did-fail-load', (_e, code, desc) => {
      console.error(`SMOKE_FAIL load error: ${code} ${desc}`);
      cleanupChild();
      process.exit(1);
    });
  }

  // 缩小到系统托盘：隐藏主窗口并显示鲸鱼悬浮窗
  win.on('minimize', (e) => {
    if (isSmoke) return;
    e.preventDefault();
    win.hide();
    showFloatingWindow();
  });

  win.on('closed', () => {
    mainWindow = null;
    cleanupChild();
    if (!isSmoke) app.quit();
  });
  return win;
}

// ---------- 更换工作区（菜单） ----------
async function changeWorkspace() {
  if (!mainWindow || isSmoke) return;
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '选择新的工作区文件夹（任意盘符均可，如 D:\项目、E:\代码）',
    buttonLabel: '选为工作区并重启',
    defaultPath: currentWorkspace || desktopOrHome(),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths || !filePaths[0]) return;
  const next = filePaths[0];
  saveWorkspace(next);
  currentWorkspace = next;
  restartBackend();
}

async function restartBackend() {
  restarting = true;
  cleanupChild();
  await new Promise((r) => setTimeout(r, 1000)); // 等旧进程完全释放端口
  try {
    const { port, child } = await bootDshWeb();
    childProc = child;
    attachChildExitHandler(child);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(`http://127.0.0.1:${port}`);
      mainWindow.setTitle(`${APP_NAME} — ${currentWorkspace}`);
    }
  } catch (err) {
    console.error('[dsh-desktop] 更换工作区后重启失败:', err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox(APP_NAME, `更换工作区后无法启动 dsh web：${err.message}`);
    }
  } finally {
    restarting = false;
  }
}

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '更换工作区…', accelerator: 'Ctrl+Shift+O', click: changeWorkspace },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    { label: '编辑', role: 'editMenu' },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- 系统托盘 + 桌面鲸鱼悬浮窗 ----------
function assetPath(...names) {
  return path.join(__dirname, 'assets', ...names);
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  hideFloatingWindow();
}

function hideFloatingWindow() {
  if (floatingWindow && !floatingWindow.isDestroyed()) floatingWindow.hide();
}

function positionFloatingWindow(win) {
  try {
    const { workArea } = screen.getPrimaryDisplay();
    const [w, h] = win.getSize();
    win.setPosition(workArea.x + workArea.width - w - 24, workArea.y + workArea.height - h - 24);
  } catch { /* 多屏/异常时保持默认位置 */ }
}

function showFloatingWindow() {
  if (isSmoke) return;
  if (!floatingWindow || floatingWindow.isDestroyed()) createFloatingWindow();
  if (!floatingWindow.isVisible()) {
    if (!floatingDocked) positionFloatingWindow(floatingWindow);
    floatingWindow.showInactive(); // 不抢焦点，安静地蹲在桌面上
  }
}

function floatingClosestEdge(win) {
  const b = win.getBounds();
  const { workArea } = screen.getPrimaryDisplay();
  const candidates = [
    { edge: 'left',   dist: b.x - workArea.x },
    { edge: 'right',  dist: workArea.x + workArea.width - (b.x + b.width) },
    { edge: 'top',    dist: b.y - workArea.y },
    { edge: 'bottom', dist: workArea.y + workArea.height - (b.y + b.height) },
  ];
  let best = null;
  for (const c of candidates) {
    if (c.dist > FLOATING_DOCK_GAP) continue;
    if (!best || c.dist < best.dist) best = c;
  }
  return best;
}

function floatingDockPosition(edge, size, anchor) {
  const { workArea } = screen.getPrimaryDisplay();
  let x = anchor ? anchor.x : workArea.x;
  let y = anchor ? anchor.y : workArea.y;
  if (edge === 'left') x = workArea.x;
  else if (edge === 'right') x = workArea.x + workArea.width - size;
  else if (edge === 'top') y = workArea.y;
  else if (edge === 'bottom') y = workArea.y + workArea.height - size;
  if (edge === 'left' || edge === 'right') {
    y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - size));
  } else {
    x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - size));
  }
  return { x, y };
}

function dockFloating(win, edge) {
  const anchor = floatingDockPosition(edge, FLOATING_DOCK_SIZE, win.getBounds());
  floatingDocked = true;
  floatingDockEdge = edge;
  floatingDockAnchor = anchor;
  win.setBounds({ x: anchor.x, y: anchor.y, width: FLOATING_DOCK_SIZE, height: FLOATING_DOCK_SIZE }, false);
  try { win.webContents.send('floating:dock', true); } catch { /* 页面未就绪时忽略 */ }
}

function undockFloating(win) {
  floatingDocked = false;
  floatingDockEdge = null;
  floatingDockAnchor = null;
  try { win.webContents.send('floating:dock', false); } catch { /* 页面未就绪时忽略 */ }
}

function checkFloatingDock(win) {
  if (isSmoke || !win || win.isDestroyed() || !win.isVisible()) return;
  if (floatingDocked) {
    const b = win.getBounds();
    const anchor = floatingDockAnchor;
    if (anchor && (Math.abs(b.x - anchor.x) > 14 || Math.abs(b.y - anchor.y) > 14)) undockFloating(win);
    return;
  }
  const hit = floatingClosestEdge(win);
  if (hit) dockFloating(win, hit.edge);
}

function expandFloatingFromDock() {
  const win = floatingWindow;
  if (!win || win.isDestroyed() || !floatingDocked) return;
  const edge = floatingDockEdge || 'left';
  const pos = floatingDockPosition(edge, FLOATING_SIZE, floatingDockAnchor);
  win.setBounds({ x: pos.x, y: pos.y, width: FLOATING_SIZE, height: FLOATING_SIZE }, false);
  try { win.webContents.send('floating:dock', false); } catch { /* 页面未就绪时忽略 */ }
}

function retractFloatingToDock() {
  const win = floatingWindow;
  if (!win || win.isDestroyed() || !floatingDocked) return;
  const pos = floatingDockAnchor || { x: 0, y: 0 };
  win.setBounds({ x: pos.x, y: pos.y, width: FLOATING_DOCK_SIZE, height: FLOATING_DOCK_SIZE }, false);
  try { win.webContents.send('floating:dock', true); } catch { /* 页面未就绪时忽略 */ }
}

function createFloatingWindow() {
  const win = new BrowserWindow({
    width: FLOATING_SIZE,
    height: FLOATING_SIZE,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'floating-preload.js'),
    },
  });
  floatingWindow = win;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'floating.html'));
  win.on('closed', () => { floatingWindow = null; });
  win.on('context-menu', () => {
    Menu.buildFromTemplate([
      { label: '回到 DeepSeek Harness', click: showMainWindow },
      { type: 'separator' },
      { label: '退出', click: () => { quitting = true; cleanupChild(); app.quit(); } },
    ]).popup({ window: win });
  });
  // 拖动中的贴边判定（debounce，避免 move 风暴）
  win.on('move', () => {
    clearTimeout(floatingDockTimer);
    floatingDockTimer = setTimeout(() => checkFloatingDock(win), 90);
  });
  // 页面就绪后同步 dock 形态
  win.webContents.on('did-finish-load', () => {
    try { win.webContents.send('floating:dock', floatingDocked); } catch { /* ignore */ }
  });
  return win;
}

function createTray() {
  let icon = null;
  try {
    icon = nativeImage.createFromPath(assetPath('whale-180.png'));
    if (!icon.isEmpty()) icon = icon.resize({ width: 16, height: 16 });
  } catch { /* 图标缺失时用空图标，不阻断启动 */ }
  if (!icon || icon.isEmpty()) icon = nativeImage.createEmpty();

  const tray = new Tray(icon);
  tray.setToolTip(APP_NAME + ' — ' + currentWorkspace + '\n右键菜单：显示 / 退出');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: showMainWindow },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; cleanupChild(); app.quit(); } },
  ]));
  tray.on('click', showMainWindow); // Windows 单击托盘恢复
  trayIcon = tray;
}

ipcMain.on('floating:restore', showMainWindow);
ipcMain.on('floating:hover', (_e, active) => {
  if (active) expandFloatingFromDock();
  else retractFloatingToDock();
});

// JS 驱动悬浮窗拖动（不用系统拖拽区，避免图片被拖到桌面复制）
ipcMain.on('floating:drag-start', (_e, sx, sy) => {
  if (!floatingWindow || floatingWindow.isDestroyed()) return;
  const [wx, wy] = floatingWindow.getPosition();
  floatingDragOffset = { dx: wx - sx, dy: wy - sy };
});

ipcMain.on('floating:drag-move', (_e, sx, sy) => {
  if (!floatingWindow || floatingWindow.isDestroyed() || !floatingDragOffset) return;
  floatingWindow.setPosition(
    Math.round(sx + floatingDragOffset.dx),
    Math.round(sy + floatingDragOffset.dy)
  );
  // setPosition 会触发 'move' → checkFloatingDock 的 debounce 会自动处理贴边/脱离
});

ipcMain.on('floating:drag-end', () => {
  floatingDragOffset = null;
});

// ---------- 应用生命周期 ----------
// 允许用环境变量覆盖 userData（便携模式 / 隔离自检），须在 ready 之前设置
if (process.env.DSH_DESKTOP_USER_DATA) {
  app.setPath('userData', process.env.DSH_DESKTOP_USER_DATA);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) showMainWindow();
  });

  app.whenReady().then(async () => {
    try {
      currentWorkspace = await resolveWorkspaceInitial();
      buildMenu();
      const { port, child } = await bootDshWeb();
      childProc = child;
      attachChildExitHandler(child);
      createMainWindow(port);
      if (!isSmoke) createTray();
    } catch (err) {
      console.error('[dsh-desktop] 启动失败:', err);
      if (isSmoke) { console.error('SMOKE_FAIL ' + err.message); process.exit(1); return; }
      showBootError(err);
    }
  });

  app.on('before-quit', () => {
    quitting = true;
    cleanupChild();
    if (floatingWindow && !floatingWindow.isDestroyed()) floatingWindow.destroy();
    floatingWindow = null;
    if (trayIcon) { trayIcon.destroy(); trayIcon = null; }
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
