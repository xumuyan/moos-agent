# DSH 风格前端、插件与长任务运行时实施计划

日期：2026-11-05
状态：计划已编写，产品功能尚未实施
设计依据：`docs/superpowers/specs/2026-11-05-dsh-ui-plugin-design.md`
计划范围：P02.1—P02.9

## 1. 目标与执行原则

本计划把已确认设计拆成九个可独立验证、提交和回滚的批次。每个批次严格执行：先补失败测试，再实现最小范围，运行相关测试和全量回归，完成真实验收，同步 `PLAN.md` 与 `operatelog.md`，检查差异，创建唯一 Git commit，推送 GitHub main，并核对远程提交。

不在同一提交混合多个尚未验证的批次。P02.3 是运行时迁移门禁：SDK 验证通过以前不得删除已验证的 RPC 路径；若门禁失败，记录失败矩阵和解除条件，继续使用 RPC，不以实验代码替换生产路径。P02.9 通过以前不得宣称完整 P02 已完成。

## 2. 当前基线与需要保护的行为

- 正式桌面是 Tauri 2 + React + TypeScript + Ant Design X，入口为 `apps/desktop/src/App.tsx`。
- 正式任务宿主为 `services/agent/main.mjs`；Tauri 当前分别启动普通宿主和 `--diagnostics` 宿主。
- `packages/pi-adapter/index.mjs` 当前每项任务通过 `spawn(process.execPath, ...)` 启动 PI RPC，任务上限固定为 600000ms。
- SQLite 已保存项目、会话、任务、消息和事件；历史分页、大记录分块、目录锁和跨项目并发必须保持。
- 模型密钥继续由 macOS Keychain 管理；前端、SQLite、插件、统计和日志不得获得密钥明文。
- M01 探针、既有 RPC 清理证据和历史日志不得因正式产品迁移而改写。
- 每批至少执行 `npm test`、`npm run test:desktop-ui`、`npm run test:desktop-product`、`npm run test:docs`；涉及探针公共代码或打包生命周期时再执行 `npm run test:desktop-native`、`npm run build:app` 和对应实机验收。

## 3. 依赖顺序

```text
P02.1 契约与静态骨架
  ├─> P02.2 完整页面与设置
  └─> P02.3 SDK 单运行时门禁 ─> P02.4 长任务与错误分类
           └───────────────────> P02.5 Usage/缓存/上下文
P02.1 ─> P02.6 Slot 与皮肤核心 ─> P02.7 本地插件安装与沙箱
P02.4 + P02.6 ─> P02.8 原生 PTY 终端
P02.2—P02.8 ─> P02.9 完整自动化、GUI、进程与体积验收
```

P02.2 与 P02.3 在概念上可并行，但本仓库按提交顺序串行推进，避免 UI 重构和运行时迁移同时扩大回归面。

## 4. 批次一：P02.1 第三方边界、UI Adapter 与静态页面骨架

### 文件

- 新增 `THIRD_PARTY_NOTICES.md`。
- 新增 `docs/third-party/deepseek-harness.md`，记录仓库、固定提交、MIT 许可、实际采用文件和修改说明。
- 新增 `apps/desktop/src/ui-adapter/types.ts`、`snapshot.ts`、`commands.ts`。
- 新增 `apps/desktop/src/ui-adapter/snapshot.test.ts`、`commands.test.ts`。
- 新增 `apps/desktop/src/layout/AppShell.tsx`、`Sidebar.tsx`、`ConversationPane.tsx`、`RightPanel.tsx`、`ComposerDock.tsx`。
- 新增 `apps/desktop/src/layout/AppShell.test.tsx`。
- 新增 `apps/desktop/src/theme/tokens.css`、`shell.css`，缩减 `style.css` 为兼容入口；不在本批机械格式化无关代码。
- 修改 `apps/desktop/src/App.tsx`，只把现有数据和动作接到新壳，不改变后端命令语义。
- 修改 `tests/test_repository_docs.py`、`PLAN.md`、`operatelog.md`。

