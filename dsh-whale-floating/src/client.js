// dsh-whale-floating — client 插件（Web 设置面板）
// 在 dsh 的设置页注册一个“鲸鱼悬浮窗”区块；若宿主设置 UI API 不可用则安全降级。
// 注意：悬浮窗本体由 desktop/ 补丁提供，本面板只负责读写配置。
'use strict';

const name = 'whale-floating';

function apply(ctx) {
  try {
    const settings = ctx.get('settings');
    if (!settings) return;
    const section = settings.section && settings.section('whale-floating');
    if (!section) return;

    section.title('鲸鱼悬浮窗');
    section.intro('桌面端补丁安装后生效：最小化时在桌面显示鲸鱼娘悬浮窗，可拖动、贴边收缩。');

    section.schema({
      enabled: 'boolean',
      image: 'string',
      dockImage: 'string',
      size: 'number',
      dockSize: 'number',
      opacity: 'number',
      dockOnEdge: 'boolean',
      dockGap: 'number',
      position: 'string',
    });

    section.defaults({
      enabled: true,
      image: 'whale-girl.png',
      dockImage: 'whale-dock.png',
      size: 148,
      dockSize: 60,
      opacity: 1,
      dockOnEdge: true,
      dockGap: 10,
      position: 'bottom-right',
    });
  } catch (err) {
    // 宿主 UI API 版本差异时安全降级：不阻断 dsh 本体
    console.warn('[dsh-whale-floating] 设置面板注册失败（可忽略）：', err && err.message || err);
  }
}

module.exports = { name, apply };
