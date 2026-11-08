# P03.7 原版前端源码移植

上游：https://github.com/deepseek-ai/deepseek-harness，固定 `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`，MIT / Copyright (c) 2026 DeepSeek。完整许可在根目录 THIRD_PARTY_NOTICES.md。

本次替换此前近似外观实现。`docs/evidence/desktop/tauri-upstream-source-lock.json` 列出44份逐字原版文件及SHA256、上游路径，并将其余文件明确标为Moos适配。包含基础主题、平台/滚动/焦点样式、三列布局、SidebarRoot/WorkspaceBrowser/Rows、InputBar/HeroShell、ConversationRoot/ChatView/用户气泡、Markdown/工具行、菜单、SettingsPanel/表单、SidebarRight/DockKit、SVG图标与可复用React原语。各子目录SOURCE.md或source-map.json补充具体来源。原版CSS保持字节一致，差异位于单独的Moos桥接文件。

原版JSX表现结构经移植后接Moos项目、任务、会话、真实工具事件、用量、设置和插件插槽。原版Cordis框架、Lexical、服务端、账号、代理商、数据库、队列等未引入；输入编辑采用受控textarea，未具备的附件/计划/账号功能不显示为可用。React 19的inert布尔属性与原版React 18差异单独适配。保留Moos名称、图标；原版CSS引用的running-whale文件席位使用Moos自己的32px图标，未复制原版鲸鱼品牌资源或字体。业务设置表单保留Moos实际数据，外层采用原版SettingsPanel。

新布局不再导入旧style.css/theme/shell.css/theme/dsh样式，不新增生产Web服务。现有隐藏Node宿主仍承担PI运行时；WebView本身没有Node运行时。插件Manifest/Slot/worker隔离继续使用现有机制，输入框顶端面板以Portal放置，终端按钮在原版工具栏，hero到运行状态不重新挂载PTY。

## 图片皮肤参考

用户指定 https://dsh-market.com/tryon/?skin=phoebe-atelier&theme=light 。本次读取其公开HTML/JS、皮肤清单、skin.css及light预览图，对照全窗背景、明亮遮罩、透明面板和独立人物层的机制。试穿页浏览器加载两次超时，不能记作成功交互验收；实际视觉参考为公开预览图。Moos实现本地用户图片背景与遮罩/面板透明/模糊效果；不分发市场人物图、宫殿图、装饰、第三方hooks或该皮肤包，不宣称已安装原版phoebe-atelier。

图片只在本机WebView IndexedDB保存一份Blob，8MiB/2000万像素上限；PNG/JPEG/WebP签名、声明MIME、尺寸及浏览器真实解码双重检查。拒绝SVG、损坏/伪装文件和越界参数。预览与效果调整不写入，显式应用才保存；存储失败保留已应用状态。重启加载失败在设置展示恢复提示，移除只删除应用内副本。背景与主题切换独立；插件worker无IndexedDB/图片访问API，不将图片URL加入插件上下文、日志、Git或导出。默认未选图片时沿用原版界面，图片开启时单独增加可读的半透明会话席位；减少透明度系统偏好有实色回退。
