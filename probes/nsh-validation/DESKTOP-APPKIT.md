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

表中不含 Node/PI。现有约 343 MiB 的 Catalyst 完整候选中，Node 和 npm 生产依赖约 266 MiB；换 AppKit 不会自动减少这部分。没有构建完整 AppKit PI 包，不推算其大小，也不把磁盘、ZIP 和运行内存混为一谈。

## 复现与剩余门槛

使用本机 Node 24.15.0、Xcode 和已缓存的 NSH 0.5.0，运行 `node probes/nsh-validation/verify-desktop-appkit.mjs`。TSX 源和测试复制到新证据目录，基线包用独立 bundle ID；探针窗口使用已有 SDK/依赖，不装应用、不启动开发服务器。证据 `desktop-appkit-evidence.json` 绑定脚本、原管道和本机日志。

上一轮官方 mixed 模板使用 fat LTO、单 codegen unit、strip、离线解析，因缺默认 stable 清单和未缓存的 `nsh-core = "0.5.0"` 失败。下面的锁定源码路径不依赖那个模板；保留早期失败记录。

## 锁定源码构建与 TSX → AppKit → PI 实跑（2026-11-20）

固定到 NSH 0.5.0 的 GitHub 提交 `f4d68f7f9f31eb7b3ecc8a4cbc31096d5c6238a1`，核对源码归档里 2,865 个 Git blob（含符号链接内容）与该提交的树记录一致。这是内容核验，不是厂商签名证明。Rust 1.100.0 用原 `Cargo.lock` 构建 `nsh-macos-app --no-default-features --features js`；release 自带 fat LTO、单 codegen unit。第一次依赖下载卡在 `unicode-ccc 0.4.0`；补入与锁文件 SHA-256 一致的缓存后，原装运行器编译通过。自定义链接使用同一依赖图离线完成。命令、归档/锁文件校验值和日志见 `desktop-appkit-source-evidence.json`；本机产物在 `artifacts/nsh-validation/appkit-source.C2fZxl/`。

同一最小基线 TSX 与同一 AppKit 包元数据，分别换为源码编译 runner 和经 `strip -S -x` 的源码副本，各自 ad-hoc 签名、深度严格校验后实际启动、自行退出 0。两者均仍无自定义 Host。不是「关闭 LTO vs 开启 LTO」对比；预编译产物的完整编译选项未核实。

| 壳体（无 Node/PI） | 可执行文件逻辑字节 | `du -sk` | ZIP 字节 |
|---|---:|---:|---:|
| 预编译 AppKit | 48,838,832 | 47,716 KiB | 20,138,710 |
| 锁定源码 release（fat LTO） | 28,294,400 | 27,652 KiB | 11,806,116 |
| 同一源码 release 移符号后重签 | 23,649,552 | 23,116 KiB（22.57 MiB） | 11,032,517（10.52 MiB） |

另一个**自定义探针**通过 `run_app(AppSource::Bundle(...), AppOptions { host, … })` 把 TSX 的 `nsh/host` 调用送到 Rust `HostChannel`，经 Swift 动态库、原 `DesktopPipe.swift` 和固定 Node/stdio 入口，进入共享 `runPiSdk` 与回环模型。只转发六个已登记方法，测试专用 `n01.complete` 不到 Host；桥接限制对象参数、请求/响应字节和 32 个待答请求，复制跨线程借用的参数，在 AppKit 线程使用原管道。脚本通过正尺寸布局及 Host 可用性、拒绝未授权导入、限定项目/会话、公开文本和无错误 write/read、拒绝异项目读取、活动 bash 停止后终态先有积压而后全部读完、同会话再次发送、另一个活动 bash 期间 `Application.quit()`。过程退出 0，`N01_APPKIT_TSX_COMPLETE`，Host 退出 0、未强制终止、stderr 0；运行器仅在没有待答请求时成功退出。这不是人工点击或远端模型验收。

验证输入 `appkit-hostcheck/` 与实跑一致。复现时只在隔离的已校验 NSH 源码副本上操作：先保存 stock runner，用 `swiftc -swift-version 5 -Osize -parse-as-library -emit-library` 将 `AppKitPipe.swift`、原 `DesktopPipe.swift` 和生成的 `DesktopFixedLaunch.swift`（指向本机 Node 24.15.0 和当前仓库 `desktop-host-stdio.mjs`）编译到 `libN01AppKitPipe.dylib`，install name 指向 `@rpath`；用 `nm -gU` 核对三个导出。将 `main.rs` 作为 `nsh-macos-app` 临时入口，`cargo rustc --locked --release --package nsh-macos-app --bin nsh-macos-app --no-default-features --features js -- -L native=<isolated> -l dylib=N01AppKitPipe -C link-arg=-Wl,-rpath,@executable_path`，编译后恢复原入口并严格验签两个组件。把 `App.tsx` 与 `nsh.json` 置于旁边的 `tsx/`，在该目录用 `nsh build . --release -o build` 生成 `tsx/build/bundle.js` 及 sidecar；用清理过的环境直接启动探针。首次链接缺 Swift 公共 C 导出而失败；首次运行暴露 `onLayout` 实为 `bounds.size`，第一次改正又输出到默认 `.nsh/out` 而继续读旧包；均保留原始日志。编译只证实本机 arm64/macOS 27.0.1，未另跑 TSX 类型检查或最低系统版本验收。

自定义探针的可执行文件为 28,277,664 字节，Swift 库 135,248 字节；仍依赖检出目录与本机 Node，不是可独立搬移的同品牌 AppKit 安装包。下一步才是用隔离标识和仓库品牌资源做完整签名包，实测重启续聊、包大小与同负载全进程资源。尚无 AppKit 候选持久化、正常人工 Quit、发行签名或迁移验收；N01-D1/D2/D3 未完成，手机仍暂停。
