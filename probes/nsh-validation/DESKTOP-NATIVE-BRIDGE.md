# N01-D1｜NSH 原生受限桥与独立 Host 生命周期

这是 **Mac Catalyst 实际运行检查点，不是 AppKit 产品完成，也不是 N01-D1 整体完成**。基础提交 `453751e`，macOS 27.0.1 (26A434)/arm64、Xcode 27/Swift 6.4、Node 24.15.0、PI SDK 1.5.0、NSH 0.5.0 (f4d68f7)。机器可复核证据及源码/日志 SHA-256 见 [desktop-native-evidence.json](desktop-native-evidence.json)。原有 Host 六文件未修改，前任务证据保持原样。

## 平台决定和复现

固定 NSH 发布工具链提供预编译 AppKit CLI/runtime，但自定义 macOS 嵌入接口是 Rust `nsh-platform-macos::AppView`；本机没有其源码/依赖缓存，尝试读取固定上游源码遇到连接重置。已有官方 Swift 框架的接口导入 UIKit、目标为 `arm64-apple-ios15.0-macabi`，所以本次 NSH 集成采用 **Catalyst**。管道核心另以普通 macOS Swift/Foundation 可执行程序实际编译、运行；不能据此声称 NSH 的 AppKit 自定义桥已实现。原 AppKit 模拟 UI 回归 8/8 不等于 AppKit→PI 验收。

```bash
# 从原项目根目录；根据本机已装 Node 设置 PATH，不安装/升级工具链
export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"
node probes/nsh-validation/verify-desktop-native.mjs --native-only
node probes/nsh-validation/verify-desktop-native.mjs --build-only
node probes/nsh-validation/verify-desktop-native.mjs
node --test probes/nsh-validation/desktop-native.test.mjs
```

- `--native-only`：编译/运行普通 macOS 管道测试，无 NSH 窗口。默认 `npm test` 也会执行它；非 Mac 明确跳过而非冒报通过。
- `--build-only`：先执行管道专项，再生成、构建和 ad-hoc 签名独立 Catalyst 测试包，不启动该 App；不是正式 `build:app`，也不安装。
- 默认：执行管道专项并运行真实 NSH 集成；独立 ID `dev.muma.probe.nsh.desktopnativecheck`。`open -W -n -g -j` 启动后台非 key 可见窗口（隐藏窗口不能驱动引擎），不激活/控制正式应用，没有截图或人工 GUI 验收。
- 仅复用现有已下载 NSH/Swift 框架、Xcode/xcodegen 和本机 Node；复核框架压缩包固定 SHA 和其中原生库内容一致。生成的固定路径 Swift 配置、测试 JS、工程、二进制、应用及完整构建日志全部进忽略目录 `artifacts/nsh-validation/desktop-native/run-*`；目录权限由 umask 0077 限制。存储使用本次独立目录，Host 使用其自建临时目录。不运行历史手机/应用安装脚本，不改系统信任。
- 构建仍有 Supported platforms、AppIntents metadata 与官方库原构建机调试对象缺失警告，未冒称无警告构建。

## 接入边界

`DesktopNativeBridge.swift` 只注册 [desktop-contract.ts](desktop-contract.ts) 六个原名 `host.call`：`projects.list`、`sessions.list`、`sessions.create`、`tasks.submit`、`tasks.cancel`、`tasks.events`。TSX bundle capabilities 必须显式授予所需名字；不授予通配能力。生产桥不注册 `check.*`，它们只在本次验收宿主中承担报告、固定销毁、正常退出就绪信号。停滞子进程注入只在 `BRIDGE_CHECK` 编译条件中存在，无线上参数入口。

`DesktopPipe.swift` 使用 `posix_spawn` 直接启动**编译期固定的绝对 Node 和 desktop-host-stdio.mjs 路径**，不用 shell，不接受渲染器脚本/可执行程序/模型地址/目录/凭据。不继承父环境，只给 `PATH=/usr/bin:/bin`、`TMPDIR=/private/tmp/`、`LANG=en_US.UTF-8`；`POSIX_SPAWN_CLOEXEC_DEFAULT` 仅保留显式重定向的私有 stdin/stdout/stderr。可信可执行程序须先忽略 SIGPIPE（两个测试入口都做了）。Node/源码来自当前可信检出，**尚未提供签名随包 Node/脚本、生产目录授权或生产分发完整性保证**。

原生层生成关联 ID，至多 32 个 pending；父 FD 非阻塞、串行写出和有限队列。请求 <=16384 UTF-8 字节（不含 LF），响应 <=524288 字节（含 LF），增量逐帧解析、严格 UTF-8、精确响应 envelope/版本/布尔/已知 error code；未知/重复 ID、超限、截断和非法帧全部失效连接。每次读最多 64KiB 后让出主线程；不把 stderr 原文传回 JS，只丢弃并记录有界字节计数。

