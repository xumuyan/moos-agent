# N01 iPhone 连接与独立构建复查｜2026-11-14

基础源码提交 `7a462cd`，本轮仅更新说明、计划、日志及文档检查，无业务源码或依赖变更。此轮没有安装或启动手机应用、未访问正式沐码数据。

## 脱敏检查结果

- 设备：一台 iPhone 13 Pro（产品类型 iPhone14,2），iOS 27.0.1，arm64e，已启动。
- 连接：wired，paired；开发者模式 enabled。初始设备列表显示 tunnel disconnected、ddiServicesAvailable=false，不能把该快照当作连接失败。
- `devicectl device info ddiServices --no-auto-mount-ddis` 随后成功；设备开发镜像 isUsable/contentIsCompatible=true，build 27A266a。查询未请求挂载/更新开发镜像。
- Mac：Xcode 27.0 (27A266a)，首选 iOS DDI 可用；仍无 iOS 模拟器运行时。
- `security find-identity -v -p codesigning` 只统计到1个有效 Apple Development 身份；未签名、未请求私钥使用、未创建或核对 NSH ID 的 provisioning profile。身份存在不等于本应用已具备完整签名条件。
- 原始设备 JSON 含标识，保存在忽略目录 `artifacts/nsh-validation/device-check/`，未写入本文或 Git；不枚举手机应用、聊天、照片或文件内容。

## 下载解除与构建

自动 `nsh component add ios` 本轮110秒超时；直接下载校验文件成功，但80.7MiB组件直连下载110秒仅收到约9.6MiB而超时。随后对同一GitHub官方发布URL做有界Range分片下载；部分分片超时后仅重试未完成分片。最终合并文件 **84,591,648字节**，与官方校验文件一致：

```text
e0a5039702ad3c53fa938d8dfba488856e8be8632f5fac1538f241df6f6bb53d
```

确认归档路径仅在 `nsh/runtime/ios`、`nsh/components/ios.json` 且无链接/路径穿越后，解压至本仓库忽略的 `artifacts/nsh-validation/toolchain/`。系统Python旧版不支持 `extractall(filter=...)`，首次解压停止；完成逐项类型/路径检查后用兼容方式解压，未全局安装。`nsh component list` 确认ios installed、元数据0.5.0/f4d68f7。

默认中文包名两次构建失败：`Is a directory (os error 21)`。官方v0.5.0 `crates/nsh-cli/src/package.rs` 将名称过滤为ASCII字母数字，“沐码 NSH 验证”得到 `NSH`，与资源目录 `nsh` 在本机大小写不敏感卷冲突。用命令行覆盖测试包名成功，不修改正式工程或中文界面：

```bash
artifacts/nsh-validation/toolchain/nsh/bin/nsh package probes/nsh-validation \
  --target ios --name MuMaNSHProbe --out artifacts/nsh-validation/ios-ascii
```

实际结果：exit0，产物 `artifacts/nsh-validation/ios-ascii/MuMaNSHProbe.app`；Info.plist ID=`dev.muma.probe.nsh`，可执行文件=`MuMaNSHProbe`，Mach-O arm64，声明MinimumOSVersion=15.0（不是最低系统实测）。无embedded.mobileprovision、无开发签名，CLI提示unsigned。进一步 `codesign -dv --verbose=4` 显示预构建二进制自带 `Signature=adhoc`、`TeamIdentifier=not set`；不能把CLI unsigned理解成完全无任何签名，不能据ad-hoc签名直接安装iPhone。最初用codesign非零退出判断未签名的断言失败，随后改为核对ad-hoc/无team/无profile，验证通过。静态包构建通过不代表开发签名、安装或运行通过。

## 尚未执行

iPhone安装/启动和真实触控、输入法、流式/停止/会话/长列表均未验收；没有手机截图。模拟器未运行，Android未验证，真实PI、认证加密连接Mac及完整资源对照仍未接入。下一步待用户明确同意安装本独立测试App后，再核对/准备匹配ID与设备的开发profile并签名安装；系统信任、密码及授权由用户操作。保留现用桌面沐码和手机既有应用/数据。

## 验证与证据

- 实际设备检查：devicectl设备列表、DDI只读查询均exit0；身份仅统计数量。
- 实际构建检查：独立iOS命令exit0；包内元数据、Mach-O及未签名状态已核对。
- 本轮仅文档改动，执行 `python3 -m unittest discover -s tests -v`（具体数量及结果见本轮operatelog）；NSH类型检查和headless测试重跑。现有核心/Electron/native全量没有在本轮重跑；上一轮Electron1fail/9skip仍未解除，N01不勾选完成。
- 本地忽略证据：`device-check/{devices,ddi,preferred-ddi}.json`、`results/ios-component-retry.log`、`ios-checksum-retry.log`、`ios-download-connected.log`、`toolchain/ios-chunks/*`、`results/package-ios-{unsigned-final,isolated,ascii}.log`。下载与设备原始日志不入Git。
