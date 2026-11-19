# N01-D3｜去掉独立顶栏，让窗口背景贯通

范围：独立 NSH 候选的 AppKit 内容，基准 `efcaa13`。不改现用 Electron、正式窗口状态、业务桥或数据。不把当前实现外推到 Mac Catalyst、iPhone 或其他桌面平台。

- 用 NSH `titleBar.style: 'hidden'`，不使用 `frame: 'none'` 或仿制窗口按钮。壁纸的原点仍是内容 `(0, 0)`，现在内容延伸到原生外框的上沿。标题栏报告高度 32pt；不在上面再叠一块面板。声明可拖动的透明区域根据 `titleBar()` 预留的左右边距计算，离原生按钮保留 8pt，不覆盖导航、标题或任务详情。
- 聊天标题和项目名使用同一壁纸背景，去掉整行底色、模糊底板以及水平分割线；宽窗文字与消息栏左边缘对齐，明暗分别调整文字和局部阴影。会话名仍单行省略，侧栏开关和任务详情按钮保留。内容安全区取顶饰与原生按钮高度的较大值再留 8pt，不把两者叠加。不删除顶饰、蝴蝶结、底饰、人物，也未改消息、工具卡或输入卡的行为。

## 本机程序化验收与边界

显式 Node 22.22.0，专用 0700 `/private/tmp/n01-*`，运行 `node probes/nsh-validation/verify-desktop-theme.mjs --window-chrome --art-root [已授权素材目录]`。去掉 `--art-root` 单独检查无素材回退。使用 NSH 0.5.0 (`f4d68f7`) 的 macOS development host、macOS 27.0.1 arm64、本机 1×，无真实 PI、账号或历史。素材只读，Maid Atelier 0.3.2（CC BY-NC-SA 4.0，上善 → zipzip → Small-tailqwq）；不发布素材/截图、不执行 hooks、不捆绑字体。

最终有艺术及 fallback 各 2/2。两种配色分别实测宽窄、发送与错误工具事件、停止并排空、侧栏显隐、切项目、宽窗详情开关。宽 1240×820、窄 680×720 的原生外框和内容框原点、尺寸相同；旧同尺寸分别多 28pt 外框高度。32pt 顶区左侧保留 71pt 原生控件空间，拖动区从 x=79 开始。关闭按钮通过 `pressClose` 验证 `closeButton` 事件；只在测试夹具阻止最后窗口关闭，避免断开测试宿主，不能当作正常退出或收尾验收。

首轮专项两项超时；串行复跑走完八个截图状态，关闭最后窗口后测试驱动报 `the host left`，不计通过。最终改为捕获关闭请求。早期 `app.drag` 探针未改变原生窗口位置；测试驱动的 View 手势不足以证明系统拖窗。还需人工确认真实拖窗、最小化、缩放/全屏和正常退出。不称实际桌面输入、人工视觉签收或 2× 验收；内容 PNG 不是系统窗口截图，不用于证明原生控件像素。OCR 能识别抽样标题，明色宽窗项目名识别不完整，不称所有背景对比度均已验收。

- 原始图与 `CHROME_FRAME`：`artifacts/nsh-validation/desktop-theme/run-1iUEvR/`（含艺术）及 `run-RRN3oR/`（无艺术）。
- 对照图：`artifacts/nsh-validation/window-chrome/before-after-top.png`（旧 `run-fqMOtc` 与新 `run-3VGGfP` 同一字体夹具宽亮空闲状态，内容裁图）和 `integrated-light-dark.png`（最终窄窗明暗图）。均为合成内容，并非正式 Electron 窗口。
- 输入、图、失败和回归记录见 `desktop-window-chrome-verification.json` 和根 `operatelog.md`。D1/D2/D3 保持未完成；用户确认窗口一体化效果后再继续聊天卡、输入框及装饰细节。