原生每调用 10 秒，覆盖启动/排队/背压；任一超时关闭整个实例准入并拒绝所有 pending，不自动重试，不制造第二任务。NSH 等待使用 15 秒，**JS waiter 超时本身不是 native 取消**。成功返回 wire envelope，业务拒绝为 `{ok:false,error:{code}}`，原生传输错误仅 `desktop unavailable`；不泄露路径/命令/诊断。项目/会话/任务归属和精确业务参数继续由真实 Host 验证。提交 text 是 PI prompt，不是 OS 沙箱。

## 生命周期与所有权

- 正常可信退出/替换视图前必须 `await bridge.destroy()`：先关闭准入、拒绝 pending、关闭 stdin 发送 EOF、移除六个 handler，再等待本实例 Host 退出并 `waitpid` 回收。`close` 可重复调用；退出后不接受新调用。
- 输出 EOF/管道错误、进程退出、坏帧、超时同样关闭准入。Owner 意外释放时 deinit 关闭私有 FD，后台仅回收其未回收的精确子 PID；不能按应用名查杀。
- 正常等待 20 秒，超时才向**本实例未回收子 PID**发 SIGTERM，22 秒后 SIGKILL；标记 forced、不计正常成功。Host 自身 drain 上限 15 秒，内部真实 PI SDK（没有独立 PI 子进程）。不承诺任意后代、SIGKILL/崩溃恢复；异常强制退出不保证临时数据删除。
- 本次通过的是 **可信宿主主动正常退出路径**和**桥主动销毁**；`applicationWillTerminate` 只能同步撤销入口/EOF，不替代可等待正常退出协议。SIGTERM 交接实验两次失败，已从成功验收范围排除，不能声称所有系统退出路径均能 await；最终代码移除未验证的信号接手。产品接 AppKit Quit/关闭事件时仍须补原生退出协调及实测。
- Runner 看门狗只核对本次记录 PID 的完整可执行路径后发终止信号；85 秒无退出只报失败，不全局查杀，不影响正式沐码。强制兜底不是正常退出证据。

## 实际结果与保留失败

最终原生专项 **63 项断言通过**：真实 Node/Host 并发关联及正常退出；固定测试子进程乱序、10类错误/断裂/超时、字节上限、32 pending/非阻塞背压、重复/未知 ID、严格类型、销毁后拒绝、deinit 回收及其他原生回收器已reap后的ECHILD拒绝成功/不再信号PID。测试接缝的短期限不改变真实桥 10 秒上限。

真实 NSH 三组通过：good 包含六方法、普通 prompt、真实 PI 流式公开文本、write/read 工具、幂等、错参、跨项目拒绝、并发、停止、活跃 bash 期间销毁及之后调用拒绝；denied 六方法全部 `ERR_ACCESS_DENIED`；timeout 使用原生固定停滞子进程，验证原生期限、关闭后拒绝和销毁。good 的断言数受合法事件分页次数影响，不是固定用例数，实际值以 JSON 为准。第二次独立启动在 bash tool_start 后由可信 owner 正常退出，Host 正常 exit0，未强杀、stderr0。只轮询到 **terminal && !hasMore** 才完成；并发关联还由原生乱序子进程确定性覆盖。

完整回归首轮默认核心317/317；后轮默认314通过/2失败/1取消（SDK会话恢复取消、桌面几何reads差异、sample unavailable），最终完整串行317/317（最终隔离本任务源码快照再跑317/317、182.497s，Electron127通过10跳）；最后一次串行319/319（期间其他成员新增Electron/team-runtime工作区改动及两测试，不纳入本提交，混合状态单独记证据）。保留全部结论，未修复其他领域波动、不能宣称默认并发稳定。Electron127通过/10跳过；Rust离线仍缺tauri。NSH类型检查最终exit0，原模拟UI headless/AppKit各8/8。文档检查160/160（首轮因日志审计标签失败，修正标签，不放宽检查），最终结果见证据/日志，不替代应用验收。

清理额外发现00:29旧测试遗留PPID1的孤儿Host，核对精确测试入口和临时数据库后SIGTERM等待10秒仍未退出，仅该PID强制清理，保留临时状态。根因未知，`orphan-cleanup.json`如实记录；不是最终验收实例，也不是正常退出成功证据。后续必须定位异常父丢失/Node忙循环，不宣称全系统/异常退出已通过。

开发失败保留在忽略目录日志：最初 shell 未设Node路径；Swift字面量类型推断失败；原生库解压到20MiB输出缓存触发ENOBUFS（改为Python算hash）；新增TSX首次类型检查失败，补契约泛型及page显式类型；SIGTERM owner交接两次失败，改为可验证的可信正常退出，不将失败覆盖为通过。

未修改正式 Electron/手机代码、真实聊天/配置；未安装/替换/退出/重启正式应用，无LAN、无手机构建安装、无系统信任修改。未接原聊天交互UI、未验中文输入法/人工操作、未交付AppKit自定义桥/可信分发/生产授权/崩溃恢复，**N01-D1/D2/D3保持未勾选**。
