# N01-D1/D2/D3｜桌面范围、协作接口与验收基线 v1

本任务 desktop_baseline 固定可复核的参考和验收规则，不交付主题还原或性能收益。
仅 NSH Mac；手机完全暂停。当前正式 Electron 是保护对象，不是本轮可改造工程。
机器可读基线、来源 SHA-256 和已有文件归属见 `desktop-baseline.json`；可执行资源报告门禁见
`desktop-baseline.mjs`，测试 `node --test probes/nsh-validation/desktop-baseline.test.mjs`。

## 1. 范围和诚实状态

目标是保留当前 DSH/沐码主题体验，同时在**相同已接通业务**中实测降低完整应用进程的内存、CPU 和落盘体积。
不得以空壳对完整 Electron，或把真实 PI SDK + 回环模型夹具称为外部模型推理。

| 任务 | 本轮候选范围 | 仍缺什么才可整体通过 |
| --- | --- | --- |
| N01-D1 | 独立 NSH 窗口、项目/会话选择、真实 PI submit/公开流/工具/停止、等待 Host 正常收尾 | 实际 UI→原生桥→Host 的同状态证据，真实原生交互和退出，不以控制器 mock 代替 |
| N01-D2 | 独立临时目录、异步归属、防重复、取消及断开状态 | 持久历史/重启恢复/模型配置/生产目录授权尚未交付；当前临时 Host clean close 删除数据，不可声称保存历史 |
| N01-D3 | 固定外观参考、同业务资源比较及输入/滚动/主题差异清单 | 同尺寸实图、中文输入法组合态、视觉认可及整进程测量；不承诺固定降幅或所有皮肤插件兼容 |

不修改 `apps/electron`、正式构建/版本/插件/配置、共用 `services/` 和 `packages/pi-*`。
不退出、重启、安装正式应用；不读正式聊天/凭据/皮肤数据作为输入。不运行手机构建、安装或配对。
产物放 `artifacts/nsh-validation/desktop-*`，独立应用 ID/临时数据目录，无 LAN。
现有 Swift NSH 嵌入路线是 **Mac Catalyst**，不是已完成 AppKit 自定义桥；平台必须写入每次报告。

## 2. 实际视觉参考（不是已完成的候选图）

主图：`docs/evidence/desktop/agent-teams-live/success.png`；辅助图：同目录 `blocked-panel.png`。
已用工具观察，并核对原文件 PNG magic/IHDR，两者为 PNG，1240×820（图片观察工具返回的转码预览不作为原文件编码依据）；它们属于历史隔离工作区、真实 GLM 团队验收 E139，
并非这轮重截、不是 NSH。引用已有脱敏图，不把图中消息文本作为模型输入，也不复制图片内容作为应用壁纸。
图的 hash、尺寸和来源证据由测试锁定。历史测试截图不等于用户已认可 NSH 外观。

固定主对照画布：**内容截图 1240×820**；候选还需记录 macOS 外框尺寸、内容尺寸、display scale、裁剪坐标及字体环境。
不能将 Catalyst 外框尺寸直接当内容尺寸。当前他人 `verify-desktop-ui.mjs` 中 1000×780 和 UI 测试900×720是功能测试，不算同尺寸视觉对照。

| 元素 | 实图观测/只读源码 | 候选验收要求 |
| --- | --- | --- |
| 左栏 | x≈0..280，全高；品牌、新会话、导航、项目/会话、底部设置 | 1240主画布分栏边界280±4；文字不得遮挡/越界，选中项有状态 |
| 顶栏 | x≈280..1240，标题/模式/操作；下部“对话/轨迹”到 y≈75 | 高75±4；标题长时省略，操作不能挤进聊天内容 |
| 聊天 | 右侧整区铺蓝色人物/海洋亮色壁纸，公开文本上有浅色半透明底 | 独立背景层、内容层；保留可读性和滚动，不擅自用深色纯底替代 |
| 输入框 | 主图 x≈400,y≈680,w≈714,h≈100；白色圆角、底部动作行 | 非固定在消息内容内；主图位置±8，动态高度独立验收；不得盖住最后消息/停止键 |
| 字体 | 中文无衬线、正文目测约14px；品牌约20px | 精确字族/字重尚无字体元数据，不能冒报逐像素一致；候选记录实际系统字体/字号/行高，以图核对 |
| 颜色/透明 | 主图为冷蓝浅底；截图不能反推出 alpha、blur 半径 | 记录候选真实色值、alpha、模糊实现并对照；`#f3e3c0`只是只读client中另一maid品牌规则，不是本图全局主色 |
| 装饰 | 主图人物、气泡、手部属于壁纸构图，无可靠单独蕾丝动画证据 | 不凭历史“宫殿/蕾丝”文字编造本图；缺资源须明确标“未还原”，不以生成图冒充原素材 |
| 右面板 | 主图未打开；辅助图为内联成员详情，并非右侧栏 | 折叠态为基准；右栏尺寸、动画和内容另列未验，不编造参考 |

