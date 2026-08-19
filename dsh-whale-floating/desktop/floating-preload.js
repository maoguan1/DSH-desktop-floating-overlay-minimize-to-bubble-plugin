// 桌面鲸鱼悬浮窗 preload：恢复主窗口、JS 拖动、悬停通知、贴边形态切换。
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('floating', {
  restore: () => ipcRenderer.send('floating:restore'),
  hover: (active) => ipcRenderer.send('floating:hover', active),
  dragStart: (x, y) => ipcRenderer.send('floating:drag-start', x, y),
  dragMove: (x, y) => ipcRenderer.send('floating:drag-move', x, y),
  dragEnd: () => ipcRenderer.send('floating:drag-end'),
  onDock: (cb) => ipcRenderer.on('floating:dock', (_e, v) => cb(v)),
});