# N01｜原生短期候选信任与配对摘要绑定

2026-11-14，基础 `6f7c261` 加本次提交前工作区；arm64/macOS27.0.1、Node22.22.0、Swift6.4。**仅原生解析/候选隔离/配对摘要一致性，不是完整首次信任交付或iPhone验收。** N01整体未完成，正式沐码/用户数据/手机模拟包/系统信任均未改；不安装、不签名、不开放LAN。

## 复现与数据边界

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$HOME/.cargo/bin:$PATH"
node --test probes/nsh-validation/bootstrap.test.mjs
node probes/nsh-validation/verify-bootstrap.mjs
```

- `bootstrap.mjs` 仅提供可信Mac本机调用的 `encodeBootstrap(invitation, caDER)`；将前一轮authority的邀请和专用公有CA DER编码成不超过8192字节的ASCII材料。检查精确字段、版本、回环origin、CA标记与DER摘要、邀请期限及随机字段；不输出材料、不提供HTTP或URL导出接口。**不是二维码生成器/扫描器，不承诺容量适合单张二维码**；相机/分片/复制UI未做。
- 格式 `N01BOOT1`，严格8行（无尾换行）：标记、origin、公有CA DER标准base64、CA SHA256、叶DER SHA256、invitationId、secret、validForMs。无JSON重复key/未知字段或转义歧义，只允许ASCII可打印非空白字符和行分隔；秘密不在URL里。CA私钥、模型密钥、设备token永不进入材料。
- `Bootstrap.swift` 的 `@MainActor N01BootstrapCandidate` 持有独立私有policy与短期状态；固定localhost/127.0.0.1显式端口1..65535（不收默认443），无LAN/域名扩展选项，拒user/password/path/query/fragment、非规范base64/数字、非小写64位hex、无效证书DER或CA摘要不符。Mac编码器验证CA标记；Swift解析检查可解析DER及摘要，最终链/主机/时间/pin由Security实际TLS信任评价负责。**可解析DER不是已确认CA身份**，摘要由同一不可信材料携带也不构成身份证明。
- 最长120s本地候选时间，使用systemUptime，精确边界过期/时钟回退/非法时钟失败关闭，原Mac邀请期限仍独立裁决。收到材料时启动本地倒计时并不能证明材料新鲜；旧材料在Mac端过期后仍不可领取。系统挂起/恢复的用户体验及跨设备时钟尚未验收，不能把本地计时当认证时间戳。
- 只可一次 `probe()`，复用原N01PinnedProbe：固定无凭据GET `/trust-check`、ephemeral、正常链/主机/有效期+叶DER pin、拒重定向、4096字节/5s请求/8s资源限制；探测成功仍是未确认候选。`cancel()`取消活跃probe并清空邀请字段，无候选替换或全局信任修改。独立实例不共享policy/状态。Swift字符串清空不承诺物理内存安全擦除。
- 一次 `claimBody()` 用SecRandomCopyBytes产生clientNonce，仅生成精确三字段JSON，清空内部secret；**本轮没有原生发送claim、领取token、存储或task-client构造函数**。调用方需保护返回的敏感Data，未来不能透出到任意TSX/日志。
- `comparison(claimID, serverTranscript)` 使用同一固定数组 `[1,origin,caHash,leafHash,invitationID,claimID,nonce]` 的规范JSON（不转义斜线）SHA256重新计算；服务器给出的摘要不直接当可信。错摘要/缺claim/失效候选立即关闭，随后正确摘要也不能恢复。输出完整64位比较值仅供未来可信双端显示，**不是缩短安全码、MAC、签名或设备认证**。
- 没有promote/持久化/信任替换/任务权限接口。即使本机函数测试摘要正确，也不能据此自动确认或签发凭据。须先做可信UI中用户发起配对、独立双端显示/比较及Mac确认；仅有哈希不能解决复制邀请、转发/社会工程或受攻击设备问题。

## 实际验收与明确未验内容

`verify-bootstrap.mjs` 生成独立CA与localhost叶，编码真实authority邀请，编译并运行Swift6原生检查；同时iPhoneOS SDK arm64/iOS15目标typecheck（不是链接/安装/设备运行）。初轮40项通过，增强版加入精确过期及claim前比较关闭等，**42项原生断言通过**。

覆盖：超长/空/非ASCII/多行/空白材料，错误版本、HTTP/LAN/域名/默认443/端口溢出/前导零/路径/用户密码/query/fragment，坏DER/base64/指纹/邀请/secret/期限；预取消/重复取消、时钟回退/NaN、精确期限、重复探测/claim、claim前比较、错误摘要不可恢复；实际Mac URLSession成功、错pin拒绝后不可claim、另一候选成功不受影响。

服务端只收到 **2** 个无Authorization GET `/trust-check`，错pin未到HTTP。Swift生成随机nonce的claim体由测试用0700目录/0600文件私有交接给Node，Node调用**真实authority的内存claim函数**生成pending，然后Swift独立校验摘要一致。**claim没有走HTTPS**，不称原生配对网络端到端，也没有调用confirm/redeem。临时信任材料/claim文件/CA私钥全部在finally删除；脚本不打印材料/摘要或HTTP载荷，系统信任不变。测试过程完全是命令行原生运行，无NSH/Catalyst UI或人工GUI操作。

初轮默认回归243通过/2取消，串行244通过/1取消；增强后默认233通过/3失败/9取消，其中本轮新增测试夹具曾在高负载下读取尚未写完的response.json空文件（NSCocoaErrorDomain3840），不把它归为既有失败。已将Node响应改为同目录临时文件完成写入后rename，Swift claim也用atomic写入；没有放宽任何候选/TLS校验。修正后专项2/2、独立原生42项通过；默认核心227通过/6失败/12取消（新增用例通过），最终串行242通过/0失败/3取消（PI adapter超时），Electron103通过/1失败/9跳过，native11/11、NSH check/headless8/8/macOS8/8、文档121/121。全仓验收未全通过；完整重跑与失败见操作日志，失败日志保留。

输出诚实标记：`phoneVerified:false, humanConfirmationVerified:false, trustPromoted:false, nshBridgeVerified:false, claimSentOverHTTPS:false, systemTrustChanged:false, credentialsIssued:false`。完整自动测试还通过既有npm test入口运行原生验收子进程，临时目录相互隔离。日志 `artifacts/nsh-validation/results/bootstrap-*.log`；全仓回归及任何既有失败见operatelog，不以静态检查替代原生运行。

## 下一依赖

未交付：用户发起配对与可信双端确认UI、原生受限claim/redeem传输、CA材料UI/二维码交付、手机候选策略与前后台/权限、凭据安全持久化/重启恢复、证书轮换/撤销传播及PI任务授权。候选探测只用独立测试服务；现有pairing-host无 `/trust-check` 路由，尚未集成为一个服务，不把两套探针称为已连通。手机原包仍无网络模拟，候选包准备好后须说明身份/权限/影响并获更新授权才安装；不因本轮42项通过跳过安全评审或直接开放LAN。历史PAIRING-CHECK.md“首次信任仍未实现”为当时及当前完整流程状态，本页只补其中原生候选层证据。

后续检查点：`PAIRING-NETWORK.md`新增原生固定HTTPS claim/redeem与内存凭据；本页42项/私有IPC/未签发凭据结论仅对应本页历史验收，不代表后来新专项仍未发送HTTPS，也不将新专项冒充人工或手机证据。
