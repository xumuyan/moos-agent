# DeepSeek Harness 来源与采用记录

## 固定来源

- 上游仓库：https://github.com/deepseek-ai/deepseek-harness
- 核对提交：`fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`
- 上游许可：MIT，Copyright (c) 2026 DeepSeek
- 许可原文：根目录 `THIRD_PARTY_NOTICES.md`
- 核对日期：2026-11-05

上游处于开发预览阶段。Moos 不自动跟随上游分支；变更固定提交必须重新审查许可、依赖、接口与品牌边界。

## P02.1 采用范围

P02.1 只参考上游公开的模块划分思路，包括工作区/会话导航、聊天与执行轨迹分区、输入区、上下文侧栏和可扩展 UI 区域。Moos 使用 React、Ant Design X、自己的 ViewModel、类型化命令和 CSS 重新实现这些结构。

本批没有复制或实质性改写 DeepSeek Harness 的 TypeScript、TSX、CSS、测试、图标、Logo、鲸鱼素材、文案、Electron/Cordis 后端或 Profile 运行时。界面名称、色彩变量、组件 API、数据流和实现文件均为 Moos 自有。`DSH-style` 只在内部计划中表示布局参考，不作为产品品牌或官方合作声明。

## 文件级采用清单

| Moos 文件或目录 | 上游文件 | 采用方式 | 许可处理 |
| --- | --- | --- | --- |
| `apps/desktop/src/layout/` | 无直接对应复制 | Moos 独立实现的语义布局组件 | 本记录说明设计参考；无上游源码归属头 |
| `apps/desktop/src/ui-adapter/` | 无直接对应复制 | Moos 独立实现的 Snapshot 与命令适配层 | 本记录说明设计参考；无上游源码归属头 |
| `apps/desktop/src/theme/` | 无直接对应复制 | Moos 自有主题变量与布局样式 | 本记录说明设计参考；无上游源码归属头 |

后续若复制或实质性改写上游文件，必须在本表增加准确的上游路径、固定提交、Moos 目标路径、修改摘要和 MIT 归属处理；未登记前不得交付。

## 明确排除

### P02 视觉对齐补充（2026-11-05）

用户明确要求主页面与设置页的实际样式接近 DSH。本次另参考本机上游 checkout `47f943859bef60e4160492346772ded9b24f765a` 中 `packages/client/ui-sidebar/src/client/SidebarRoot.module.css` 与 `packages/client/ui-conversation/src/client/skeleton/InputBar.module.css` 的视觉结构（紧凑导航、留白对话、整体圆角输入卡）。这只是额外只读设计参考，不替换原固定来源基线；新增 `apps/desktop/src/theme/dsh-alignment.css` 为独立实现，未复制上游 CSS、字体、素材或组件。具体色彩、尺寸与 Moos 组件适配自行编写。

- 不引入 DeepSeek Harness 的 Electron 桌面壳、Cordis 服务、Profile/Bundle 执行内核或插件市场后端。
- 不启动 DSH Web Server、Vite Server 或插件 Node Web Server 作为生产依赖。
- 不使用 DeepSeek Harness、DeepSeek 或其图形资产作为 Moos 产品名称、图标或背书。
- 不以布局相似性宣称模型、工具、插件、Usage 或 Computer Use 功能已经实现。