### 测试先行

1. UI Adapter 测试覆盖空快照、项目/会话选择、活跃任务、后台任务数、分页历史和未知状态的安全回退。
2. command adapter 测试覆盖允许的类型化命令，拒绝任意方法名和参数泄漏。
3. AppShell 测试断言三栏语义区、工作区/会话列表、会话标题、对话区、输入区、右侧面板占位和设置入口；不得断言尚未实现的插件或统计可用。
4. 文档测试核对固定 DSH 提交、MIT 归属、禁止官方品牌和所有 P02 项仍未完成。

### 实现与验收

1. 先创建 Moos 自有 ViewModel，避免布局组件直接消费后端 Snapshot。
2. 将当前单体 `App.tsx` 中布局拆出，保留轮询、目录选择、提交、停止和历史逻辑。
3. 使用 Moos 自有名称、图标和主题变量；若实际复制 DSH 源码片段，立即在第三方清单逐文件登记。
4. 浏览器 fixture 实测：添加项目、新建会话、发送本地模拟任务、停止任务、切换项目和打开设置均保持可用；检查控制台和截图。
5. 提交说明：`feat(P02.1): add UI adapter and DSH-style shell`。

完成条件：相关及全量测试通过，浏览器实际流程通过，第三方来源可追溯；仅勾选 P02.1，不勾选 P02.2。

## 5. 批次二：P02.2 完整页面、权限菜单和设置中心

### 文件

- 新增 `apps/desktop/src/conversation/MessageList.tsx`、`TaskTrajectory.tsx`、`ToolCard.tsx`。
- 新增 `apps/desktop/src/composer/PermissionMenu.tsx`、`ComposerStatus.tsx`。
- 新增 `apps/desktop/src/settings/SettingsCenter.tsx` 及 `GeneralSection.tsx`、`ModelSection.tsx`、`PermissionSection.tsx`、`UsageSection.tsx`、`PluginSection.tsx`、`ThemeSection.tsx`、`PrivacySection.tsx`、`MobileSection.tsx`、`AdvancedSection.tsx`。
- 新增对应 `*.test.tsx`，迁移并保留 `App.test.tsx`、`Settings.test.tsx` 的行为断言。
- 修改 `apps/desktop/src/types.ts`、主题 CSS、`PLAN.md`、`operatelog.md`。

### 测试先行

1. 三档权限顺序固定为“请求批准 / 帮我批准 / 完全访问权限”，默认“帮我批准”。
2. 权限文案明确不能绕过 macOS 权限；尚未接通的权限执行后端显示“计划中”，不能假装生效。
3. 轨迹只展示真实事件、工具输入的安全摘要、输出、状态和错误；Think 区不得合成隐藏推理。
4. 设置九个分区可导航，模型设置继续复用现有 Keychain/诊断流程。
5. 小窗口下右侧栏可收起，键盘焦点和 aria 标签可操作。

### 实现与验收

1. 先迁移纯展示组件，再移动状态；不在一次改动中重写轮询和历史分页。
2. 将权限选择持久化为普通配置但不扩大后端权限；真正权限执行留给对应后端批次。
3. 浏览器和打包 Mac GUI 分别验证三栏、折叠、设置导航、对话轨迹和输入流程。
4. 提交说明：`feat(P02.2): build DSH-style workspace experience`。

完成条件：页面及设置实际可用、现有聊天闭环无回归；不能因占位设置项勾选 P02.5—P02.8。

## 6. 批次三：P02.3 PI SDK 单运行时可行性门禁与迁移

### 文件

