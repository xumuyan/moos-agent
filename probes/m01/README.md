# M01 运行时与平台探针

这是独立验证工程，不是 MVP 产品界面。主产品的 React/Ant Design X 与 iPhone 工程尚未创建。

## 本机复现

已验证环境：Apple Silicon、macOS 27.0.1、Node 24.15.0、npm 11.12.1、Rust 1.91.1、Xcode 27.0。依赖固定在 package-lock.json 与 Cargo.lock；rust-toolchain 使用本机 stable，编译器版本随运行环境变化，不能把它当成精确版本锁。Swift helper 编译目标与 Tauri 声明最低系统均为 macOS 14，只有当前系统实测通过。

从仓库根目录执行：

```sh
npm ci
npm test
npm run test:docs
npm run build:probe
npm run verify:probe
```

`build:probe` 为当前 arm64 Mac 准备内置 Node、PI 生产依赖和 Swift helper，再构建 Tauri `.app`。不会更改全局 Node 或 Git 配置。输出目录：`probes/m01/desktop/src-tauri/target/release/bundle/macos/`。

`verify:probe` 从 `/tmp` 启动包内程序，将 PATH 限制为系统目录，使用本地临时模拟模型检查真实 PI RPC 的状态、流式事件、read 工具、取消和退出；随后在 PI 请求仍活跃时分别触发正常 Tauri 退出、仅 SIGKILL 本次探针 App，核对两种路径下 Node 宿主与真实 PI 子进程均已退出。不会读取用户模型凭据或调用付费模型，也不会结束无关应用。结果和 ZIP 位于被 Git 忽略的 `artifacts/m01/`。

可选的 `npm run verify:probe -- --desktop-input` 会在包内 helper 自己创建的窗口中执行真实点击和输入，并仅捕获该窗口。它会短暂切换前台和鼠标位置；需要已授予屏幕录制、辅助功能权限，不会自动申请授权。普通 `npm test` 和 PI 验证按钮只查询权限，不注入输入；新增的浏览器验证按钮是显式桌面操作，会切换 Safari 并输入测试页地址。

## 证据与限制

`evidence/report.json` 为该次包内验证的脱敏报告，`evidence/native-window.png` 只包含探针自身的测试窗口。报告 SHA-256 对应本地 ZIP 与截图，不代表已发布 GitHub Release。完整 ZIP 不提交到源码仓库。

选择 RPC 为主接入方式：Rust 与 PI 通过进程边界隔离，后续任务服务复用该协议。M01 的 JavaScript fixture 和宿主不是生产任务服务，不能对局域网开放。

报告中的完整内置运行时仅用于基线测量。Node 与全部 PI 生产依赖占体积的大部分；后续应验证可校验、可缓存的独立运行时分发或按需裁剪，不能只缩小客户端空壳后声称总安装体积降低。

未验收：真实中转站/GLM、首次系统授权、Retina 和跨屏坐标、其他 Mac 系统/架构、iPhone 实机/签名/证书、发布签名及公证、正常产品界面的项目开发流程。

## GUI 浏览器验证

构建完成后执行 `npm run sign:mac-probe`，使用本机已有 Apple Development 身份签名原生 helper、Node 和应用包，并严格验证签名；不导出私钥、不修改信任设置。该开发签名用于保持应用身份，不能宣称已发布公证安装包。签名材料不进入仓库。

通过正常 GUI 方式打开 `.app`，使用“申请屏幕录制权限”和“申请辅助功能权限”按钮发起对应系统请求。授权开关由用户在系统设置操作；需要时退出并重新打开应用，再点击“重新检查权限”。终端启动权限不能代替此步骤。

浏览器验证只打开 Safari 本体，然后真实发送 Cmd+N、Cmd+L、地址文本和回车。为每次验证生成唯一的本地 HTML 测试页；通过辅助功能树确认页面 URL，再匹配唯一窗口标题并仅截取页面内容区域，不捕获其他标签或全屏。截图及结果保存在应用数据目录 browser-probes 的单次子目录，UI 显示通过的截图。测试失败/权限不足不输出成功截图。

