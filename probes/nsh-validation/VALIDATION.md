# N01 验证记录｜2026-11-14

## 状态与证据归属

基础提交 `30d3973` 加本次提交前工作区（只新增 NSH 隔离工程、计划/日志/文档检查）；macOS 27.0.1 arm64，NSH 0.5.0 (f4d68f7)，原型 0.0.1 / `dev.muma.probe.nsh`。提交关联见 `git log --all --oneline --grep='add isolated NSH native UI validation'`。原型不是完整沐码；本轮无正式应用构建、部署、退出或重启，无用户数据作为测试输入。

## 实际命令与结果

本机工具 PATH 默认无 npm/cargo，首次三条 npm 命令 exit 127；后续显式使用 Node v22.22.0 与现有 Cargo。未安装新 Node。

| 命令 | 实际结果 |
|---|---|
| 工具链 `shasum -a 256 -c` | macOS 发布包校验通过；固定值见 README |
| `bash probes/nsh-validation/nsh.sh check` | exit 0 |
| `bash probes/nsh-validation/nsh.sh test` | 4/4，通过无界面真实 NSH 引擎 |
| `bash probes/nsh-validation/nsh.sh test --target macos` | 4/4，通过后台 AppKit 原生窗口，不是 iOS |
| `nsh test probes/nsh-validation/App.tsx --target macos`，stdin 驱动 | 1/1，通过输入、发送、等待完成、截图、1000 条加载和滚动截图；两图已回读核对中文、Markdown/代码块及历史行 |
| `nsh package probes/nsh-validation --target macos -o artifacts/nsh-validation/macos` | 成功，仅隔离构建；codesign --verify --deep --strict 通过，bundle ID 独立；未安装或验证此打包产物的 GUI，原生窗口证据来自开发/测试 host |
| `npm test`（默认并行） | 首轮232通过/1失败/3取消，PI 超时与桌面测试读次数时序断言失败 |
| `node --test --test-concurrency=1 probes/m01/*.test.mjs services/agent/*.test.mjs packages/pi-adapter/*.test.mjs packages/pi-runtime/*.test.mjs scripts/*.test.mjs` | 236/236，通过；不以此覆盖首轮失败历史 |
| `npm run test:electron` | 103通过/1失败/9跳过；串行重跑同样结果 |
| `cargo test --release --offline --manifest-path probes/m01/desktop/src-tauri/Cargo.toml` | 首轮工具180秒限时中断，重跑11/11通过 |
| `python3 -m unittest discover -s tests -v` | 本轮同步计划/日志后的结果见 operatelog，不能替代应用测试 |

Electron 阻塞：`apps/electron/host.test.mjs:73` 的 shell 测试触发 `plugin/host.js:43` 的 `ctx.on is not a function`，本轮未修改上述文件；9项跳过缺少指定隔离构建/皮肤输入。**全仓验收未全通过，不标 N01 完成、不宣称回归全绿**。解除条件：另行修复/验证原 Electron 测试上下文并提供相应隔离构建输入，不为此改正式运行数据。

## 本地原始证据（Git 忽略）

`artifacts/nsh-validation/results/`：`check.log`、`headless.log/xml`、`macos.log/xml`、`acceptance.log`、`macos-chat.png`、`macos-history.png`、`package-macos.log`、`core.log`、`core-serial.log`、`electron.log`、`electron-serial.log`、`native.log`、`native-rerun.log`、`ios-component.log`、`ios-download.log`、`ios-download-http1.log`、`docs.log`。截图为390×844逻辑尺寸的 macOS 测试窗口，**不是手机截图**。

原生验收步骤：在自己的测试窗口输入合成中文 → 模拟发送 → 状态为已完成、2条消息 → 核对 Markdown 标题、加粗、代码和列表 → 加载1000条并滚动。停止测试冻结输出，等待后不变化，切换 B 为空、切回 A 保留停止状态。List 测试在滚动前后均仅生成少于100个 message 视图；这不是内存回落或性能收益证明。未验证真实拼音组合态、复制快捷键、图片和前后台恢复。

## 故障与限制

最初 Button 直接放字符串导致零尺寸不可见，改用有样式的 Button + Text；最初停止测试跨会话切换耗时超过短响应而已完成，延长模拟间隔并先停止再验切换。无滚动余量时不执行无意义 scroll。最终两端4/4通过。最小 capability 配置产生 statusBar 未授权警告，保留拒绝，不为消警告授予无用权限。

两次桌面工具事务 begin 后立即 windows 返回事务已失效，未派发桌面输入、未声称人工 GUI 验收；采用 NSH 自身后台原生输入测试和窗口截图（不是全屏截图），不抢正式应用焦点。交互 `nsh run` 只启动本原型，随后仅 SIGTERM 本次CLI PID，CLI与host均已退出。

iOS：无模拟器运行时；组件自动下载 TLS EOF，curl HTTP/2错误、HTTP/1.1空响应。未生成 iOS 包/未运行模拟器或真机，Android未执行。未安装系统组件，不扩大平台支持声明。

资源：本轮没有同业务 CPU 时间增量/全进程树内存测试，不报告节省比例。macOS原型包只有UI，不包含Node/PI与完整功能；不能与正式沐码直接比较。下一步先隔离真实 PI 与本地模拟模型，再对齐业务负载、长会话与完整功能，最后验证手机原生运行和Mac连接。
