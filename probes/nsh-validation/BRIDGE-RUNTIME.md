# N01｜NSH → Swift → 受限 HTTPS 实际运行（Mac Catalyst）

2026-11-14，基础 `f693e54` 加本次提交前工作区，arm64/macOS27.0.1、Xcode27.0/Swift6.4、NSH0.5.0(f4d68f7)。**Mac Catalyst 后台宿主实际运行通过，不是 iPhone 联网验收。** 未改正式沐码、正式数据、原手机模拟包或系统信任，未申请profile、开发签名、安装手机包、下载模拟器或开放LAN。

## 实现与复现

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$HOME/.cargo/bin:$PATH"
node probes/nsh-validation/verify-bridge-runtime.mjs
node probes/nsh-validation/verify-pinned-tls.mjs
node probes/nsh-validation/verify-ios-bridge.mjs
```

- 使用上一检查点已下载的官方 `nsh-embed-ios.zip`，重核整包SHA256 `2bd3b84ffa72e6fd302b6e1722995cc1800270243f513111b13a2f291d63cd7d`。仅提取 release Catalyst `Versions/A/` 下4个普通文件，逐项拒绝路径穿越/链接，扁平布局，不恢复zip内符号链接，不修改工具链版本或根依赖。依赖既有xcodegen和Xcode。
- `verify-bridge-runtime.mjs` 在忽略目录生成3个NSH字节码包和独立UIKit场景宿主；`BridgeRuntimeCheck.swift` 实际注册 `PinnedTLSBridge.swift` 中的处理器。字节码放入本次App资源（框架不允许从任意外部路径加载原始字节码），测试配置/存储各用独立0700目录。
- 宿主 ID `dev.muma.probe.nsh.runtimecheck`，只在忽略目录临时构建并ad-hoc签名；这是Mac测试App，不是手机开发签名/安装。以 `open -W -n -g -j` 后台启动，创建非key窗口以驱动NSH引擎，不激活或操作正式应用。隐藏窗口没有驱动引擎，不能当无UI/headless运行。没有截图/人工GUI验收，也不需要桌面控制权限。
- Swift可信配置注入本次临时CA、叶DER pin及固定回环endpoint，JS不能传任意URL/证书/凭据。原NSH UI与task-client仍未接此桥。无Authorization，无设备token，无配对。
- 原桥新增精确 `n01.cancelTrustCheck`：只收空参数，取消当前该桥实例的探测请求，返回version/cancelled；不影响其他实例。`N01PinnedProbe` 新增线程安全、幂等取消及Swift Task取消联动；取消先于开始时不会创建请求。忙状态直到原调用收尾才释放。**JS host.call 等待超时不自动等于native请求取消**，必须显式调用取消handler或由可信宿主取消；生产任务恢复/销毁生命周期尚未交付。
- 测试只监听127.0.0.1随机TLS端口，固定GET `/trust-check`，原链/主机/时间/锚/pin校验均保留。退出关闭连接/端口，删除CA/服务器私钥和证书；保留脱敏reports及构建日志。看门狗仅按本次记录PID并核对精确可执行路径后终止本次runner，不匹配/不结束其他应用。

## 运行结果与失败保留

最终运行日志 `artifacts/nsh-validation/results/bridge-runtime-final.log`；前一成功轮 `bridge-runtime-eighth.log`，产物 `bridge-runtime/run-WMAfKF/`。脚本输出 `phoneVerified:false, systemTrustChanged:false`。

三组NSH真实 `host.call` 共 **21项断言通过**（good15、wrongpin2、denied4）：

1. 正确专用信任得到固定 `{version:1,status:"passed"}`；错误参数（含恶意endpoint）拒绝。
2. 未授予函数和未授予trust/cancel能力得到 `ERR_ACCESS_DENIED`；授予但无handler得到 `ERR_NSH_HOST_ERROR`。
3. 活跃调用期间重复调用拒绝，成功后可再调用；错误pin只返回泛化错误，不泄露URL/证书诊断，不到HTTP。
4. 显式取消活跃请求，原promise拒绝；重复/空闲取消返回false；取消后能发新请求。
5. 最后请求在原生5s请求/8s资源边界内失败、JS等待上限10s，不留下无限请求。服务端HTTP共 **3**（成功、取消、超时），其中 **2** 在响应前断开；无额外重试/重定向/任意路径请求。

`verify-pinned-tls.mjs` **15项通过**，在原13项之外新增开始前取消幂等性、Swift Task预取消不发请求；HTTP仍 `[1,1,1]`。iOS15 Swift6 typecheck通过不是iOS15实测。更新桥与取消代码的 `verify-ios-bridge.mjs` 未签名iOS arm64构建再次通过，仍 `bridgeRuntimeVerified:false/phoneInstalled:false`（该设备构建样本未注册handler）。

保留尝试过程，不将失败改成成功：初轮Swift顶层入口限制；第二轮命令70s超时被工具终止；第三轮iOS15不可用的新sleep API；第四轮直接执行UIKit二进制未正常启动、40s看门狗结束；第五轮LaunchServices启动但macOS27强制场景生命周期导致SIGTRAP；第六/七轮场景宿主隐藏窗口未驱动NSH，25s失败；第八轮改后台非key可见窗口后成功。最终轮补自动提取、启动/错误检查点及精确PID清理后重新验收。原始结果留 `results/bridge-runtime-{initial,second,third,fourth,fifth,sixth,seventh,eighth,final}.log`。构建有Supported platforms、AppIntents metadata及官方静态库缺原构建机调试对象警告；保留完整build.log，不冒称无警告。

## 回归及剩余依赖

- NSH check exit0；headless8/8、macOS AppKit8/8；native11/11。
- 默认核心238项234通过/1失败/3取消（PI代理超时及既有桌面几何helper超时）；完整串行首轮236通过/2取消，第二轮 **238/238**（126.1s）。保留时序失败，不声称修复并行。
- Electron113项103通过/1失败/9跳过：既有 `ctx.on is not a function`，部分缺隔离构建输入，**全仓验收未全通过**。不为探针修改正式工程。
- 文档检查和最终审计记录见operatelog；文档静态检查不是桥运行验收。

**N01整体未完成。** 本检查点解除Mac上的桥实际运行未知，不代表iPhone系统网络/前后台/本地网络权限或设备运行通过。手机原包仍是无网络内存模拟。下一步：安全首次信任材料与Mac确认、设备token签发/过期/撤销/归属，再适配受限任务传输；任务流式/停止/断连/重启恢复及完整业务/性能基准仍未完成。可验收手机候选准备好后，说明身份/权限/影响并获得更新授权才安装，不盲目重跑历史安装脚本。
