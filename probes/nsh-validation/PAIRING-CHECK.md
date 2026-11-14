# N01｜隔离HTTPS配对生命周期与首次信任设计

2026-11-14，基础 `41fcb6b` 加本次提交前工作区；arm64/macOS27.0.1、Node22.22.0。本轮只实现和验证 **Node回环HTTPS配对状态机**，不改变正式沐码/数据/手机包/系统信任。**N01整体未完成；首次信任仍未实现，不能称安全手机配对已交付。**

## 实现范围与复现

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$HOME/.cargo/bin:$PATH"
node --test probes/nsh-validation/pairing.test.mjs
node probes/nsh-validation/verify-pairing.mjs
```

- `pairing.mjs`：独立内存authority，32字节随机邀请/secret/claim/receipt/device/token；只保留secret/receipt/token的SHA256摘要，固定长度比较用timingSafeEqual。没有自造加密协议；传输用标准TLS，摘要不是身份认证或TLS替代。
- `pairing-host.mjs`：**只listen(0,'127.0.0.1')**，专用临时CA签发叶证书，校验CA标记/叶签名/IP SAN并从实际证书DER提取SHA256。authority不接受客户端提供的服务器身份。允许路径仅下列3类，无任务/文件/截图/模型接口，不接原PI Host，不接NSH/Swift或task-client。
- `POST /v1/pairing/claim`：精确 `{invitationId,secret,clientNonce}`，均32字节hex；邀请最多120s，一次正确claim原子消耗，竞争请求仅一个成功。返回pending/claimId/receipt/transcript，**不返回设备token**。
- 本机进程内 `pending/confirm/deny`：待确认信息只有claimId与transcript（没有receipt或secret），confirm必须精确匹配transcript，并从本地项目白名单选非空子集。**没有HTTP确认/邀请/撤销接口**。这是可信宿主API，不是任意JS/网页可调用接口；目前没有GUI或真实人类确认，测试用可信本机函数模拟。
- `POST /v1/pairing/redeem`：精确 `{claimId,receipt}`，未确认409；确认后才一次性签发token及项目范围，响应no-store。响应丢失不重发凭据，必须重新配对；过期/拒绝/已领取receipt不能重放。
- `GET /v1/projects/<id>/check`：仅验证Bearer凭据和本地批准项目。未知/过期/撤销token401，非授权项目404。不返回服务器路径、模型配置、其他设备或资源信息。
- 邀请和待领取状态合计最多8、有效设备最多8；邀请/claim共用原邀请截止时间，不因确认延期；凭据最长1h，无刷新，过期重新配对。本机撤销按随机deviceId删除，只影响目标设备。默认performance.now单调时钟，回退/非法时钟或close全体失败关闭。
- 全HTTP请求启动以来最多64（含坏请求），耗尽429且不自动重置；请求体4096字节、仅application/json、精确字段、无query凭据、Origin/cross-site拒绝、无CORS、TLS≥1.2/请求10s/头5s、connection close。它是有界验证器，不是生产DoS防护/服务配额；TLS握手连接洪泛、上传慢请求仍须生产层审计。
- 状态仅内存，重启令旧凭据全部失效，不读写正式数据，不写设备数据库或私钥持久化，不提供无声自动重新配对。关闭清理状态/连接/端口；验收临时目录/CA及私钥全部删除，不输出秘密或原始HTTP载荷。

## 首次信任设计：尚未接入，不能跳过

现有Swift专用URLSession需要可信锚+主机名/链/时间+叶DER pin。**二维码、URL、名称和扫描结果都是不可信输入**；把二维码的锚直接当长期可信或只比较它自己携带的hash，不能证明是用户的Mac。

待实现的流程：

1. 用户在可信Mac界面主动发起短期邀请；二维码承载版本、固定TLS origin、专用CA公有DER（或可校验的有界交付方式）、CA与叶DER SHA256、邀请ID/secret及短期有效提示。**CA私钥、设备token、模型密钥永不进入二维码**，secret不放URL/query/系统浏览器/分析日志。当前invite仅返回指纹，没有交付CA DER/二维码解析器，所以不能直接当作可扫码材料。
2. 手机对材料严格限长/结构/版本/有效提示/地址校验，必须经专门的用户发起配对界面，不能用deep link静默安装策略。新锚只可成为临时隔离候选，不替换已配对身份、不访问任务、不存长期信任；所有请求仍校验候选CA链/hostname/time及leaf pin，绝不关TLS验证或装系统CA。
3. 手机用随机clientNonce发claim，Mac与手机分别显示同一个完整transcript（或经独立安全评审的比较呈现），**用户在Mac确认前逐项比较并选择项目**。本轮transcript是版本/origin/CA指纹/叶指纹/邀请ID/claimId/clientNonce固定数组的SHA256，绑定候选身份及此次claim，但哈希本身不是签名、设备证明或“看过二维码就可信”。如果手机显示的是攻击者Mac，该transcript不能匹配真实Mac待确认项；不匹配立即拒绝，不自动改配。
4. 真实Mac明确确认后，只有持原receipt的会话可以领取一次设备token；手机在固定原生受限传输内保存所确认的身份，凭据不进入任意TSX调用/日志或WebView。收到token不自动执行任意任务，任务仍需版本化协议与设备/项目/任务归属。未来持久化/备份/凭据清理方案须独立实现验收。
5. 邀请secret或receipt被复制会造成竞争/拒绝服务，二维码不证明手机身份；本原型token是Bearer，非硬件绑定/客户端证书，持有者即拥有该范围权限。双端确认不得把设备自报名称当身份，二维码泄露、社会工程、对等转发及手机被攻陷不在本轮已解决范围内；生产需独立安全评审。
6. 身份/pin变化、过期、撤销、网络歧义、进程重启均显式失败；不得回退系统根、自动接受新证书或无限重试。授权证书轮换/迁移/撤销传播以及已在执行任务是否停止还未设计实现。当前撤销只阻止后续鉴权，不取消已接受业务（本服务没有业务任务）。

该流程目前**只有authority生命周期和HTTP边界实现**；缺手机解析器、原生候选策略隔离、双端可信显示/人工比较、Mac确认UI、CA分发和完整攻击模型审查。不能仅有自动确认测试就开放LAN或更新手机包。即使TLS在Mac测试通过也不证明iPhone首次信任正确。后续候选准备好须说明身份/本地网络权限/数据影响并另获更新授权。

## 本机实际验收

`verify-pairing.mjs`创建临时CA、localhost/IP SAN叶及另一CA，仅随机TLS回环端口。HTTPS客户端使用显式专用CA、正常checkServerIdentity并额外比叶DER pin，不关闭rejectUnauthorized；错CA/错pin拒绝。真实HTTP验证邀请竞争只成功一个、无token pending、HTTP不能confirm、错误transcript/receipt拒绝、确认后单次领取、项目隔离、无凭据拒绝、撤销立即拒绝、凭据/邀请精确边界过期、跨源/坏JSON/超大/媒体类型/请求预算拒绝，以及幂等关闭/端口不可再连接。

初轮测试4/5，真实HTTPS因系统openssl默认自签证书不带CA:TRUE被本地预检拒绝；**保留失败**，给测试CA显式critical CA/keyCertSign/cRLSign配置后5/5通过。独立实际验收exit0，仅输出脱敏结果：`phoneVerified:false, humanConfirmationVerified:false, nativeBootstrapVerified:false, systemTrustChanged:false, piTasksConnected:false, credentialsPersisted:false`。这不是人工GUI、NSH桥、iPhone或LAN验收。

测试还覆盖严格字段/类型、授权范围副本不可变、另一设备不受撤销影响、邀请/pending/approved过期、拒绝释放容量、状态上限/重启失效/时钟回退失败关闭及禁止LAN配置。日志位于忽略 `artifacts/nsh-validation/results/pairing-*.log`。本轮全量回归见operatelog，既有核心并行/Electron问题不在本原型中修复。

下一依赖仍是先实现和评审原生首次信任及可信双端确认，再接设备授权到PI任务；不能把预置CA和程序化confirm当成完成了这一步。所有产物隔离，源码推送不等于部署。
