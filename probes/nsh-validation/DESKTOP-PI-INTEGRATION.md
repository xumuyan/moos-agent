# N01-D1｜NSH 候选接入本机 PI

## 接入范围

正式版沐码的本地执行层调用 `packages/pi-runtime/sdk-runtime.mjs` 的 `runPiSdk`。隔离候选复用该入口与 `Store` / `Scheduler`，不复制正式 Electron 的页面、插件、配置或用户数据。

`DesktopView → desktop-ui-transport → NSH host.call → DesktopNativeBridge / DesktopPipe → desktop-host-stdio.mjs → Scheduler → runPiSdk → 回环模型夹具`。

- `DesktopPIHost.swift` 将现有视图挂到独立 Mac Catalyst 窗口，标识 `dev.muma.probe.nsh.piui`。普通候选仅暴露原六个 Host 方法；测试构建额外开放断开与报告两个本地钩子，不出现在普通包。本次不是 AppKit 发布包。
- Node 和 stdio 入口编译时固定；不接收渲染器传入的目录、凭据或进程参数。Host 创建两个临时工作区及会话存储，模型仅监听 `127.0.0.1`。只返回经过筛选的文本、工具名／状态等公开事件。此限制不是任意 shell 的 OS 沙箱。
- 继续使用原控制器的项目／会话归属及终态＋排空约束。EOF 收尾由既有 Host 取消、等待并清理独立运行时；本轮验证主动断开，不等同正常菜单退出、强退或异常父进程丢失验收。

## 本机复现

```sh
# 使用预置 Node 24.15.0、PI 1.5.0 和本地 NSH 0.5.0 (f4d68f7) Catalyst 工具链。
node probes/nsh-validation/verify-desktop-pi.mjs
node probes/nsh-validation/verify-desktop-pi.mjs --build-only
```

需本地 Xcode／XcodeGen、已校验的 `artifacts/nsh-validation/toolchain/` 框架、已安装依赖、图形登录会话及 owner 现有的 `desktop-ui-controller.ts` 和 `desktop-ui-transport.ts`。不下载依赖，不收编 owner 文件；因此不是干净检出的独立制品。默认以无艺术构建启动脚本测试窗口，不模拟键鼠；显式 `--art-root` 可使用本机已授权的 Maid Atelier 0.3.2（Small-tailqwq，CC BY-NC-SA 4.0），素材不入 Git。`--build-only` 只构建和校验临时 ad-hoc 签名；`--interactive` 仅供后续独立候选人工检查，不是安装、验收或部署。Node 22.22.0 首轮虽通过 JS 行为断言，但其 SQLite 实验警告触发 stderr 守门；最终使用已预置的 Node 24.15.0，不屏蔽告警。

## 实测：macOS 27.0.1 / arm64 / Xcode 27.0

`desktop-pi-integration-evidence.json` 保存本轮摘要和哈希。完整本机记录在 `artifacts/nsh-validation/pi-ui/`。授权素材 `run-KlwjLc`／无素材 `run-85dfFY` 各通过 17 项断言：从真实窗口布局回调确认挂载；用视图动作驱动创建、选择、发送、停止；PI 流式公开文本到达视图控制器，实际执行 write／read；验证项目隔离和外项目任务拒绝；每套收集并排空 204 条公开事件（3 次轮询，其中 2 页声明有后续）。切走运行中的 bash 所属会话后切回，停止并等取消终态＋排空，再在同一会话送出新任务；空闲后停止轮询。另在 bash 运行中主动关闭私有管道，Host 正常退出，无强制终止，控制器明确报不可用而非成功，等待与定时器清空。`run-H9GFfq` 的普通候选仅构建，未启动。

| 单次脚本观测（毫秒） | 授权素材 | 无素材 |
| --- | ---: | ---: |
| 启动至会话可用 | 2766 | 2554 |
| `projects.list` 最大往返（含冷启动） | 2722 | 2498 |
| `tasks.submit` 最大往返 | 31 | 33 |
| `tasks.events` 最大往返 | 30 | 21 |
| Stop 之后至取消并排空 | 228 | 238 |
| 同会话再次 Send 至排空 | 321 | 340 |
| 主循环心跳最大间隔（50 ms 定时器，含启动） | 369 | 588 |

这里的流式文本是从真实 PI SDK 的增量事件到控制器，不证明人眼看见逐 token 绘制。多页测试刻意延后第一次事件读取 800 ms 来积累 backlog，该等待不计入 `tasks.events` 往返。启动阶段比就绪后的管道往返明显更久；主循环心跳存在延迟，仅凭这两个样本不能归因到渲染、调度或 Host 加载的具体环节。脚本项目／会话往返通过，不能替代真实鼠标和输入法，也不能判定早期会话往返超时或用户感到卡住的问题已修复。正式模型、人工 GUI／IME／2×、持久化、异常退出恢复、可重现签名整包、同负载全进程资源对比仍待验。不部署、不操作正式沐码或手机。
