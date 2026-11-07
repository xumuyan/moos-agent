# Moos 图标 v1

`moos-icon-v1.png` 是原创 AI 生成图标源图：1254×1254、8-bit RGBA、透明外边距。石墨圆角底、米白和青绿色代码括号构成 M，中间节点表达智能体与插件连接。定位是个人开发助手、多项目开发、终端与电脑操作。

本轮只创建候选资产，尚未替换 Tauri 构建图标或本机安装图标。应用时再从源图生成规范尺寸 PNG/ICNS/ICO，并验证构建包、Dock 及小尺寸清晰度；不能把源图存在当作图标已安装。源图保留，后续设计迭代使用版本文件名。

## 安装接入（2026-11-07）

上面的“尚未替换”为源图创建时的历史范围。本轮按用户明确要求，使用Tauri CLI `tauri icon`生成桌面资源至`apps/desktop/src-tauri/icons/moos-v1/`，在tauri.conf.json中显式声明PNG/ICNS/ICO；保留原有icons/icon.png及v1源图。实际安装、签名与Dock验证结果见根日志和图标安装证据。Windows图标生成不等于Windows支持验收，手机图标未接入。
