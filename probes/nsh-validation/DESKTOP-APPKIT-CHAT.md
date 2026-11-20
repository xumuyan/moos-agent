# AppKit 聊天界面：本机隔离验证

接续[整包检查](DESKTOP-APPKIT-PACKAGE.md)。本轮将现有 `DesktopView` 接到 AppKit 包内的 Swift → 私有 stdio → Node → `runPiSdk`，不改视图、共用 Host 或生产依赖图。不加载本机额外皮肤素材。两份包都叫「沐码」，但使用独立标识 `dev.muma.probe.nsh.appkit.chat`；**不要安装到 `/Applications` 或覆盖正式版**。每份包只使用各自私有临时根相邻的 `profile` 和 `storage`。只用合成项目和本机回环模型，不读取正式历史、配置或密钥，不接真实 GLM/中转，不开 LAN。

- `--check` 构建签名后搬离检出目录的脚本包。只有显式传入 `--check` 才启动；在非前台 AppKit 窗口中调用 `DesktopView` 自己的操作，不发送系统键鼠。用包内 Node/真实 PI 先发、正常退出、重开查历史后再发。取消时脚本暂缓交付真实事件页，在 Host 终态后用每页一条验证积压仍阻止 Send；排空才同会话再发，检查 write/read、文件内容、登记的工具进程消失及 Host 正常退出。
- `--interactive` 仅构建同视图的独立交互包，不内置自动操作入口，也不自动打开。单独按实际路径执行 `open -a`，不要按同名应用搜索。机器上的两个「沐码」不可混淆。两模式共享本机探针 ID，各自拥有不同临时根；并用时不要通过标识查找或激活。
- 本轮实际打开了交互包并看到首屏、两个合成项目与本地夹具入口。点击测试被 `target-occluded` 拦截，未送达，不抢回焦点。没有人工 Send / Stop / Quit / 重开验收。脚本通过不替代这些路径，也不证明异常父进程退出后可恢复。

## 本机复现

需要 arm64/macOS、现存 NSH `0.5.0 (f4d68f7)` 工具链、已核验锁定源码及 Cargo 缓存、Rust `1.100.0`、Xcode、Node `24.15.0` 与 npm 离线缓存，以及本机已有的 NSH TypeScript `7.0.2` 编译器。脚本显式使用已有编译器，不在缺失时下载。仅在当前检出及 owner 文件原样存在时可复现；`desktop-ui-controller.ts`、`desktop-ui-transport.ts` 仅读取到构建快照，未纳管。

```bash
out=$(mktemp -d "$PWD/artifacts/nsh-validation/appkit-chat.XXXXXX")
upstream=$(cat /private/tmp/n01-appkit-source-dir)
/bin/bash probes/nsh-validation/appkit-hostcheck/build-chat-runner.sh "$upstream" "$out" >"$out/native.log" 2>&1 &&
  printf '0\n' >"$out/native.status"
node probes/nsh-validation/verify-desktop-appkit-chat.mjs --check "$out"
node probes/nsh-validation/verify-desktop-appkit-chat.mjs --interactive "$out"
```

脚本、实际打开和回归结果见 `desktop-appkit-chat-evidence.json` 及根目录 `operatelog.md`。本轮保留完整生产依赖，不测包体积收益，不做同负载性能对照。ad-hoc 签名不代表 Developer ID、公证或跨设备发行。下一步是在确认候选窗口可安全接收输入后核验真实按键/按钮和 Quit 退出重开，再分别处理隔离双模型持久配置、异常恢复、合成迁移与资源对照。