- 新增 `packages/pi-runtime/sdk-runtime.mjs`、`session-registry.mjs`、`provider-proxy.mjs`。
- 新增 `packages/pi-runtime/sdk-runtime.test.mjs`、`session-registry.test.mjs`、`acceptance.test.mjs`。
- 修改 `services/agent/main.mjs`，在一个宿主内同时处理普通任务与模型诊断。
- 修改 `services/agent/controller.mjs`、`apps/desktop/src-tauri/src/host.rs`、`lib.rs` 及对应测试，移除第二个诊断宿主。
- 门禁通过后修改 `packages/pi-adapter/index.mjs` 为兼容转接或删除逐任务 CLI spawn；RPC 回退代码在完成迁移验收前保留。
- 修改打包脚本、`PLAN.md`、`operatelog.md`。

### 必须先验证的矩阵

1. 同会话连续两轮恢复历史，重启后继续会话且 cwd 仍匹配。
2. 两个不同项目并发，同一规范化目录串行。
3. 流式文本、read/write/edit/bash/grep/find/ls 工具开始、更新、结束事件完整。
4. AbortSignal 能停止模型流和工具进程，只影响目标任务。
5. 每次任务使用正确的 provider、模型、代理和 Keychain 注入密钥，密钥不进入 PI 配置持久化、事件或日志。
6. 普通退出、宿主异常和 Tauri 强制结束后，SDK 会话、代理和工具子进程有界清理。
7. 诊断慢请求不阻塞快照、停止或其他项目任务。

### 决策门禁

- 全部矩阵通过：切换正式 Controller 到 SDK runtime，删除正式路径中的逐任务 `spawn(process.execPath, cli --mode rpc)`，保留 M01 探针不变。
- 任一安全、取消、会话或清理项失败：不得切换；提交只记录可复现测试、失败原因和解除条件，生产继续 RPC。
- 不接受“API 存在”或单轮文本成功作为迁移证据。

### 验收与提交

运行真实 PI + 本地模拟模型集成测试、Rust host 测试、打包 App 进程树检查和退出清理。Activity Monitor/进程报告目标为一个稳定、无窗口的 Moos Node runtime；不能宣称完全没有 Node。提交说明：`feat(P02.3): migrate product tasks to one PI SDK runtime`；若门禁失败则使用 `test(P02.3): record PI SDK runtime blockers`。

完成条件：只有成功路径才勾选 P02.3；失败记录不能勾选。

## 7. 批次四：P02.4 长任务、心跳、超时和错误分类

### 文件

- 修改 `services/agent/store.mjs`，增加配置迁移及任务心跳/错误分类字段。
- 修改 `services/agent/scheduler.mjs`、`controller.mjs` 和测试。
- 修改当前正式 runtime 的超时校验；删除 600000ms 硬上限。
- 修改 `apps/desktop/src/types.ts`、任务轨迹和高级设置。
- 新增 `services/agent/errors.mjs`、`task-policy.mjs` 及测试。
- 修改 `PLAN.md`、`operatelog.md`。

### 测试先行

1. 允许值仅为 10 分钟、30 分钟、1 小时、2 小时、6 小时、24 小时，默认 2 小时；拒绝零、负数、无限和越界值。
2. 错误至少区分认证、额度、限流、网络、模型能力、上下文、工具、权限、取消、超时、宿主中断和内部协议；不回显上游敏感正文。
3. 心跳只表示任务存活，不制造模型输出；过期心跳和重启恢复标记为 `interrupted`，不静默成功或自动重放。
4. 停止在模型流、队列、bash 和代理阶段均有界完成。
5. 加速时钟集成测试覆盖超过旧 10 分钟边界；真实验收必须另跑超过 10 分钟任务。

### 验收与提交

用本地 fixture 跑一个超过 10 分钟的低成本任务，记录开始、跨越 600 秒、心跳、完成/停止和进程清理；不调用真实收费模型完成时长验收。提交说明：`fix(P02.4): support bounded long-running tasks`。

完成条件：600.0/600.1 秒回归不再复现，真实错误可解释，才勾选 P02.4。

## 8. 批次五：P02.5 Usage、缓存命中、上下文与费用

### 文件

