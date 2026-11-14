# N01｜原生受限 HTTPS 配对请求检查点

基础 `a0f82ff` 加本次提交前工作区；arm64/macOS27.0.1、Swift6.4、Node22.22.0。**N01整体未完成，不是手机配对可用版或人工首次信任交付。** 正式沐码/用户数据/手机模拟包/系统信任均未改变；不签名、安装、部署或开放LAN。

## 范围与安全边界

- `N01PinnedProbe` 保留默认仅 GET `/trust-check` 模式；新增显式原生 pairing 模式，只能 POST `/v1/pairing/claim` 或 `/v1/pairing/redeem`。精确三字段或两字段、小写64位hex、4096字节body上限，验证后重新编码。URL拒绝user/password/query/fragment，匹配policy host；候选只从已严格解析的回环origin派生固定路由。底层原语不提供完整origin端口锁，固定端口由候选私有endpoint保证，不能直接作为任意TSX网络桥。
- 继续使用专用CA、主机名/链/有效期、叶DER SHA256联合验证；ephemeral会话、TLS≥1.2、无cache/cookies/credential store、5s/8s界限、4096字节响应、拒重定向、每实例一次请求。原NSH桥仍只注册trustCheck及cancelTrustCheck，**没有注册配对handler或新增JS能力**。
- `N01BootstrapCandidate.claim()` 每候选仅一次，内置随机nonce，Swift独立重算绑定origin/CA/叶pin/邀请/claim/nonce的摘要；receipt不透出对象。解析精确字段、版本/类型/随机字段/状态，拒转义key、重复key、坏JSON、未知字段和错误摘要。仅返回完整摘要供未来可信双端比较，**摘要相等不是身份认证**。
- `acknowledgeComparison()` 是可信原生调用边界，当前仅测试程序调用，**不是人工比较UI，也不是抗恶意同进程调用的安全隔离**。未调用时redeem不发HTTP。正确本地比较仍不能绕过Mac端approve；HTTP409仅表示等待，最多四次显式redeem，无自动轮询/重试。错误比较关闭候选。
- 成功redeem严格检查deviceId/token/整数有效期（≤1h）/非空唯一项目数组（≤8）。只返回原生内存不透明凭据对象，私有token无getter/序列化/JS/任务接口；可重复清空，并提供本地有效期标记（**不是远端授权或撤销查询**）。成功、非409失败、取消、歧义网络响应均关闭原候选，不盲目重领已消费receipt；丢失响应须重新配对。字符串清空不承诺物理内存擦除。
- 不提供长期锚提升或安全持久化；凭据对象尚无可信Host身份/跨重启存储/PI授权绑定，不得据此接生产任务。取消只停止本地URLSession，**不撤销已经到达服务端的claim**；服务端残留pending靠短期过期/拒绝处理，不伪造分布式回滚。

## 实际验收

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$HOME/.cargo/bin:$PATH"
node probes/nsh-validation/verify-pairing-network.mjs
node --test probes/nsh-validation/pairing-network.test.mjs
```

原生Swift进程向真实`startPairingHost`发出claim及redeem，测试程序经可信本机API读取pending，比对Swift摘要后confirm；**该confirm是程序化测试，不是人工Mac确认**。只有该自动批准后才领取凭据。主流程的secret/claim/receipt/token全部经真实TLS，不再以文件代替传输；私有测试文件仅交接比较值与测试继续标记，不输出秘密或原始HTTP。临时根0700/文件0600，finally删除CA私钥/材料/IPC，关闭本次子进程和端口。

首轮原生 **40项断言通过**：未claim/未本地比较/未Mac批准不能取得凭据；正确链/摘要/项目成功领取一次；重复claim/redeem拒绝；错pin不到HTTP，错误摘要/未知字段/bool版本/重复字段/MIME/重定向/超大/坏JSON关闭；错误比较、四次pending上限、非法credential字段关闭；并发拒绝、活跃取消/重复取消/Task预取消。故障服务实际请求计数验证不重发；活跃取消导致 **1个响应前断连**。iOS15 arm64 **仅typecheck**，未链接/注册/装机/运行。

范围标记：`claimSentOverHTTPS:true`；`phoneVerified:false`、`humanConfirmationVerified:false`、`credentialsPersisted:false`、`nshBridgeVerified:false`、`systemTrustChanged:false`、`taskServerConnected:false`。日志位于忽略的`artifacts/nsh-validation/results/pairnet-*.log`。最终NSH Node专项10/10，独立原生40项通过；完整核心串行246/246（327.8s），默认并行231通过/5失败/10取消，Electron103通过/1失败/9跳过；Rust因本机toolchain为空及同步DNS失败受阻。TLS15项、Catalyst桥21项、NSH check及headless/macOS各8/8、文档122/122。全仓验收未全通过；完整回归及任何失败如实见operatelog，不把重跑成功当历史失败消失。

## 后续依赖

先实现可信用户发起流程、双端独立显示与人工比较/Mac确认UI，并评审邀请复制竞争、转发/社会工程、材料真实性、DoS和证书轮换；不能因自动测试通过直接开放LAN。`pairing-host`仍无`/trust-check`，生产整合前须明确一个协议版本及服务边界。尚未接NSH配对桥、手机前后台/取消生命周期、材料UI/扫码、安全存储/重启恢复、长期信任提升、撤销传播和PI项目授权；已安装手机仍旧无网络模拟包，未来更新需说明身份/权限/数据影响并获授权。

历史`BOOTSTRAP-CHECK.md`的42项及`claim没有走HTTPS`描述保持其当时验收范围；本页新增的是另一条真实原生HTTPS配对验收，不将旧证据改写为手机成功。
