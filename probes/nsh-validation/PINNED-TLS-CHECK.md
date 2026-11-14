# N01 应用内 TLS 校验与 Swift 嵌入构建检查｜2026-11-14

基础ac5edd6加本次提交前工作区，arm64/macOS27.0.1、Xcode27.0、Swift6.4、NSH0.5.0(f4d68f7)。这是两层独立证据：**Mac原生URLSession实际网络校验通过**，以及**iOS arm64未签名构建/链接通过**；尚未证明NSH→Swift→网络运行，更不是iPhone端到端通过。正式沐码和已装手机模拟包均未改动；无设备读取、签名、profile申请、安装、权限或系统证书信任改动，无LAN监听。

## 可行路线与固定工具链

标准`nsh package`使用预编译runner，不能把新增Swift处理器仅放进TSX包就生效。官方v0.5.0 [embed-ios示例](https://github.com/longbridge/nsh/blob/v0.5.0/examples/embed-ios/README.md)、[iOS文档](https://github.com/longbridge/nsh/blob/v0.5.0/website/docs/ios.md#talking-to-the-app)提供`NativeShell.xcframework`：Swift UIKit应用嵌入`NshAppView`，以`app.handle`对应TSX `host.call`。此路线无需修改NSH fetch本体或安装系统CA，但需要自己的Swift宿主工程，并对native handler独立执行白名单/认证等检查；NSH网络capabilities不会替自定义native代码提供隔离。

本轮从官方v0.5.0资产下载`nsh-embed-ios.zip`，**164682673字节**，核验同发布SHA-256：`2bd3b84ffa72e6fd302b6e1722995cc1800270243f513111b13a2f291d63cd7d`，忽略目录`artifacts/nsh-validation/toolchain/`。有界Range分片下载后核验整包；首次全包安全检查因Catalyst框架包含符号链接停止，未解压该内容；仅选择release `NativeShell.xcframework/ios-arm64/`设备slice，检查每项无绝对路径/`..`/链接后解压8项。未用Dev框架、未全局安装工具链或引入根依赖。

## 应用内信任原语

`PinnedTLS.swift`：

- `N01TrustPolicy`只将测试配置指定DER作为专用锚，`SecTrustSetAnchorCertificatesOnly(true)`，不回退系统其他根；`SecPolicyCreateSSL(true, hostname)`保留主机名、签名链和证书时间校验。
- 禁用信任校验过程的网络补证书请求；`SecTrustEvaluateWithError`成功后再比较叶证书完整DER SHA-256（**不是SPKI**）。hash相同也不能跳过链/主机名/有效期。该锚和pin目前由本机测试注入，不是扫码信任/配对方案。
- URLSessionDelegate只对server-trust challenge使用上述校验结果；其他challenge或错主机拒绝。会话ephemeral、TLS最低1.2、无cookies/cache/credential store；拒绝重定向、限制HTTP200/4096字节、请求5s/总资源8s；一次实例仅一次GET `/trust-check`，无token、任意路径、任务工具或自动重试。未提供生产级调用取消/重启恢复。
- 这是独立会话中限定信任，不是关闭TLS校验。未配置在线CRL/OCSP，不能宣称已完成离线证书撤销或设备token撤销。证书轮换测试仅证明旧pin拒新叶/显式新pin接受新叶并拒旧叶，**没有交付认证轮换协议或设备撤销生命周期**。

`PinnedTLSBridge.swift`仅编译候选：限定`n01.trustCheck`、空参数、一次并发；endpoint/锚/pin均须由Swift可信配置传入，JS不能指定它们。返回固定version/status，错误不带原生诊断、URL或正文。它不暴露任意fetch，也未处理业务任务。构建样本的界面只显示build-only说明，尚未注册或调用此handler，避免没有可信配对配置时暴露网络能力。

## 实际测试与构建验收

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$HOME/.cargo/bin:$PATH"
node probes/nsh-validation/verify-pinned-tls.mjs
node probes/nsh-validation/verify-ios-bridge.mjs
```

1. `verify-pinned-tls.mjs`最终exit0，**13项断言通过**：专用CA+pin+主机名正确；错pin/错CA/错主机、过期/尚未生效、旧pin拒轮换叶/新pin接受新叶并拒退役叶；真实原生URLSession回环HTTPS成功、错误pin拒绝且无HTTP、重定向拒绝、超大响应拒绝。三个独立随机回环端口的HTTP计数`[1,1,1]`，含合法/重定向/超大三个请求；错误pin请求未到达HTTP。测试无凭据，不打印证书私钥；临时目录0700/文件umask077，结束删除。初轮10项通过，补轮换后13项通过。输出`phoneVerified=false/systemTrustChanged=false`。同脚本以iPhoneOS27.0 SDK `-target arm64-apple-ios15.0 -swift-version 6 -typecheck`通过，仅是编译目标，非iOS15实测。
2. `verify-ios-bridge.mjs`最终exit0：在忽略目录生成Xcode工程，release NativeShell设备框架+上述Swift信任原语/bridge+独立NSH字节码构建到未签名`.app`。`xcodebuild ... -destination generic/platform=iOS CODE_SIGNING_ALLOWED=NO build`通过，Mach-O arm64、ID `dev.muma.probe.nsh.bridgecheck`、最低声明15.0、字节码存在、本地网络用途说明存在、无ATS放宽。无开发签名/profile、未安装/启动。构建日志含Supported platforms为空警告，但最终BUILD SUCCEEDED；不把编译/链接当成NSH桥接实际运行或iPhone连接成功。
3. NSH check exit0、headless8/8、macOS AppKit8/8；核心默认237/238（既有几何测试helper超时），Electron103通过/1失败/9跳过（既有ctx.on失败），native11/11；完整核心串行结果及文档测试见operatelog，不冒称全仓全绿。

忽略证据：`results/pinned-tls-{initial,final}.log`、`results/ios-bridge-{initial,final}.log`、`results/embed-download.log`、`results/pin-*.log`；`bridge-build/run-*/build.log`及未签名产物。测试证书/原始框架和Xcode产物不提交Git。不会自动执行手机安装。

## 后续运行检查点

本页保留前一轮构建时状态。后续Mac Catalyst实际桥运行21项断言、原生取消新增后15项TLS测试通过，见 [BRIDGE-RUNTIME.md](./BRIDGE-RUNTIME.md)；不将该Mac结果替换成iPhone运行证据，设备构建样本仍未注册handler。

## 下一依赖（本页历史检查点，后续以BRIDGE-RUNTIME为准）

1. 在能实际运行的NSH Swift嵌入宿主验证JS `host.call`→handler→受限HTTPS→安全返回，覆盖错误参数/超时/重复调用/取消和桥能力未授予；现无iOS模拟器runtime，未为此自动下载系统组件。可先补Mac Catalyst/原生宿主运行验证，不能替代iPhone。
2. 设计首次信任引导：本机确认的二维码携带短期一次性配对材料/专用锚+pin、有效期，首次Mac确认，长期设备token签发/过期/撤销与项目归属；二维码本身是不可信输入，不能由任意扫码直接替换信任锚；CA私钥只留Mac。安全设计和实现测试后才开放最小LAN TLS监听，不能直接搬当前本机测试token。
3. 用受限原生传输适配既有task-client，补任务流式/停止/幂等/断连重连和失败分类，保持正式数据隔离。准备可验收手机候选包后说明包身份/权限/影响，获更新授权再安装；当前无手机更新请求。N01整体继续未完成。