- 新增 SQLite `usage_records` 迁移及 Store 查询/清理接口。
- 新增 `services/agent/usage.mjs`、测试和 Controller 命令。
- 修改 PI runtime 统一规范 OpenAI completions/responses 与 GLM 实际返回字段。
- 新增 `apps/desktop/src/usage/UsageDashboard.tsx`、`UsageMetric.tsx` 及测试。
- 修改 `ComposerStatus.tsx`、UI Adapter 类型和设置用量分区。
- 修改 `PLAN.md`、`operatelog.md`。

### 口径与测试

1. 每条记录含 provider/model/project/conversation/task、输入、输出、cacheRead、cacheWrite、contextWindow、费用来源和时间。
2. 缓存命中率严格为 `cacheRead / (input + cacheRead)`；分母为零或服务商缺字段时显示“暂无数据”。
3. 上下文占用只在有实际 token 与 context window 时计算；不从字符数估算。
4. 费用只使用用户配置或服务商明确返回价格；未知显示“暂无数据”。
5. 今日、7 天、30 天、累计及 provider/model/project/conversation 聚合总和与原始记录一致。
6. 密钥、原始请求和原始屏幕图像不进入 usage。

### 验收与提交

本地 fixture 覆盖有缓存、无缓存字段、零分母和两种 API；真实 GLM/中转站只有用户在本机配置后才能补验，未实测时 PLAN 保持对应真实服务项未完成。提交说明：`feat(P02.5): persist and display verified model usage`。

## 9. 批次六：P02.6 类型化 Slot、内置 UI 插件与皮肤核心

### 文件

- 新增 `apps/desktop/src/plugins/manifest.ts`、`registry.ts`、`slots.tsx`、`PluginBoundary.tsx` 及测试。
- 新增 `apps/desktop/src/themes/schema.ts`、`loader.ts`、`ThemePreview.tsx` 及测试。
- 新增内置插件目录 `apps/desktop/src/builtin-plugins/`。
- 修改布局、对话、输入区、设置和 usage 组件挂载固定 Slot。
- 修改 `PLAN.md`、`operatelog.md`。

### 测试与验收

1. 仅允许设计稿列出的 Slot；未知 Slot、重复插件 ID、版本不兼容和非法 manifest 被拒绝。
2. 每个注册返回可重复调用的撤销句柄，停用后无残留 UI 或监听器。
3. PluginBoundary 隔离渲染异常；连续错误自动停用但不影响主页面。
4. 皮肤只接受白名单 token、区域 CSS 和静态资源；禁止脚本、远程 import、全局危险选择器。
5. 预览不持久化，显式应用才保存；启动失败回退默认主题。
6. 浏览器实际切换内置皮肤并制造失败皮肤，验证回退、焦点和布局。

提交说明：`feat(P02.6): add typed UI slots and safe themes`。

## 10. 批次七：P02.7 本地插件安装、沙箱 API 与生命周期

### 文件

- 新增 Rust 安装命令与 `apps/desktop/src-tauri/src/plugins.rs`、测试。
- 新增 `services/agent/plugin-store.mjs` 或等价普通配置接口，只保存插件元数据和私有配置。
- 新增 `apps/desktop/src/plugins/sandbox/`、安装管理页面和测试。
- 新增 ZIP 安全夹具，覆盖路径穿越、符号链接、炸弹体积、过多文件和原生可执行文件。
- 修改协议白名单、`PLAN.md`、`operatelog.md`。

### 安全测试

1. `plugin.json` 必填字段、ID、semver、Moos 版本、入口和权限严格校验。
2. ZIP 解压使用临时目录和原子安装；拒绝 `../`、绝对路径、符号链接、硬链接、超限总大小/文件数和 Mach-O/脚本执行入口。
3. UI 沙箱只暴露声明权限内的版本化消息 API；拒绝 Keychain、任意文件、Shell、截图、鼠标键盘、未声明网络和其他插件数据。
4. 安装、启用、停用、升级失败回滚、卸载保留配置/清理配置均可恢复。
5. 插件崩溃、超时、消息洪水和内存异常不会拖垮主页面。

