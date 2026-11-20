# AppKit 聊天界面：本机隔离验证

接续[整包检查](DESKTOP-APPKIT-PACKAGE.md)。本轮将现有 `DesktopView` 接到 AppKit 包内的 Swift → 私有 stdio → Node → `runPiSdk`，不改视图、共用 Host 或生产依赖图。不加载本机额外皮肤素材。两份包都叫「沐码」，但使用独立标识 `dev.muma.probe.nsh.appkit.chat`；**不要安装到 `/Applications` 或覆盖正式版**。每份包只使用各自私有临时根相邻的 `profile` 和 `storage`。只用合成项目和本机回环模型，不读取正式历史、配置或密钥，不接真实 GLM/中转，不开 LAN。

- `--check` 构建签名后搬离检出目录的脚本包。只有显式传入 `--check` 才启动；在非前台 AppKit 窗口中调用 `DesktopView` 自己的操作，不发送系统键鼠。用包内 Node/真实 PI 先发、正常退出、重开查历史后再发。取消时脚本暂缓交付真实事件页，在 Host 终态后用每页一条验证积压仍阻止 Send；排空才同会话再发，检查 write/read、文件内容、登记的工具进程消失及 Host 正常退出。
- `--interactive` 仅构建同视图的独立交互包，不内置自动操作入口，也不自动打开。单独按实际路径执行 `open -a`，不要按同名应用搜索。机器上的两个「沐码」不可混淆。两模式共享本机探针 ID，各自拥有不同临时根；并用时不要通过标识查找或激活。
- 本轮实际打开了交互包并看到首屏、两个合成项目与本地夹具入口。点击测试被 `target-occluded` 拦截，未送达，不抢回焦点。没有人工 Send / Stop / Quit / 重开验收。脚本通过不替代这些路径，也不证明异常父进程退出后可恢复。

## 包体压缩：保留 AppKit 和 PI

构建参数 `--trim-maps` 只删除新建包里经识别的生产依赖调试源码映射，不删除 Node、PI、任何运行模块或许可证。裁剪后缺少源码映射的调试栈回溯；需要完整诊断时去掉该参数。两种模式都先签名、生成只含 `.app` 的 ZIP，然后在独立临时目录解压并复核链接、签名和内置 Node 版本。脚本模式运行解压后的包，交互模式仍不自动打开。ZIP 大小是传输体积，`du -sk` 是解压落盘占用，两者都不是内存。

[压缩对照回执](desktop-appkit-chat-compression-evidence.json) 使用同一聊天视图、Node 和 AppKit runner。实测交互包移除 3,863 个映射：落盘 298.33→256.66 MiB（−13.97%），ZIP 81.23→73.36 MiB（−9.68%）。全包比对中除新的资源封条及其主执行文件签名外，剩余 11,535 个文件／链接一致。两种交互包均未打开；裁剪后的脚本包实际首启 6/6、重开 12/12（真实 PI＋本机回环）。没有换掉当前运行的候选，也没有压缩或部署正式应用。

可另加 `--strip-node`：只在新包的 `moos-node` 副本上执行 `strip -S -x`，删除本地/调试符号；保持原执行权限、比较 dyld 导出（含地址）和链接库，然后重签 Node 和整包。提取 ZIP 后再核对内置 Node 的版本、哈希和权限。需要原生故障符号诊断时不加该参数；不更改本机 Node 安装。三个裁剪参数独立、均默认关闭。

[Node 裁剪对照回执](desktop-appkit-chat-node-strip-evidence.json)：两版都先去掉同样的 3,863 个源码映射。保留 32,898 个 dyld 导出，包内 arm64 原生模块能加载（未调用剪贴板方法）。交互包落盘 256.66→233.76 MiB、ZIP 73.36→70.13 MiB；相对最初完整包，累计分别减少 21.64% 和 13.66%。同源交互包未打开；裁剪后的独立脚本包从 ZIP 解压后，用真实 PI 和本机回环再通过 6 项首启＋12 项重开验证。不是人工窗口或跨机发行验收，也不说明 RAM 减少。

在 macOS arm64 候选上可再加 `--prune-runtime`。它只在新包里删固定版本的 OpenAI 7.19.0 / Anthropic 0.129.0 SDK 中已经有同名 `.js` 和 `.mjs` 的重复 `.ts` 源文件，以及 PI TUI 1.5.0 的五个 Linux、Windows、Intel Mac 原生插件。保留实际运行代码、arm64 插件、模型路由、许可、类型声明、PI 文档、示例和资源（部分文档路径由 PI 提示词引用）。版本、导出路径或文件类型不符时停止，不改已生成或已安装的包。

