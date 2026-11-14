# N01 手机传输前置检查｜2026-11-14

基础提交457e696加本次提交前工作区。当前iPhone已安装的0.0.1仍为无网络模拟界面。本轮未重签/安装/启动手机App、未申请系统权限、未修改系统证书信任、未开放LAN监听。N01整体未完成。

## 固定版本源码结论

核对NSH **v0.5.0**，不是main或未来版本：

- [networking.md](https://github.com/longbridge/nsh/blob/v0.5.0/website/docs/networking.md)：iOS fetch使用NSURLSession、支持Authorization、AbortSignal、响应流；原生请求无浏览器CORS约束，因此服务端认证/资源归属必需。拒绝重定向使用`redirect: "error"`。
- [net.rs](https://github.com/longbridge/nsh/blob/v0.5.0/crates/nsh-platform-ios/src/net.rs)：默认NSURLSessionConfiguration，NSURLSessionDelegate为空，未实现应用自己的server-trust challenge处理。[globals.d.ts对应的fetch实现](https://github.com/longbridge/nsh/blob/v0.5.0/crates/nsh-js/src/web/fetch.rs)和本机生成RequestInit无自定义CA/证书固定参数。不能把Node `ca`参数套进TSX fetch；二维码携带证书指纹也不会自动使系统信任证书。
- [sandbox-and-capabilities.md](https://github.com/longbridge/nsh/blob/v0.5.0/website/docs/sandbox-and-capabilities.md)：可以按host、port、schemes、methods、paths/pathPrefixes限制请求；网络能力授权不等于TLS信任，也不等于iOS本地网络权限。原始TCP net.connect没有TLS选项，本轮不在JS自行实现TLS或自造加密协议。
- [package.rs](https://github.com/longbridge/nsh/blob/v0.5.0/crates/nsh-cli/src/package.rs)：支持`ios.infoPlist`自定义键。后续局域网候选包需要明确NSLocalNetworkUsageDescription；若采用Bonjour再声明精确NSBonjourServices，不需要扫描时不授扫描/相机权限。现有忽略目录ios-ascii包Info.plist中无NSLocalNetworkUsageDescription/NSBonjourServices/NSAppTransportSecurity；本轮未更改该包。此项是静态检查，不是iPhone授权实测。

## 本次交付

`task-client.ts`为尚未接入UI的传输模块，调用方必须先提供通过未来配对流程确定的endpoint和token；模块本身没有完成配对，也不把任意二维码/URL当可信身份。

- 只接受HTTPS根地址，拒绝用户名密码/路径/query/hash；64位小写hex临时测试token不放URL。只生成固定的v1任务路由，不接收任意API路径。原生fetch保持系统证书校验，显式拒绝重定向，避免凭据随错误路由发送。
- submit/poll/cancel各只请求一次，10s超时且支持外部AbortSignal；无无限轮询、自动重试或自动重提任务。网络故障可能已提交，调用者必须保留相同requestId/场景显式重试；原Host只保证同一次启动内幂等，重启恢复仍未实现。
- 校验version=1、任务ID/状态、事件归属、严格递增cursor和最多100条事件、terminal与状态一致、hasMore空页错误。读完整并校验通过才返回新游标；限制响应1MiB，拒绝非JSON/坏JSON，避免不受限response.json内存分配。超过上限由调用者显示错误，不标任务成功。
- 错误仅返回固定code，不拼接token、endpoint、底层网络诊断或响应正文。认证失败、未找到、冲突、额度分别可辨；网络/TLS使用合并code，**不声称可靠区分离线和证书错误**。没有存储token/模型密钥/日志，没有接入App.tsx；nsh.json仍capabilities={}。

## 验证与边界

环境arm64/macOS27.0.1、NSH0.5.0(f4d68f7)、Node22.22.0。

```bash
bash probes/nsh-validation/nsh.sh check
bash probes/nsh-validation/nsh.sh test
bash probes/nsh-validation/nsh.sh test --target macos
node probes/nsh-validation/verify-native-tls.mjs
```

- check exit0；headless8/8、macOS AppKit8/8：原UI4项+新增客户端4项。客户端测试使用注入Fetch/真实Response流，覆盖端点/输入限制、单次提交及相同requestId重试、拒绝重定向选项、认证错误、取消、版本/任务/事件/游标验证、超大和非JSON响应；是协议测试，不是网络配对验收。
- 独立实际网络验收verify-native-tls.mjs exit0、原生NSH测试1/1：在忽略目录生成一次性项目，只授localhost随机TLS端口GET和精确路径；真实自签服务仅回环，原生fetch和实际task-client均拒绝不受信任证书，底层错误明确certificate invalid、客户端仅安全network_or_tls，服务端收到HTTP请求数0。证书/临时工程结束删除，未安装CA、没有关闭TLS校验。**这是macOS原生证书拒绝证据，不是iPhone TLS成功、配对或任务闭环证据**，也不证明可信证书下整个客户端已接通真实Host。
- 全仓回归状态在本轮operatelog记录；既有默认并行helper超时和Electron ctx.on失败没有借此修复，不声明全仓通过。
- 忽略证据：artifacts/nsh-validation/results/client-{check,headless,macos,core,core-serial,electron,native}.log、native-tls-check.log、native-tls-client-final.log。测试证书私钥及生成工程不提交Git，不输出任何真实凭据。

## 下一依赖及解除条件

在固定现成iOS运行时下，可信本地HTTPS尚无已验证的自动信任方案。可验证路线：①原生扩展提供应用内证书固定/专用CA及主机名校验（需独立构建、错误证书/轮换/撤销实测）；②隔离测试CA由用户在系统流程明确安装并信任，先说明影响和清理方法，由用户操作；③用户控制的可信域名/证书及局域网DNS方案（需要相应外部资源）。尚未选定或执行其中任何一种，不擅自安装全局CA、不使用公开域名指向用户私网、不关闭证书校验、不降级明文LAN服务。

先做①的原生扩展可行性验证，无需用户更改信任；如果固定运行时不能加载该扩展，记录构建依赖和阻塞。TLS路线成立后再做二维码发起、Mac首次确认、短期一次性配对码、设备token签发/撤销和项目归属，最后才连接NSH UI与Mac真实PI任务/流式/停止/断连；不能把测试预置token叫配对完成。手机新包仅在准备好可验收内容并获得对应更新授权后安装，正式沐码保持不动。
