# N01 Mac Host 依赖检查点｜2026-11-14

用户“好的 继续”授权后，按依赖先完成独立Mac端真实PI/本地模拟模型、受限TLS协议检查。基础提交 `5e536eb`；以下证据对应本次提交前工作区。系统arm64/macOS27.0.1、Node22.22.0、PI SDK1.5.0；不是iPhone端到端验收，不更新手机或正式沐码。

## 实现范围

- `host.mjs` 复用现有 `runPiSdk`、Store/Scheduler及本地fixture，不另造模型内核。每次启动仅创建系统临时目录下的两个项目、两份会话和SQLite/PI数据；正常关闭取消活跃任务、等待工具子进程退出后删除临时数据。不读取正式用户目录/密钥、不开桌面或图片工具。
- HTTPS仅绑定 `127.0.0.1` 随机端口、最低TLS1.2；调用方显式提供独立key/cert，测试客户端显式信任该证书且正常核对主机名，**不关闭TLS证书验证、不向系统安装CA**。没有LAN监听选项。不是手机证书信任方案，更不是可直接上线的远程控制服务。
- 每次启动两个随机256位临时token分别只拥有固定项目/会话；全请求验证token及任务归属，拒绝Origin/cross-site，无CORS，无模型密钥返回。token仅在内存返回给本机测试调用者，不打印/写文档。这是预置测试主体，不是二维码配对/首次确认流程；尚无撤销、过期和长期设备身份。
- 版本1 JSON接口：POST `/v1/tasks`，仅接受`{requestId, scenario}`；scenario仅write/hold。前者驱动本地模型fixture让真实PI写临时result.txt并执行验证命令，后者启动临时长任务以验取消。不能提交任意提示、路径、模型或命令；不承诺现有工具具有OS文件沙箱。
- GET `/v1/tasks/<id>?after=<cursor>` 返回当前任务及最多100条事件、cursor/hasMore；客户端断连不会自动取消任务，新连接用同一认证身份从游标继续，不重放开发任务。POST相同requestId/同scenario返回原任务，不同scenario返回409。幂等映射仅存于当前宿主内存，**不支持重启后的恢复/去重**；临时宿主重启不接续旧任务，崩溃恢复待做。
- POST `/v1/tasks/<id>/cancel`仅取消本主体任务；同项目串行、不同项目并行。请求体4KiB、总任务上限32（含已完成，需结束本次验证再开新实例）、每次执行上限10分钟、HTTP超时有界。事件总存量/工具输出仍沿用现有Store，未交付完整内存配额或抗恶意调用审计。

## 执行与真实验收

仓库根先使用既有Node，无新增依赖；`npm test`已加入本目录 `*.test.mjs`，不改正式构建入口。

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$HOME/.cargo/bin:$PATH"
node --test probes/nsh-validation/host.test.mjs
node probes/nsh-validation/verify-host.mjs
```

- 新增2项测试均通过（最后2/2，约2.6s）：不信任证书/错误主机名被拒；无效认证、跨主体读/取消、Origin、错误路由/字段/场景/类型/JSON、超大体、错误Content-Type拒绝；幂等冲突与32任务限额。真实PI测试验证write/bash工具和text_delta、临时文件内容、同项目排队/排队取消、其他项目执行不受阻、取消仅终止持有任务工具子进程、重新认证游标查询、相同请求不重复执行、宿主关闭清理活跃子进程/临时项目及端口。
- 独立实际验收 `verify-host.mjs` exit0：真实PI SDK经TLS认证请求，工具write/bash均非error，磁盘文件N01_OK与流式文字“完成 N01_OK”匹配、状态succeeded、幂等/游标成立。输出明确phoneConnected=false/externalModelUsed=false/productionDataUsed=false；本地模型是确定性模拟，不称真实商业模型推理。验收结束临时host关闭，不留后台局域网服务。
- NSH check exit0；headless4/4、macOS AppKit4/4，本轮未改UI、未重签/重装手机，依然保留capabilities={}和无用statusBar权限警告。
- `npm test`默认并行238项：237通过/1失败（desktop-tools.test.mjs:492几何漂移断言预期DESKTOP_FOCUS_CHANGED、实际helper超时）；随后全核心串行238/238通过，不能据串行结果声称已修复并行时序问题。
- `npm run test:electron`：113项103通过/1失败/9跳过，既有`ctx.on is not a function`仍在，缺隔离构建输入项未补；`cargo test --release --offline --manifest-path probes/m01/desktop/src-tauri/Cargo.toml`11/11。Python文档检查数量/结果见本轮operatelog。全仓验收未全通过，N01不勾选。
- Git忽略证据 `artifacts/nsh-validation/results/`：host-initial.log、host-final.log、host-acceptance.log、n01-host-core.log、n01-host-core-serial.log、n01-host-electron.log、n01-host-native.log、check-host.log、headless-host.log、macos-host.log。

## 手机接入尚未完成

现装iPhone App仍是原无网络模拟UI，以上客户端是Node，不是手机。尚未建立NSH iOS侧可信HTTPS/证书方案、配对/设备撤销/资源授权、手机流式界面及停止任务的端到端链路。不得把Node TLS回环测试、游标重连或用户上轮模拟发送当手机连接Mac验收。下一步需先核实NSH iOS TLS/API与可安全分发的信任材料，再实现手机网络能力（明确最小权限）、认证配对和断连恢复；不用明文LAN控制服务或关闭校验绕过阻塞。任何新手机包更新均需保留独立身份/数据边界，正式桌面沐码不动。