几何是人工读图近似基准，不是从 CSS 测出的事实。以相同内容布局的合成文字/文件名制作候选图，保持参考图不变；
文字抗锯齿和不同内容不能直接全图像素diff。需并排图、关键区域裁图/边界测量、差异表，用户认可前不标“主题还原完成”。

### 资产来源与许可边界

- `apps/electron/assets/sidebar-icon.png` 是已跟踪32×32品牌资源，只读引用 hash；允许后续主题任务在 NSH 自有资产目录明确来源后使用，不修改原文件。
- `apps/electron/plugin/client.js` 只读确认品牌和部分样式，不复制其业务脚本。DSH结构参考许可见 `THIRD_PARTY_NOTICES.md` 与 `docs/third-party/dsh-full-frontend-sources.md`。
- `p03-dsh-skin-import.json` / `probes/dsh-electron-skin/evidence.json` 固定的是历史 maid-atelier0.3.2、上游85047d9；并明确 thirdPartyArtCommitted=false。**不能据此认定E139壁纸就是该版素材，或有权打包图中艺术资源。**
- 本轮仅检查仓库与现有忽略构建路径，没有找到可版本锁定的完整目标壁纸/字体/装饰源及其 LICENSE/NOTICE；未访问正式用户皮肤目录，也未联网取未知素材。当前可完成布局/品牌/半透明候选，完整主题素材和再分发权为未解决依赖。后续在独立来源取得原包、版本/hash及许可后才能打包；不得截取参考图充当资产。

## 3. 协作所有权与兼容接口

开始时 HEAD、9个未跟踪文件 hash/字节/用途保存在 `desktop-baseline.json` 和忽略的 `artifacts/nsh-validation/desktop-baseline/initial-worktree.json`。
作者身份无法核实，视为**已有他人工作**，本任务不编辑、不暂存、不回滚、不冒称新增。以下是后续串行接管边界，不是声称它们已提交验收。

