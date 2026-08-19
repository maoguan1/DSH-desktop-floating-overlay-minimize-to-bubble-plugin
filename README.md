dsh-whale-floating 简介与使用方法
简介
dsh-whale-floating 是一款给 DeepSeek Harness Desktop（dsh 桌面端）用的桌面鲸鱼悬浮窗插件。

当你把主窗口最小化时，它会像一只宠物一样蹲在你的桌面上：一只透明的鲸鱼娘悬浮窗出现在屏幕角落，可以随意拖动、悬停放大，拖到屏幕边缘还会自动收缩成一只小小的官方 DeepSeek 鲸鱼图标贴在边上，鼠标一碰又展开——单击它，主窗口就回来了。

简单说：让 dsh 最小化后不再消失，而是留下一条可爱的小鲸鱼陪你。

功能特性
最小化主窗口后，自动收进系统托盘，并在桌面显示鲸鱼娘悬浮窗
纯 JS 驱动拖动：按住鲸鱼娘随意移动，不会误触成"复制图片"
悬停平滑放大 1.10 倍
拖到屏幕边缘自动贴边，收缩成 60×60 的官方小鲸鱼图标
贴边后鼠标移上会展开成大图，移开自动收回
单击鲸鱼娘 / 单击托盘图标：恢复主窗口
右键悬浮窗：显示主窗口 / 退出
插件本体带 host + client：可接入 dsh 配置体系（settings.yaml 的 whale-floating 节点）
完全透明背景，悬浮窗直接透出桌面，仅一层淡淡的投影
运行环境
项目	要求
系统	Windows 10/11
软件	Git、Node.js 20+、dsh 命令行（可选，仅装设置壳时需要）
目标	dsh-desktop 项目源码目录（含 src/main.js）
说明：悬浮窗属于 Electron 主进程能力，dsh 的插件机制只管理 web 层，所以本插件需要"插件壳 + 桌面补丁"两步安装，不能从插件市场一键装完就用——install.cmd 已把两步合成一步。

安装方法（三选一）
方式一：双击一键安装（推荐）
下载 / 克隆本仓库，进入 dsh-whale-floating 文件夹
双击 install.cmd
按提示输入 dsh-desktop 项目路径（回车默认取上一级的 dsh-desktop）
脚本自动完成：插件壳安装 → 桌面补丁（自动备份原 main.js）→ 重新打包
安装完成后，启动 release/win-unpacked/DeepSeek Harness Desktop.exe
方式二：手动分步安装
在插件目录执行：

复制
dsh plugin --profile web add <本仓库路径>              # 1. 安装插件壳（可跳过）
node scripts/apply-desktop-patch.js <dsh-desktop路径>  # 2. 打桌面补丁
cd <dsh-desktop路径> && npm run build:win:dir          # 3. 重新打包
方式三：已有打包环境，只打补丁
复制
node scripts/apply-desktop-patch.js <dsh-desktop路径>
打补丁脚本是幂等的：重复执行会自动跳过；每次执行前都会把原 main.js 备份为 src/main.js.whale-<时间戳>.bak。

配置（可选）
编辑 ~/.dsh/settings.yaml，追加：

复制
whale-floating:
  enabled: true            # 是否启用（默认 true）
  image: whale-girl.png    # 悬浮窗主图文件名
  dockImage: whale-dock.png # 贴边小图标文件名
  size: 148                # 悬浮窗边长 px
  dockSize: 60             # 贴边后边长 px
  opacity: 1.0             # 透明度 0.3 ~ 1.0
  dockOnEdge: true         # 是否启用贴边收缩
  dockGap: 10              # 触发贴边的边缘距离 px
  position: bottom-right   # 首次出现位置
使用方法
基础操作
操作	效果
点击主窗口最小化	主窗口隐藏，托盘 + 桌面悬浮窗出现
鼠标放到鲸鱼娘上	放大到 1.10 倍，有投影加深效果
按住鲸鱼娘拖动	悬浮窗跟着鼠标移动
拖到屏幕边缘附近（10px 内）	自动吸附贴边，收缩成 60×60 小鲸鱼
贴边后鼠标移上去	展开成大图（从边缘弹出）
贴边后鼠标移开	收回小鲸鱼
单击鲸鱼娘 / 小鲸鱼	恢复主窗口
右键悬浮窗	菜单：回到主窗口 / 退出
单击系统托盘鲸鱼图标	恢复主窗口
右键托盘图标	菜单：显示主窗口 / 退出
更换主图
想换自己的鲸鱼娘立绘：

准备一张透明背景 PNG（推荐 512×512 以内）
覆盖为 dsh-desktop 的 src/assets/whale-girl.png
重新打包：cd <dsh-desktop> && npm run build:win:dir
重启应用
常见问题
Q1：最小化后没出现悬浮窗？ 检查是否真的重启了新打包的应用（旧进程没退干净时，再次启动只是唤醒旧实例）。彻底退出：托盘右键退出，或任务管理器结束所有 DeepSeek Harness Desktop.exe。

Q2：悬浮窗是白框？ 确认版本为 1.0.0+（早期版本有图片路径 bug，显示白底空框）；并确认 src/assets/whale-girl.png 存在。

Q3：拖动时桌面多了一张图片？ 那是早期旧版本的 bug（浏览器图片拖放）。当前版本已改为 JS 驱动窗口移动 + draggable=false，不会再复制图片。

Q4：重新打包失败？ 先在 dsh-desktop 目录执行 npm install 补齐依赖；确认没有正在运行的实例占用文件（先退出应用）。

Q5：想完全卸载？ 还原备份：把 src/main.js.whale-*.bak 改回 src/main.js，删除 src/floating.html、src/floating-preload.js，重新打包即可。

素材与版权
whale-dock.png：由 DeepSeek 官方公开图标（chat.deepseek.com 的 favicon）渲染而成
whale-girl.png / whale-girl-small.png：仓库自带的鲸鱼娘主图。若公开发布，请留意该图片素材的版权，必要时替换为自有素材（见"更换主图"）
协议
MIT License，详见仓库 LICENSE 文件。
