# N01｜NSH 隔离验证（不是沐码迁移版）

独立工程，固定 **NSH 0.5.0 (f4d68f7)**。NSH界面仍仅使用内存合成会话，无模型、PI、网络、持久化、文件或命令工具。新增独立Mac Host依赖探针使用真实PI SDK+本地模拟模型，仅监听TLS回环地址，不与当前手机UI连接；见 [HOST-CHECK.md](./HOST-CHECK.md)。新增未接UI的HTTPS任务客户端和原生证书拒绝检查，当前手机可信TLS/配对仍待验证，见 [MOBILE-TRANSPORT.md](./MOBILE-TRANSPORT.md)。应用内专用锚+叶证书固定原语已获Mac原生实际网络测试，Swift嵌入iOS设备包构建/链接通过（未签名/未安装，桥接运行未验），详见 [PINNED-TLS-CHECK.md](./PINNED-TLS-CHECK.md)。后续独立Mac Catalyst宿主已实际跑通NSH→Swift→受限HTTPS及取消/能力拒绝/超时，21项断言通过；这不是iPhone联网，详见 [BRIDGE-RUNTIME.md](./BRIDGE-RUNTIME.md)。原手机应用 ID `dev.muma.probe.nsh`；不复用正式应用 ID/数据目录，不安装或更新正式应用。根目录同步计划、日志、文档检查，`npm test`补入隔离Host测试；不改 `apps/electron`、依赖或正式构建入口。

## 准备与运行

以下命令从仓库根目录运行；工具链/产物均在 Git 忽略的 `artifacts/`，类型生成在本目录忽略的 `.nsh/`。不会全局安装 NSH。

```bash
mkdir -p artifacts/nsh-validation/toolchain
cd artifacts/nsh-validation/toolchain
curl -fL -o nsh-macos-arm64.tar.gz https://github.com/longbridge/nsh/releases/download/v0.5.0/nsh-macos-arm64.tar.gz
# 固定发布包校验值（本机已验证），不只依赖同源动态校验文件
printf '%s  %s\n' e6722427b391b00cf7ec13137db9366e78d1e7a045f2933cf00b340365309d9d nsh-macos-arm64.tar.gz | shasum -a 256 -c -
tar -xzf nsh-macos-arm64.tar.gz
cd ../../..
bash probes/nsh-validation/nsh.sh check
bash probes/nsh-validation/nsh.sh test
# 后台原生窗口测试，默认不会抢键盘；结束自动关闭测试窗口
bash probes/nsh-validation/nsh.sh test --target macos
# 交互窗口，终端 Ctrl+C 收尾；只退出这份验证程序
bash probes/nsh-validation/nsh.sh run --target macos
# 生成隔离 .app，不安装、不运行、不替换正式应用
bash probes/nsh-validation/nsh.sh package --target macos
```

工具链下载约 66.3 MiB，仅 macOS arm64；包含 LICENSE-APACHE。本工程没有添加 npm/Cargo 依赖，也未用全局升级命令。运行器仍可能维护其自身 NSH 缓存；`capabilities: {}` 限制应用外部能力，不宣称构成操作系统文件沙箱。

## 验证范围

- 原生 Input 接收中文文本（自动输入，不等同拼音输入法组合态验收）。
- 定时器模拟流式响应，原生 TextView 渲染 Markdown、代码块和列表。
- 单会话防重复启动、停止后拒绝旧 token；会话 A/B 独立内存状态。
- 1000 条合成历史的原生 List 回收和滚动；不是百万条或完整业务性能验收。
- 关闭清理本程序计时器；正式进程、配置、聊天和插件均不作为测试输入。

## 手机路线与边界

NSH 官方确实提供 **iOS / Android 原生运行时**，TSX 可共用。CLI 有 `--target ios`、`--target android`、`package --target ios` / `ios-simulator` / `android`。不代表本工程手机已验收，也不代表 Node/PI 可直接在 iPhone 运行。将来的手机仍应通过认证加密连接 Mac 执行任务。

初轮 `xcrun simctl list runtimes` / `devices booted` 均为空；自动下载TLS EOF、curl失败。用户连接并开启手机后，复查确认有线配对/开发者模式有效、DDI可用；官方发布包经有界分片下载与SHA-256校验后已在隔离工具链安装。初次复查时独立包尚未签名/安装/运行，历史记录见 [IOS-CHECK.md](./IOS-CHECK.md)。随后用户明确授权安装，已取得独立profile、签名严格校验通过并成功安装 `MuMaNSHProbe`；首次启动被iOS Security拒绝，历史日志保留；之后**用户确认真机界面已出现，并反馈清单内操作总体正常、可发送本地模拟消息**。这是用户实机手动反馈，非助手直接操作或手机自动化报告，无逐项截图/计时。真实模型/PI/Mac任务通信仍未接入。当前未装系统模拟器运行时、Android未验证。安装/签名证据及安全停止边界见 [IOS-INSTALL.md](./IOS-INSTALL.md)。

```bash
artifacts/nsh-validation/toolchain/nsh/bin/nsh component add ios
# 模拟器运行时需先通过 Xcode 正常准备
bash probes/nsh-validation/nsh.sh test --target ios
bash probes/nsh-validation/nsh.sh package --target ios-simulator --name MuMaNSHProbe
# 仅构建未签名的iPhone验证包；不安装
bash probes/nsh-validation/nsh.sh package --target ios --name MuMaNSHProbe
# 必须覆盖包名：默认名称过滤成NSH后与nsh资源目录在本机卷上冲突
# iPhone 真机安装/签名另行授权与验收，不复用正式应用ID
```

## 配对生命周期依赖

独立Node HTTPS回环配对状态机已验证短期邀请、程序化本机确认、一次性凭据、项目归属/撤销/过期；不等于实现手机首次信任或人工Mac确认，详见 [PAIRING-CHECK.md](./PAIRING-CHECK.md)。`node probes/nsh-validation/verify-pairing.mjs`仅生成临时身份并清理，不开放LAN/接PI/更新手机。

## 本轮结果与下一步

详见 [VALIDATION.md](./VALIDATION.md)。本轮 **UI 子集通过，整体 N01 未完成**：Mac Host真实PI+本地模拟模型、隔离/停止/TLS依赖子集已通过，手机认证通信/端到端任务、桌面工具闭环、图片/皮肤/插件及业务资源基准仍待独立推进。不能用这个无业务内核原型的包大小或占用推断完整沐码的迁移收益。