“立即停止”结束本次 helper，不关闭用户的 Safari；同一时刻只允许一个浏览器验证。应用正常退出时取消 helper，helper 检查父进程及前台焦点，发现父进程退出或焦点变化即停止。自动检查包括 UI 权限拦截/成功/取消测试、无效浏览器参数检查及 `npm run test:desktop-native` 的进程取消测试；这些不代替实际 GUI 验收。

该流程验证原生电脑操作工具，尚未由 PI 模型规划驱动；完整开发任务集成仍在后续阶段。权限撤销恢复、Retina/跨屏以及进程退出场景只按实际实测状态记录，不由实现存在推断通过。

本机已安装位置为 `/Applications/Moos M01 Probe.app`，权限添加选择器中可直接从“应用程序”选择。安装验证见 `evidence/desktop-installation.json`；当前该证据只证明签名、GUI 启动和内置 PI 可运行，不证明屏幕/辅助功能已授权。仓库 target 仍作为构建输出保留。

2026-11-04 后续验收：`evidence/desktop-browser-keyboard-fix.json` 记录安装版固定页连续三次通过、实际取消及取消后重新通过；截图 `evidence/desktop-browser-page.png` 已核对只含专用测试页。旧报告中的未授权/失败状态保留为历史。键盘事件采用私有事件源，明确清除文字、回车及抬键的 Command 标志，避免地址输入变成快捷键。失焦时安全停止，报告记录所处阶段；不要在验证中途切换应用。权限撤销恢复仍需用户在系统界面完成操作后再验证，当前不宣称已通过。

2026-11-04 权限后续验收：`evidence/desktop-permission-recovery.json`（E15）补齐录屏与辅助功能各自的“撤销 → blocked 且无截图 → 用户恢复 → 新任务通过”。最终两项均已授权，M01.6 本机检查完成；上述 E14 的“撤销恢复未验收”是当时状态，保留作为历史。此次只覆盖安装版 cfec622 与固定本地页面，多屏坐标及完整 GUI 崩溃链仍待 M01.7 验证。

2026-11-05 正常退出验收：`evidence/desktop-gui-exit.json`（E16）记录 Rust 子进程登记与清理。固定验证子进程退出后移除登记；应用开始退出后拒绝新子进程，已登记进程先收 SIGTERM，3 秒未退出再 SIGKILL。stdout/stderr 由独立线程持续排空，进程成功退出后等待 stdout 最多 1 秒，后代继承管道不会卡住应用退出；SIGKILL 回退、无关进程隔离和管道边界均有原生回归测试。打包验证通过专用参数在 PI 活跃时原子写入临时 PID 报告，再调用正常 Tauri 退出并核对两个进程均退出；这些参数不开放任意命令，也不调用真实模型。浏览器 helper 继续由既有取消路径清理，不结束 Safari。强制终止路径由下条 E17 补充；Retina 和跨屏坐标仍未完成。

2026-11-05 强制终止验收：`evidence/desktop-gui-crash.json`（E17）记录打包探针在 PI 活跃时被 SIGKILL 的真实结果。验证脚本只终止本次启动的探针 App，随后在有界时间内核对 App、Node 宿主及真实 PI 子进程均退出；失败清理会等待本次进程消失并显式报告清理错误，App exit 等待和 Promise 拒绝也进入同一有界错误路径，4 项回归覆盖这些行为。现有 Node 宿主每 500ms 检查父进程，父进程消失后关闭 PI；PI 关闭链先发送 SIGTERM，3 秒未退出再 SIGKILL。此次无需修改生产代码，也不调用真实模型；不覆盖 Retina 或跨屏坐标，M01.7 整体仍未完成。
