# N01 iPhone 独立安装｜2026-11-14

用户明确授权“同意 安装把”，仅安装独立测试 App，不部署正式桌面沐码。基础源码提交 `c0b61bf`，本轮未改App/model/依赖；原型0.0.1 build1、NSH0.5.0；iPhone13 Pro/iOS27.0.1，Mac arm64/macOS27.0.1、Xcode27.0。

## 实际执行及结果

1. 重新查询唯一已配对iPhone及开发者模式，现有有效开发证书对应唯一团队。没有输出设备标识、账号、团队或证书主体到普通文档。
2. 在忽略目录 `artifacts/nsh-validation/ios-install/` 生成独立 `N01Signing` 空工程，应用ID固定 `dev.muma.probe.nsh`；`xcodegen generate`、`xcodebuild ... -allowProvisioningUpdates -allowProvisioningDeviceRegistration build` 均exit0，使用Xcode已登录账号生成开发profile。空壳仅为取得profile，不安装空壳，不复用M01手机App ID。
3. 解码检查profile：未过期、包含当前设备、application-identifier精确匹配独立ID、开发用途get-task-allow、team匹配；profile中证书与本机有效身份匹配。没有Apple登录/推送能力。配置文件、设备信息、entitlements、签名材料均仅在忽略目录，根0700、写入文件0600，不导出私钥。
4. 复制上一轮构建的 `MuMaNSHProbe.app` 至独立signed目录，确认无额外扩展/framework、ID和可执行名正确，嵌入匹配profile，使用现有本机私钥签名。`codesign --verify --deep --strict` exit0，签后application-identifier匹配。
5. `xcrun devicectl device install app ...` **exit0，JSON outcome=success**，设备确认安装。只安装 `dev.muma.probe.nsh`，不卸载、不替换手机既有其他App，不操作桌面沐码和用户数据。
6. `xcrun devicectl device process launch ... dev.muma.probe.nsh` **exit1**。CoreDeviceError10002，FBSOpenApplicationServiceErrorDomain1、FBSOpenApplicationErrorDomain3，Security：iOS称签名无效、权限不足或profile尚未经用户明确信任，属于复合诊断，不能断定只因未信任。**安装成功不等于启动成功，当前无手机运行/界面通过证据。**

## 下一步与停止边界

已提示用户检查“设置 → 通用 → VPN与设备管理 → 开发者App”，若有对应开发者，按系统提示信任/验证；密码、信任及系统要求的重启由用户自己完成。不绕过安全授权、不代输密码、不自动授予权限、不反复卸载重装。用户完成后先复核安装检查点，再重试启动；若依然拒绝，继续检查profile/签名/entitlements而非假称信任已解决。

手机界面、触控、中文输入法、流式/停止/会话/列表均待启动后验收；未连接真实PI或Mac服务，无性能收益结论。N01继续未完成。

## 证据与复现边界

本地忽略目录 `artifacts/nsh-validation/ios-install/`：一次性 `prepare.py` / `install.py`、Xcode工程/DerivedData/profile、签名副本、命令stdout/stderr与 `install.json`、`launch.json`、`result.json`。结果检查点 installed=true、signatureVerified=true、profileValidForDevice=true、launched=false。脚本含当次参数，不能盲目重跑、重新申请profile或重复安装；不是已交付的通用安装器。

本轮仅文档/证据状态和文档测试更新；执行Python全部文档检查，数量见operatelog；NSH类型检查/headless重跑。核心/Electron/native全量本轮未重跑，上一轮Electron1fail/9skip保留，不宣称完整回归通过。没有正式桌面应用构建或更新。
