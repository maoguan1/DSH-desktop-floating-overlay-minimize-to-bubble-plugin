# 🐳 dsh-whale-floating

> DeepSeek Harness 桌面鲸鱼悬浮窗插件 —— 最小化后，让一只透明的鲸鱼娘蹲在你桌面上。
> A transparent whale-girl floating window for the DeepSeek Harness desktop shell.

## 功能 / Features

- **最小化到托盘 + 桌面悬浮窗**：点最小化，主窗口收进系统托盘，桌面出现鲸鱼娘悬浮窗
- **悬停放大**：鼠标放上去鲸鱼娘平滑放大 1.10 倍
- **随意拖动**：纯 JS 驱动窗口移动（不会拖出图片副本）
- **贴边收缩**：拖到屏幕边缘自动吸附并收缩成 60×60 的官方小鲸鱼图标；鼠标移上去又展开，移开再收回
- **单击回主窗口**，右键弹出（回主窗口 / 退出）
- **dsh 设置**：作为标准 dsh 插件提供 host + client，可在 dsh 设置页读写配置

## 架构 / How it works

    dsh (web)          ← 本插件的 host + client（配置读写，settings.yaml: whale-floating）
    dsh-desktop        ← desktop/ 补丁（托盘 + 透明置顶悬浮窗，真正的显示层）

- src/index.js       — host 插件：声明并校验 whale-floating 配置命名空间
- src/client.js      — client 插件：在 dsh 设置页注册「鲸鱼悬浮窗」区块（API 不可用时安全降级）
- desktop/           — dsh-desktop (Electron) 需要的全部文件：main.js、floating.html、floating-preload.js、assets/

## 安装 / Install

### 0. 最快路径（Windows）：双击 install.cmd

   下载/克隆本仓库后，进入 dsh-whale-floating 文件夹双击 install.cmd，
   按提示输入 dsh-desktop 项目路径，脚本会自动完成：
   插件壳安装 → 桌面补丁（自动备份）→ 重新打包。完成后重启应用即可。

> 说明：本插件的悬浮窗属于 Electron 主进程能力，dsh 插件机制只管理 web 层，
> 因此"装包"不等于"能用"——必须配合桌面补丁 + 重新打包，见下方步骤。

### 1. 安装插件本体（dsh）

把本仓库放到任意目录，然后在 dsh 的 web profile 里添加：

    # 方式 A：从本地路径安装（推荐先试）
    dsh plugin --profile web add <本仓库绝对路径>

    # 方式 B：从 git 安装（发布后）
    dsh plugin --profile web add https://github.com/<你的用户名>/dsh-whale-floating.git

或直接编辑 ~/.dsh/profiles/web/cordis.patch.yml：

    - id: whale-floating
      name: dsh-whale-floating

> 如果 dsh 的插件 UI 已就绪，也可以在「设置 → 插件」里从目录 / Git 安装。

### 2. 打桌面端补丁（悬浮窗本体）

    # 在插件仓库目录执行；自动备份原 main.js，幂等
    node scripts/apply-desktop-patch.js <dsh-desktop 项目路径>

    # 例如（仓库被放在 dsh 仓库旁的常见布局）：
    node scripts/apply-desktop-patch.js          # 自动找 ../dsh-desktop
    node scripts/apply-desktop-patch.js ../ds-desktop

然后重新打包并运行：

    cd <dsh-desktop 项目路径>
    npm run build:win:dir     # 重新生成 win-unpacked
    # 或 npm run build:win    # 生成安装包

### 3. 主图

仓库自带鲸鱼娘主图（`desktop/assets/whale-girl.png`，504×512 透明背景）。
想换成自己的图，把透明背景 PNG 覆盖为该文件名即可（推荐 512×512 内、透明底），重新打包生效。

> 注意：仓库内的鲸鱼娘图片由仓库作者提供。如果打算公开发布且图片素材含第三方版权，建议在发布前替换为自有素材。

## 配置 / Configuration

~/.dsh/settings.yaml：

    whale-floating:
      enabled: true          # 是否启用（桌面补丁生效时才有意义）
      image: whale-girl.png  # 悬浮窗主图
      dockImage: whale-dock.png   # 贴边小图标
      size: 148              # 悬浮窗边长 px
      dockSize: 60           # 贴边后边长 px
      opacity: 1.0           # 透明度 0.3 ~ 1.0
      dockOnEdge: true       # 是否启用贴边收缩
      dockGap: 10            # 触发贴边的边缘距离 px
      position: bottom-right # 首次出现位置

> 当前补丁固定使用部分取值（size/dockSize/dockGap 已内置），配置项完整接入见 CHANGELOG 的 Roadmap。

## 交互一览 / Interactions

| 操作 | 行为 |
| --- | --- |
| 最小化主窗口 | 主窗口隐藏，托盘 + 桌面悬浮窗出现 |
| 鼠标悬停 | 鲸鱼娘放大 1.10 倍（贴边时展开成大图） |
| 按住拖动 | 悬浮窗跟随鼠标移动 |
| 拖到屏幕边缘 | 自动贴边收缩成小鲸鱼（官方 logo） |
| 贴边后悬停 | 展开成大图；移开收回 |
| 单击鲸鱼 | 恢复主窗口 |
| 右键 | 显示主窗口 / 退出 |
| 单击托盘 | 恢复主窗口 |

## 开发 / Development

    node scripts/verify.js                    # 自检：包结构/语法/声明
    node scripts/apply-desktop-patch.js ...   # 打桌面补丁

## Roadmap

- [ ] 桌面补丁读取 whale-floating 配置（size/dockSize/opacity/position 全接入）
- [ ] 设置页 UI 打磨（跟随 dsh client API 稳定后）
- [ ] 多屏 / 多显示器贴边
- [ ] 开机自启悬浮窗（不启动主窗口）

## 协议 / License

MIT © dsh-whale-floating contributors

> 素材说明：whale-dock.png 由 DeepSeek 官方公开的 favicon（chat.deepseek.com）渲染而成；whale-girl.png / whale-girl-small.png 为仓库自带主图（见上文替换说明）。