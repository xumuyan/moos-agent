# N01｜一次性本机配对流程整合候选

范围：`debedbe` 基础加本轮工作区，独立Mac回环实验，N01未完成。不改正式沐码/数据/手机包/系统信任，不部署、不开放LAN。已装手机仍是本地模拟包。

## 可信本机入口与生命周期

`startLocalPairingFlow({tls,projects,present,sessionMs,now})` 使用既有 `startPairingHost`，固定随机127.0.0.1 HTTPS端口，显式提供临时TLS身份；项目必须由可信本机调用者在启动前选择并复制快照，不接受网络/TSX指定回调或可执行文件。

- `begin()` 是显式本机操作，整轮最多产生一份 `N01BOOT1` 材料，私密bytes只交回调用者；不自动打印、不写URL、不提供HTTP邀请接口。不实现扫码/剪贴板/文件分发UI。调用方应立即使用，材料剩余时间不超过整轮期限；服务端还保有自己的邀请期限，整轮到期会关闭authority。
- HTTPS claim仅建立待确认记录，不自动打开面板、更不会自动批准。`reviewPending()` 也是显式本机操作，只有唯一pending才展示固定项目、端点、完整摘要；无pending可稍后显式再试。单邀请、单review，无后台轮询，无远程确认接口。
- reviewer验证请求/claim/transcript及当前pending后才批准，最多60秒且不超过整轮剩余期限。拒绝、异常、取消或晚到结果关闭整轮；close同步失效邀请/claims/已发token并关闭监听，幂等。整轮最长120秒（含批准后的领取窗口），批准不是无限会话。尚无持久化/刷新/崩溃恢复，进程重启不恢复凭据。
- `close()` 中止正在等待的本机presenter；迟到approve不能复活。期限/回退或异常时钟fail-closed。不承诺JS定时器在阻塞主线程时精确唤醒；每次本机操作及authority请求仍核对单调时钟；flow给authority的时钟适配器在整轮到期/回退/异常时返回NaN，使authority永久失效，因此即使关闭定时器延迟，已领取token的HTTP请求也会被拒绝（503），时间恢复也不能复活。
- 可以把可信本地构建的 `nativePairingPresenter` 作为present；默认正常面板会前台显示，需要真实人操作。自动验收只用隐藏控件与 `--automation-deny`，不运行自动原生批准入口。恶意同进程仍能伪造本机回调，此流程不是OS级可信UI隔离。

## 实际整合检查

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$HOME/.cargo/bin:$PATH"
node --test probes/nsh-validation/pairing-flow.test.mjs
node probes/nsh-validation/verify-pairing-flow.mjs
```

`pairing-flow-fixture.mjs`只为测试生成短命P-256/SHA-256 CA/叶证书；0700临时根/0600私钥，保留系统TLS验证，不安装CA。不替代旧RSA测试夹具或生产证书方案。初轮LibreSSL默认SHA-1签名被Node正确拒绝，现显式SHA-256；不降低TLS安全等级。

验收器编译 `PinnedTLS.swift + Bootstrap.swift + PairingFlowCheck.swift` macOS测试peer，真实HTTPS claim、自算摘要、固定redeem；Node本机flow将同一摘要绑定到reviewer。批准路径仅测试回调程序化批准及Swift程序化acknowledgeComparison，不是人类核对；凭据只在Swift不透明内存对象内检查项目并清除，不导出token。拒绝路径真实调用AppKit子进程自动拒绝，再由原生peer确认无法领取。文件IPC仅用于临时材料/摘要/继续标志，不交接receipt/token；不打印材料或原始网络载荷。

单测另覆盖：重复begin/review、远程claim不触发展示、批准前409、HTTP confirm不存在、项目数组变更不扩权、一次redeem、越项目拒绝、close停止token接口、拒绝/恶意响应/关闭/过期/回退时钟/挂起presenter及晚到approve。Node测试credential只在测试进程使用，不与Swift凭据导出混淆。

报告标志：`nativeClaimOverHTTPS:true`、`nativeRedeemOverHTTPS:true`、`nativeProcessDenialBound:true`、`automatedApprovalOnly:true`；`phoneVerified:false`、`humanConfirmationVerified:false`、`windowShown:false`、`systemTrustChanged:false`、`taskServerConnected:false`、`credentialsPersisted:false`。这些为验收目标，实际通过/失败以本轮operatelog及忽略的results/flow-*日志为准，不把报告字段存在算成功。测试peer退出未完成则保留临时目录并报错，不删除其运行文件。

仍缺：用户发起GUI/项目选择器、可信手机双端显示、材料真实性与分发、邀请转发/社会工程/UI仿冒/比较疲劳/DoS安全评审、人工首次信任验收、NSH桥与手机集成、安全存储、长期锚提升/轮换、撤销与活动任务策略、PI鉴权任务。未整合旧GET `/trust-check` 探测：这条流程直接以固定HTTPS claim走相同专用锚+hostname/链/时间/叶pin验证，不声称旧探测已接通。全仓历史失败不是本次已修复；不以整合检查成功勾选N01。