### 实际验收与提交

安装一个最小本地 UI 插件和皮肤，验证启停升级卸载；使用恶意夹具逐项确认拒绝原因。在线市场仍不实现。提交说明：`feat(P02.7): install sandboxed local UI plugins`。

## 11. 批次八：P02.8 受信任的 Tauri 原生 PTY 终端插件

### 文件

- 新增 `apps/desktop/src-tauri/src/pty.rs` 与 Rust 集成测试。
- 新增类型化 PTY 协议命令；不得提供通用 Tauri shell invoke。
- 新增 `apps/desktop/src/builtin-plugins/terminal/`、终端状态模型和前端测试。
- 修改项目目录锁/任务归属协调代码、`PLAN.md`、`operatelog.md`。

### 测试与验收

1. PTY 仅在已登记项目 cwd 创建，环境变量白名单，不继承模型密钥。
2. 多标签输出分流，输入、resize、退出码、停止和异常关闭正确。
3. 项目移除、应用退出和插件停用会清理 PTY 进程树，不结束无关终端。
4. Git 写操作仍须走 D01 和规范化目录锁，不因终端存在绕过项目任务串行规则。
5. 打包 Mac GUI 实测打开终端、运行无敏感命令、调整尺寸、停止长命令、关闭应用并核对进程树。

提交说明：`feat(P02.8): add trusted native PTY terminal plugin`。

## 12. 批次九：P02.9 系统验收、打包和体积记录

### 自动化

- 全量执行根 Node、桌面 UI、正式 Rust、文档和涉及的 M01 回归。
- 新增打包后进程验收脚本，只追踪本次 App、Moos runtime、工具和 PTY 子进程，不结束无关进程。
- 增加插件越权、皮肤恢复、usage 口径、超过 10 分钟任务、停止和强制退出回归。

### Mac GUI 实测

1. 连续提交至少 20 个短任务，确认无 Dock/终端/独立 Node 窗口闪烁；活动监视器只允许一个稳定的无窗口 Moos Node runtime。
2. 两项目并发、同目录串行；切换项目不停止后台任务。
3. 一个任务超过 10 分钟后完成，另一个在模型流和工具阶段分别停止。
4. 正常退出和 SIGKILL App 后核对 runtime、代理、工具、PTY 进程清理。
5. 用用户本机配置的真实 GLM/中转站核对实际 usage；没有可用凭据则该项保持受阻，不勾选完整 P02.9。
6. 安装/启停/升级/卸载本地插件，验证越权拒绝；应用失败皮肤并确认回退。
7. 记录 `.app`/安装包逻辑大小、磁盘占用、运行时下载量、完整落盘体积和首次启动步骤。

### 收尾

更新第三方声明、用户文档、PLAN 完成证据和 operatelog；只有 P02.1—P02.9 各自验收通过才把 P02 标为完成。提交说明：`test(P02.9): verify packaged DSH-style assistant runtime`。

## 13. 每批固定命令与证据格式

基础命令：

```bash
npm test
npm run test:desktop-ui
npm run test:desktop-product
npm run test:docs
npm run build:desktop
git diff --check
```

涉及打包/进程时增加：

```bash
npm run prepare:runtime
npm run build:app
npm run test:desktop-native
```

每条实机证据记录：系统与架构、应用提交、启动方式、操作步骤、预期、实际、脱敏证据位置、未覆盖范围。失败先记录再修复；无法执行的真实模型或系统权限验收必须在 PLAN 写明受阻原因和解除条件。

## 14. 第一执行点

计划批准后从 P02.1 开始：先添加第三方清单和文档失败测试，再建立 UI Adapter 测试与最小类型，最后拆静态 AppShell。P02.1 完成提交推送前不开始 P02.2 或 P02.3。
