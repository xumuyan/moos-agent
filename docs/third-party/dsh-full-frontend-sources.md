# P03 DSH 前端来源与许可

固定上游：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness/tree/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159)，提交 `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`。不随 master 自动更新。

## P03.1 主题基础

目标：`apps/desktop/src/theme/dsh/tokens.css`，选择性改写以下源文件，路径均相对固定上游根目录：

| 源文件 | 使用内容与 Moos 适配 |
| --- | --- |
| `packages/client/ui-theme/src/styles/base.css` | 系统文字与代码字体回退、4/8/12/16/28px 圆角、0.2s/0.1s 动画曲线。移除品牌字体 Montserrat 引用，不复制字体素材。 |
| `packages/client/ui-theme/src/styles/design-platform.css` | 浅色 neutral-bluish 白色主面板、#f9fafb 侧栏、#0f1115 主文字、#61666b 次文字、#81858c 弱文字；neutral-200/300 滚动条、10%/4%/16% 边框、6% 悬停与10% 激活背景、语义状态颜色。Moos 中性主操作保持原版中性色；链接蓝为语义链接颜色。 |
| `packages/client/ui-theme/src/styles/scrollbar.css` | 标准与 WebKit 互斥规则、5px 固定宽、透明轨道与圆角滑块、悬停滑块颜色。保留 Moos 原有仅悬停/键盘焦点显示滑块的行为，触屏与强制色彩模式保持可见。未移植上游的框架属性或运行时。 |
| `packages/client/ui-theme/src/styles/focus.css` | 2px 键盘焦点颜色/宽度。保留浏览器焦点样式，不复制依赖上游输入模态发布器的指针抑制逻辑。 |

现有版本化皮肤 API 八个 `--moos-*` 输入保持兼容；语义别名读取同一输入。未注册任何插件新权限，未引入上游服务或依赖。内置石墨仍是浅色皮肤，本次没有声明暗色主题。主题初始化保留已保存的皮肤；缺失、不兼容的插件皮肤仍走既有默认回退。GUI 对照与安装验收由阶段记录另行给出；来源核对和自动测试不等于视觉验收通过。

## P03.2—P03.4 布局、对话与设置

- `apps/desktop/src/layout/dsh-columns.ts`：复制固定上游 `packages/client/ui-layout/src/client/columns.ts`，保留算法与说明并增加版权标头。
- `layout/AppShell.tsx` 与 `theme/dsh/shell.css`：参考 `ui-layout/AppFrame.tsx/.module.css`、`ui-sidebar/SidebarRoot.tsx/.module.css` 的单侧栏、收起、列宽及拖动；React状态与Moos导航/项目会话/右栏适配自行实现。
- `theme/dsh/conversation.css`、`composer.css` 与 `conversation/TurnTimeline.tsx`：适配 `ui-chat/ChatView.module.css`、`MessageItem.module.css`、`TurnProcessNodeView.module.css`、`ui-primitives/UserMessageBubble.module.css`、`ui-conversation/skeleton/InputBar.module.css` 和 `ConversationRoot.module.css`，不引入原版数据与推理。
- `settings/SettingsCenter.tsx` 与 `theme/dsh/settings.css`：适配 `ui-settings-general/SettingsRoot.module.css`、`ui-primitives/settings-form/SettingsForm.module.css`、`fields.module.css`；保留Moos实际九个设置分区及Ant Design生命周期。
- 本地 `src/moos-icon.png` 复制的是本项目原创Moos源图；不来自上游Logo、鲸鱼或字体资源。

## 原始 MIT 声明

以下完整保留上游根目录 `LICENSE`（版权及许可适用于上述改写）：

```text
MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## P03.6 细节复核补充来源

继续使用以上固定提交和 MIT 许可：`ui-layout/src/client/AppFrame.module.css`、`ui-sidebar/src/client/SidebarRoot.module.css` 的300ms列宽/150ms退出/200ms展开；`ui-conversation/src/client/skeleton/{InputBar,HeroShell,ConversationRoot}.module.css` 的独立输入工具栏、卡片外统计与空态几何；`ui-primitives/src/markdown/MarkdownText.module.css` 与 `ui-chat/src/client/chat/TurnProcessNodeView.module.css` 的排版和微动效。Moos保留自有M图标，不复制鲸鱼动画；表格采用可聚焦横向滚动容器，未实现原版wide-breakout。系统窗口仍由Tauri创建，仅主窗口允许start-dragging，不开放文件或shell命令。

P03.6 菜单与弹层还参考 `ui-primitives/src/{MenuSurface.tsx,MenuSurface.module.css,Modal.module.css}`：40/80ms菜单与200ms弹层淡入淡出，按Ant生命周期适配。