[依赖瘦身回执](desktop-appkit-chat-prune-evidence.json)：共删除 550 个文件（545 个重复源码＋5 个异平台插件），同源精简交互包落盘由 233.76 降到 226.34 MiB，ZIP 由 70.13 降到 68.68 MiB。重新验签后，解包脚本版以真实 PI 和本机回环通过首启/重开 6＋12 项，包内 Node/Host 另通过 GLM 路由 Responses 与显式 Relay Completions 的本机协议测试。没有请求真实上游或验收人工窗口。

## 实窗验证（未完成）

本机 [复查回执](desktop-appkit-interaction-evidence.json) 区分了两项结果：原交互包与其副本通过深度签名校验，交互副本显式传 `--check` 会拒绝，未写入 profile/storage；对已运行交互包的新桌面事务因 `focus-unavailable` 停止。单独的只读诊断可从候选进程取得 AX 窗口和元素，但当时候选不是前台应用；这不证明前台可编辑，也不证明上次 `target-occluded` 的具体原因。没有发出键鼠事件。

1. 先核对当前运行的是交互包的精确路径、独立 ID 和 `N01ScriptedCheck=false`。用户手动将有 `Desktop A`／`Desktop B` 的小窗口置前台；不要按「沐码」名称选择进程。重新取窗口 ID 和坐标，不复用旧事务。先确认目标无遮挡，再点输入框并重新确认可编辑焦点。绑定失败或焦点变化立即停，不以脚本、粘贴板或按 PID 注入绕过。
2. 在空的合成 `Desktop A` 会话输入 `N01_RESTART_FIRST`，核对草稿，再点发送。看到 `本地夹具响应：N01_RESTART_FIRST` 和 `succeeded · 已排空` 才继续。然后发送 `MOOS_FIXTURE_HOLD`，看到 `tool_start · bash` 后 25 秒内点同一位置的停止按钮；等待 `cancelled · 已排空`。若先自然结束，不能记为 Stop 成功。接着在同一会话发送 `MOOS_FIXTURE_WRITE APPKIT_CHAT`，核对公开的 write、read 卡片、`完成 APPKIT_CHAT` 和排空状态。事件页积压的确定性验证仍以 `--check` 为准，不能用界面反应速度来推断。
3. 只对刚确认的候选执行正常 Quit，不只关窗口。核对该候选和子 Host 均退出且候选 `profile/.n01-active` 不存在。不删租约、不强杀。用同一精确 `.app` 路径重新打开，不新建资料目录。先只观察历史：旧用户和公开助手文本在发送前出现，另一合成项目为空；再回原会话发送 `N01_RESTART_CONTINUE`，应收到 `N01_CONTEXT_PRESERVED`。若与临时根或先前会话不符，不重放尝试。
4. 记录窗口、实际输入/按钮动作、前后状态和正常退出结果。中文组合输入另测（组合中的回车不得误发），并与直接注入已成字的输入区分。只记录合成回执；不抓取正式窗口、真实聊天和模型配置。

## 本机复现

需要 arm64/macOS、现存 NSH `0.5.0 (f4d68f7)` 工具链、已核验锁定源码及 Cargo 缓存、Rust `1.100.0`、Xcode、Node `24.15.0` 与 npm 离线缓存，以及本机已有的 NSH TypeScript `7.0.2` 编译器。脚本显式使用已有编译器，不在缺失时下载。仅在当前检出及 owner 文件原样存在时可复现；`desktop-ui-controller.ts`、`desktop-ui-transport.ts` 仅读取到构建快照，未纳管。

```bash
out=$(mktemp -d "$PWD/artifacts/nsh-validation/appkit-chat.XXXXXX")
upstream=$(cat /private/tmp/n01-appkit-source-dir)
/bin/bash probes/nsh-validation/appkit-hostcheck/build-chat-runner.sh "$upstream" "$out" >"$out/native.log" 2>&1 &&
  printf '0\n' >"$out/native.status"
node probes/nsh-validation/verify-desktop-appkit-chat.mjs --check "$out" --trim-maps --strip-node
node probes/nsh-validation/verify-desktop-appkit-chat.mjs --interactive "$out" --trim-maps --strip-node
# 只清理探针的新包；不改已运行的候选或正式沐码。
node probes/nsh-validation/verify-desktop-appkit-chat.mjs --check "$out" --trim-maps --strip-node --prune-runtime
node probes/nsh-validation/verify-desktop-appkit-chat.mjs --interactive "$out" --trim-maps --strip-node --prune-runtime
# 对照：不传三个裁剪参数即完整诊断版。
```

早期完整包脚本、实际打开和回归结果见 `desktop-appkit-chat-evidence.json` 及根目录 `operatelog.md`。优先完成包体测量；本轮不做同负载性能对照。ad-hoc 签名不代表 Developer ID、公证或跨设备发行。人工按键/按钮和 Quit 退出重开、隔离双模型持久配置、异常恢复、合成迁移与资源对照仍待分开验收。
