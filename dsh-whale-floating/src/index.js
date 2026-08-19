// dsh-whale-floating — host 插件
// 作用：声明并校验 "whale-floating" 设置命名空间；桌面端补丁与设置页共用这份配置。
// 配置存放于 ~/.dsh/settings.yaml 的 whale-floating 节点。
'use strict';

/**
 * 合法配置项与默认值。
 * enabled      - 是否启用悬浮窗（桌面端补丁已就位时生效）
 * image        - 悬浮窗主图文件名（位于 desktop/assets/ 或 dsh-desktop/src/assets/）
 * dockImage    - 贴边小图标文件名
 * size         - 悬浮窗边长（px）
 * dockSize     - 贴边收缩后的边长（px）
 * opacity      - 悬浮窗透明度 0.3~1
 * dockOnEdge   - 拖到屏幕边缘时是否贴边收缩
 * dockGap      - 触发贴边的边缘距离阈值（px）
 * position     - 首次出现的位置：bottom-right | bottom-left | top-right | top-left
 */
const DEFAULTS = Object.freeze({
  enabled: true,
  image: 'whale-girl.png',
  dockImage: 'whale-dock.png',
  size: 148,
  dockSize: 60,
  opacity: 1.0,
  dockOnEdge: true,
  dockGap: 10,
  position: 'bottom-right',
});

/** 宽松校验：返回规范化后的配置（未知键忽略，非法值回退默认）。 */
function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULTS };
  const out = { ...DEFAULTS };
  if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled;
  if (typeof raw.image === 'string' && raw.image.length > 0) out.image = raw.image;
  if (typeof raw.dockImage === 'string' && raw.dockImage.length > 0) out.dockImage = raw.dockImage;
  const size = Number(raw.size);
  if (Number.isFinite(size) && size >= 64 && size <= 512) out.size = Math.round(size);
  const dock = Number(raw.dockSize);
  if (Number.isFinite(dock) && dock >= 24 && dock <= 200) out.dockSize = Math.round(dock);
  const opacity = Number(raw.opacity);
  if (Number.isFinite(opacity)) out.opacity = Math.min(1, Math.max(0.3, opacity));
  if (typeof raw.dockOnEdge === 'boolean') out.dockOnEdge = raw.dockOnEdge;
  const gap = Number(raw.dockGap);
  if (Number.isFinite(gap) && gap >= 0 && gap <= 100) out.dockGap = Math.round(gap);
  if (['bottom-right', 'bottom-left', 'top-right', 'top-left'].includes(raw.position)) out.position = raw.position;
  return out;
}

/** 插件名与配置命名空间。 */
const name = 'whale-floating';
const inject = [];

const Config = {};

/** cordis 插件主入口：注册配置读写服务。 */
function apply(ctx) {
  // 若宿主提供 settings 服务，接入配置读取；否则静默降级（只保留校验函数）。
  let current = { ...DEFAULTS };
  try {
    const settings = ctx.get('settings');
    if (settings && typeof settings.get === 'function') {
      current = normalizeConfig(settings.get('whale-floating') || {});
    }
  } catch {
    /* 未接入 settings 服务时忽略 */
  }

  ctx.provide('whaleFloating.config', () => ({ ...current }));
  ctx.provide('whaleFloating.normalize', (raw) => normalizeConfig(raw));
  ctx.logger?.info?.('[dsh-whale-floating] host 就绪，配置:', JSON.stringify(current));
}

module.exports = { name, inject, Config, DEFAULTS, normalizeConfig, apply };
