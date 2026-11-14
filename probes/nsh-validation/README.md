# N01｜NSH 隔离验证（不是沐码迁移版）

独立工程，固定 **NSH 0.5.0 (f4d68f7)**。仅使用内存合成会话，无模型、PI、网络、持久化、文件或命令工具。应用 ID `dev.muma.probe.nsh`；不复用正式应用 ID/数据目录，不安装或更新正式应用。根目录只同步计划、日志、文档检查，不改 `apps/electron`、依赖或正式构建入口。

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

初轮 `xcrun simctl list runtimes` / `devices booted` 均为空；自动下载TLS EOF、curl失败。用户连接并开启手机后，复查确认有线配对/开发者模式有效、DDI可用；官方发布包经有界分片下载与SHA-256校验后已在隔离工具链安装。**独立iOS未签名包构建通过，尚未签名/安装/运行；模拟器运行时仍为空，Android未验证**。未安装系统运行时或手机应用、未申请profile或请求签名私钥。详细证据与命名冲突说明见 [IOS-CHECK.md](./IOS-CHECK.md)。

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

## 本轮结果与下一步

详见 [VALIDATION.md](./VALIDATION.md)。本轮 **UI 子集通过，整体 N01 未完成**：真实 PI、任务/项目隔离与停止、桌面工具闭环、图片/皮肤/插件、手机及业务资源基准仍待独立推进。不能用这个无业务内核原型的包大小或占用推断完整沐码的迁移收益。
