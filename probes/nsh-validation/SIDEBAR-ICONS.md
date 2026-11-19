# N01-D3 sidebar_icons｜原生候选图标与左菜单（未整体验收）

复用既有正式侧栏裁图，对照 DSH 0.2.2-rc.1 的 sidebar/workspace/plugin-manager、前端 SVG 定义及 conversation InputBar；没有新的正式窗口捕获、实时 DOM/样式探针或聊天读取。`desktop-sidebar-icons-verification.json` 固定来源哈希、候选输入及明暗宽窄截图。仅本机授权的 Maid Atelier 0.3.2（CC BY-NC-SA 4.0，上善 → zipzip → Small-tailqwq）用于合成场景，不运行 hooks，不提交皮肤、字体或截图。

| 控件 | 来源和候选映射 |
|---|---|
| 新会话 | DSH `new-chat-outline` Medium（1.3），14pt；去掉全角加号 |
| 插件 / 后台任务 / 更多 | DSH `plugin-pinwheel-outline` / 沐码 `taskIcon`（`apps/electron/plugin/client.js`）/ DSH `apps-add-outline`；三行按既有裁图，不模拟 rail popup 的 compact 变体 |
| 工作区与设置 | DSH `search-outline` / `sliders-two-outline` / `project-add-outline` / `settings-outline`；有皮肤保留盾徽，无皮肤用已选打开、未选闭合的文件夹 |
| 窗口和聊天 | `panel-left-outline`（左侧栏，右详情镜像）；工具开始/完成/失败用 `api-outline` / `check-outline` / `warning-outline`，只随公开工具投影，不是 DSH 工具卡完全复刻 |
| 输入区 | InputBar 内联向上箭头和圆角方形；保持候选分立的发送、停止和禁用规则，不冒充 DSH 的单按钮或增加「发送中」状态。输入框与蝴蝶结下一轮再对照 |

使用 `Canvas`/缓存的固定 `Path2D`，无字体占位、下载、图片 tint 或 SVG DOM。图形不接管点击。复用 DSH 矢量的 MIT 许可见 `DSH-ICONS-LICENSE.txt`；不要将其和 Maid Atelier 的艺术许可混淆。

保留新会话48pt、导航三行各38pt和工作区38pt，调整菜单图标/文字到侧栏左约20/42pt，行中心 y=207/245/283pt；工作区三个16pt图标在三个32pt按钮内居中，宽窗中心 x=192/224/256pt、窄窗水平间隔同为32pt。项目徽章及文字压缩左缩进，仍保留丝带右36pt；功能未接通的菜单及设置保持禁用。侧栏折叠入口在原生按钮预留区之后，与拖动区不重叠，宽窄窗均可收起/展开；艺术背景收起时用浅金图标，避免浅色主题深蓝顶饰吃掉图标。未移动原生系统按钮、未新增入口的业务实现。

## 实际检查

- `node probes/nsh-validation/verify-desktop-theme.mjs --icons` 分别带 `--art-root [本机授权路径]` 与无素材，最终 `run-6IqYj6` / `run-K9KvUn` 各 2/2；各 8 帧，宽1240×820 / 窄680×720，明暗、空态/工作中/收起。原生测试驱动验证禁用入口、行与图标对齐、宽窄侧栏开关、详情、新建、工具三态、停止排空及切项目隔离；不等同人工点击测试。首轮 TS2556 用圆形参数显式解构修复；视觉自查又修正角花重叠和收起后的对比度。最终 `--live-sidebar` 的 `run-njCvrT` 与旧裁图拼接见 `artifacts/nsh-validation/sidebar-icons/sidebar-comparison.png`，不是像素注册。
- 无艺术 headless 14/14；有艺术 `--native` 9/9、`--rich` 6/6、`--evidence` 3/3、`--live-sidebar` 3/3、`--typography` 2/2、`--window-chrome` 2/2、`--sidebar-activity` 2/2、`--chat-cards` 2/2。首次活动回归 `run-qESl9K` 0/2：选会话后等待空态/回到原会话错误卡超时，原因未确定，最终 `run-dVxFrz` 单次复跑通过。既有像素诊断采样 48 个变化像素（普通动画）/0（减少动态）；不证明真实点击、所有帧或 CPU。
- 原始回执在 `artifacts/nsh-validation/sidebar-icons/`；全仓门禁及实际结果见 `operatelog.md`。七份 owner 输入保持原字节；旧证据不改，仅追加哈希过渡。仍缺人工视觉确认、正常窗口退出/真实输入、IME、2×、干净真实 PI/完整包和同负载资源比较。不部署，不启停正式沐码，手机继续暂停。
