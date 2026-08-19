# Changelog

## [1.0.0] - 2026-08-19

### Added

- 仓库默认携带鲸鱼娘主图（whale-girl.png / whale-girl-small.png，504×512 透明背景）
- 桌面悬浮窗：透明置顶、纯 JS 拖动、悬停放大、贴边收缩成官方小鲸鱼
- 系统托盘集成与最小化隐藏
- dsh 插件壳：host 配置服务 + client 设置页（保守实现，API 不匹配时安全降级）
- 一键桌面补丁脚本（scripts/apply-desktop-patch.js，备份 + 幂等）
- 自检脚本（scripts/verify.js）
- MIT 协议、README、示例配置

### Roadmap

- 桌面补丁全面读取 whale-floating 配置（size/dockSize/opacity/position）
- 多显示器贴边
- 纯悬浮窗模式（不启动主窗口）