| 所有者 | 路径（均在 probes/nsh-validation） | 协作限制 |
| --- | --- | --- |
| desktop_baseline（本任务） | DESKTOP-BASELINE.md、desktop-baseline.json/.mjs/.test.mjs；专用Python测试 | 仅规范/可执行门禁/来源清单；根PLAN/日志仅本任务增量 |
| 主题任务 | DesktopView.tsx、DesktopApp.test.tsx、后续 desktop-theme* 与 assets/desktop/* | 改展示和布局，保留下述 actions/testID，不改Host/控制器行为；新增资源必须来源/许可 |
| 内核任务 | desktop-contract.ts、desktop-host*.mjs、desktop-model-fixture.mjs、desktop-ui-controller.ts、desktop-ui-transport.ts、desktop-ui.test.mjs、verify-desktop-host.mjs | 控制器/事件/隔离/契约；不改共用PI/services；破坏接口先同步契约及上下游测试 |
| 集成任务 | DesktopApp.tsx、DesktopUIHost.swift、DesktopPipe.swift、DesktopNativeBridge.swift、desktop-ui-acceptance.tsx、verify-desktop-ui.mjs、verify-desktop-native.mjs、nsh.json/入口/构建及全局文档 | 只构建独立NSH；若新增主题文件，显式加入构建复制清单；根文档与Git提交串行 |
| 最终 verifier | 独立验收结果/报告 | 核对每个提交实际覆盖，不把别人未提交工作当交付，不替失败勾整体完成 |

### 视图→控制器（现有候选接口，主题接管须保持）

`DesktopView({ ready?, call? })`：`call`是测试替身/六方法传输，不是任意网络能力。
`ready`拿到`{ controller,type(text),send(),stop(),project(id):Promise<void>,session(id),create():Promise<void> }`。
控制器`DesktopController(call,changed?,delay?,maxPolls?)`：`start/selectProject/selectSession/createSession/submit/stop/dispose`；
可读`projects/sessions/projectId/sessionId/loading/error/current`；`current`含`scope/rows/task/busy/stopping/error/sequence/cursor/drained`。
`rows`仅展示公开用户文本、PI公开文本、工具起止及状态；不得伪造Think/推理或将任务成功静态写在视图里。
选择变化不能把旧任务事件写入新会话。切换只改展示，不取消其他任务。
保留 testID：`project-${name}`、`session-${title}`、`selection`、`create-session`、`status`、`error`、`messages`、`message`、`prompt`、`send`、`stop`。
这些ID不是固定颜色/布局要求；主题可移动控件，但不得渲染重复ID造成假点击。未实现的设置/团队/图片入口不能伪装可用。

### 控制器→原生桥→Host（已提交 v1，不另造协议）

以 `desktop-contract.ts` 的 Calls/Request/Response 为唯一线协议。仅
`projects.list / sessions.list / sessions.create / tasks.submit / tasks.cancel / tasks.events`；projects.list为空对象；sessions.list/create显式projectId；submit显式projectId/sessionId；events/cancel再含taskId。
submit只接受text/requestId，不能从UI传目录、shell、模型URL、provider或凭据。
`desktop-ui-transport.ts` 解包 `version:1,id,ok,result|error`，原生生成关联ID；取消返回不是清理确认。
事件仅公开 `text_delta / task_state / tool_start / tool_end`；只有 **terminal && !hasMore** 才停止取页。
`cursor_expired`/断开/未知结果必须显示错误，不自动重提任务；失败不转成功。
六方法 capability逐名授予；`ui.*`/`check.*`仅隔离验收宿主，不进入普通运行bundle。

原生只spawn可信固定Node/Host绝对路径、私有管道、PATH/TMPDIR/LANG，遵守16KiB请求、512KiB响应、32pending及10秒原生期限；
细节沿用 DESKTOP-HOST.md / DESKTOP-NATIVE-BRIDGE.md，不修改已有上限。
`desktop.dispose`通知仅撤销JS计时器/pending；可信owner仍须await bridge.destroy()，Host正常exit0且无forced才算退出通过。
关闭窗口/菜单Quit/异常父退出需分开证据；旧孤儿Host与SIGTERM失败不能被正常路径覆盖。

## 4. 同业务资源验收协议

机器门禁的运行方式：

```sh
node probes/nsh-validation/desktop-baseline.mjs /path/to/sanitized-comparison.json
node --test probes/nsh-validation/desktop-baseline.test.mjs
python3 -m unittest discover -s tests -v
```

报告格式由 `validateComparison` 与测试fixture固定，schemaVersion=1。主题/负载/夹具hash为SHA-256，字节为非负安全整数，安装器/应用不得为0；无安装器可记录null但阻塞。
这是提交摘要的拒绝门禁，不是采样器：processTreeComplete/functionalPassed等声明仍须独立核对原始脱敏证据，不能仅靠填true证明完整进程树或真实通过。数据必须来自后续真实采样，测试里的数字只是门禁单测，绝非性能证据。
两端均用独立临时数据和相同皮肤/窗口/内容尺寸/scale/历史数量/模型夹具/PI版本/任务脚本；不允许正式运行实例对比全新NSH。
Electron基线只能用已有隔离包与合成数据；本任务不构建或安装Electron、不改源码，不复制真实聊天或密钥。
缺少可独立启动的同业务Electron基线则报告 blocked，不拿生产读数顶替。

要求三组配对交替顺序 A/B、B/A、A/B，每组覆盖：
1. `idle-new`：新会话稳定20秒后采60秒；
2. `idle-history`：相同1000条合成历史稳定20秒后采60秒；
3. `stream-tools`：同一个本地模型夹具，真实PI固定write/read/bash与公开流，从提交至terminal且排空；
4. `cancel-drain`：确认真实工具启动后停止，直到登记进程退出；
5. `repeat-cycle`：相同10次提交/终态排空，包含停止后回落采60秒。
当前Host最多32任务/实例，周期用新实例，不改变上限。历史1000条不能用少量临时会话冒充；未接通则该负载blocked，D2未完成。

每段记录完整进程树（NSH或Electron窗口+Host/Node/PI+工具子进程，采样期间新生/退出PID不得漏掉）、精确路径/祖先/开始时间，
CPU累计时间差÷墙钟（100%=一核）、RSS和macOS footprint，采样开始/结束/周期、可见性和scale。
RSS有共享页重复，不能当独占内存。footprint不可用/部分失败不得补0。编译器/本地模型服务若为应用所需也计入，二者同源服务只可对称单列；
工具链构建进程不能混进运行阶段。foreground/hidden分开，隐藏NSH不能对前台Electron。

体积同时报告 installerBytes（无安装器则null并阻塞完整目标）、runtimeDownloadBytes（无下载可真实0）、
appBundleBytes、runtimeBytes、dataBytes、fullDiskBytes；fullDiskBytes包含所需运行时及本轮数据；
逻辑字节与du/APFS实际占用另列，不混为“释放空间”。工具链/测试缓存/中间构建单列，不漏掉Node/PI而只报空壳。
不把仓库近100GB历史产物当Electron安装大小。

### 通过/未通过

- 所有相同业务functionalPassed=true、normalExit=true且forced=false，完整进程树/采样通过校验才比较。
- 每一负载三组中位CPU和footprint均下降，且下降量**严格大于**组内最大抖动范围，fullDiskBytes配对均下降，才是本轮子集“资源收益已证明”。不预设固定百分比。
- 抖动覆盖收益、任一指标上升/相同即 not-demonstrated；字段缺失、业务不等价或资源不可用是 blocked；失败/缺失不能当0。
- 该门禁仍不证明主题获用户认可、完整功能迁移、外部模型质量或长期无泄漏。即使数字passed，仍须独立visualAccepted及全部业务/退出证据，N01才可能进入下一阶段。
- 本文建立基线，不包含任何NSH/Electron本轮对比测量；N01-D1/D2/D3保持未勾选。历史P03.14.12读数只供方法参考，不是这次同业务对照结果。
