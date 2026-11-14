# N01｜可信本机配对确认面板候选

范围：隔离Mac原型，不是手机首次信任完成版。基础c6a59ed加提交前工作区。正式沐码/数据/手机包/系统信任不变，不部署/安装/开LAN。

## 实现与边界

- `pairing-review.mjs`仅可信本机调用，绑定来自authority.pending的claimId及完整transcript、不可变项目快照、随机requestId、最多60秒有效期；只允许一个确认，精确响应schema/版本/请求及摘要绑定。批准返回后重新查询pending，authority再次校验过期及项目范围。拒绝、关窗、错误、超时、取消及stale view均不能批准；失败清除该claim。close会中止等待，不允许晚到回复授权。
- `PairingReview.swift`是独立AppKit原生面板：显示固定Mac回环端点、完整64位摘要（8组）、拟授权项目、非可信设备及转发社会工程警告。不显示secret/receipt/token，不允许自由设备名或富文本注入。默认未勾选，批准禁用；Return默认拒绝，关窗及超时拒绝。字符串/字段/版本/期限/项目/端点均有界验证，禁重复或转义key。
- `PairingReviewMain.swift`正常运行需要本机stdin传入受限snapshot，显式显示原生窗口（可能切到前台），stdout只有绑定decision。非网络服务，无JS handler。`pairing-review-native.mjs`将同一snapshot通过子进程私有stdin交给面板，有输出额度/定时器/AbortSignal，只返回受限结果给reviewer验证；不能用手机或网页指定可执行文件。`--automation-deny`只用于自动测试拒绝，不能自动批准。
- 回调/本机API不是操作系统级可信UI隔离；恶意同进程仍可伪造decision。受限项目由可信调用者选择，原生面板原样显示且不可扩大；未实现用户发起的完整配对入口/项目选择器、手机对应显示、材料分发/扫码、可信身份引导、安全存储或长期锚提升。本机看见摘要和勾选并不能证明用户实际核对了另一端。
- 当前没有将面板接入已装NSH App、任务Host或手机。可由后续可信宿主把`reviewer.review({claimId,projects,present:nativePairingPresenter(可信本地编译路径)})`接到自己的邀请/claim生命周期；不能把任何远端HTTP请求直接映射为本机approve。HTTP层仍无confirm/invite/revoke入口。

## 复现与证据分类

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$HOME/.cargo/bin:$PATH"
node --test probes/nsh-validation/pairing-review.test.mjs
node probes/nsh-validation/verify-pairing-review.mjs
```

验收器临时编译原生程序，构造隐藏NSPanel、调用真实控件方法测试禁用/勾选/取消/默认按钮/过期/重复及字段拒绝，另跑Node authority→reviewer→私有stdin→原生自动拒绝→pending清除。不会打开前台窗口或截图，不需要桌面控制授权；是AppKit控件自动化，不是人工GUI/双端核对，更不是iPhone实机证据。临时编译目录finally清除，报告不含秘密。专项/全量结果与失败记录见operatelog及忽略的`artifacts/nsh-validation/results/review-*.log`。

范围标志：`humanConfirmationVerified:false`、`phoneVerified:false`、`windowShown:false`、`tlsConnected:false`、`trustPromoted:false`、`credentialsIssued:false`。Node状态机批准测试是程序化内存调用；原生子进程集成仅自动拒绝。原生HTTPS40项仍是另一层证据，不把层间独立成功改称手机端到端。

N01保持未完成。下一步需要把用户发起/两端可信显示接入完整候选链，人工操作独立验收；评审邀请复制/转发/中间人、比较疲劳及UI仿冒、并发pending和崩溃恢复，再考虑授权手机更新及LAN。当前不提升信任、不签发生产权限。
