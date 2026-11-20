# N01-D1/D3：AppKit 宿主与体积可行性

对照 [NSH 0.5.0 macOS 嵌入文档](https://nsh.dev/versions/v0.5.0/zh-CN/docs/macos.md#嵌入-mac-应用)和[性能报告](https://nsh.dev/versions/v0.5.0/zh-CN/docs/performance-report.md)。官方 arm64 TSX Hello World 启用 fat LTO、单 codegen unit、strip 后，**可执行文件 19.8 MB、压缩 `.app` 9.5 MB**；这是官方参考，不是对沐码的测量或承诺。现有 Catalyst 探针为开发候选，不替换它，也不触碰正式应用。

## 本机两条独立验证

- **NSH 界面壳**：`nsh package --target macos --arch arm64` 的预编译 AppKit 运行器。最小 TSX 探针包 `dev.muma.probe.nsh.appkit.baseline` 深度严格验签通过（ad-hoc），直接运行、自行退出；有 `capabilities.host` 授权也不提供自定义宿主，实际 `host.available() == false`，`projects.list` 返回 `ERR_FEATURE_UNAVAILABLE_ON_PLATFORM`。`nsh test` 人造嵌入环境也单独验证无 handler 时明确报错；该测试不替代包内实测。
- **AppKit 原生 PI 管道**：独立 Swift `NSWindow`（不抢输入焦点，不嵌入 NSH），脚本复用原样 `DesktopPipe.swift` 和固定 Node stdio 入口，调用正式版同一 `runPiSdk`；只用临时隔离项目和回环模型，不接线上。窗口、项目/会话、公开文本与真实 write/read、跨项目拒绝、Stop 先终态后读完积压、同一会话再发、活跃工具期间 EOF 并正常回收 Host，7/7。这里的 Send/Stop 是探针内调用，既不是人工 UI，也不是 TSX→AppKit→PI 链路。

| 指标 | 本机结果 |
|---|---:|
| 可执行文件逻辑大小 | 48,838,832 字节（46.58 MiB） |
| `.app` 实际磁盘占用（`du -sk`） | 47,716 KiB（46.60 MiB） |
| `.app` 压缩包（`ditto -c -k --keepParent`） | 20,138,710 字节（19.21 MiB） |
| 运行器副本 `strip -S -x` | 大小、SHA-256 均不变；未替换原签名执行文件 |

表中不含 Node/PI。现有约 343 MiB 的 Catalyst 完整候选中，Node 和 npm 生产依赖约 266 MiB；换 AppKit 不会自动减少这部分。没有构建完整 AppKit PI 包，不推算其大小。

## 复现与剩余门槛

使用本机 Node 24.15.0、Xcode 和已缓存的 NSH 0.5.0，运行 `node probes/nsh-validation/verify-desktop-appkit.mjs`。TSX 源和测试复制到新证据目录，基线包用独立 bundle ID；探针窗口使用已有 SDK/依赖，不装应用、不启动开发服务器。证据 `desktop-appkit-evidence.json` 绑定脚本、原管道和本机日志。

官方 mixed 模板设 `CARGO_NET_OFFLINE=true CARGO_PROFILE_RELEASE_LTO=fat CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1 CARGO_PROFILE_RELEASE_STRIP=true` 后尝试 `nsh -v package <mixed> --target macos --arch arm64 --out <isolated>`。本机默认 stable 缺工具链清单，改用已有 Rust 1.100.0 后仍在离线解析 `nsh-core = "0.5.0"` 时失败，尚未进入优化链接。需要补齐经核对的同版 Rust crate/源码与锁定依赖，再实现 AppKit 上的 TSX 自定义宿主桥（或原生模块），逐项重验限权、响应、取消排空、退出、重启历史和独立签名搬移包，并测优化前后完整落盘与压缩大小。当前无 LTO 实测值、完整 AppKit 集成、发行包或人工验收；N01-D1/D2/D3 未完成，手机仍暂停。
