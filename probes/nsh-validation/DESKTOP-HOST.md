# N01-D1 本机 Host / 私有管道检查点

本交付仅为 Node Host 子项，**不是 NSH 原生桥或 GUI 闭环完成**。正式 Electron、手机、安装包、真实聊天和配置均未修改。证据 `desktop-host-evidence.json` 对应基础提交 `4a80f2f` 的提交前工作区；初始六文件均已存在但未跟踪，本轮保留基线摘要，不将原实现当本轮新开发。

## 桥接稳定入口

- 契约：`desktop-contract.ts` 的 `Calls` / `Request` / `Response` v1，仅六方法：`projects.list`、`sessions.list`、`sessions.create`、`tasks.submit`、`tasks.cancel`、`tasks.events`。
- 原生父进程使用固定、可信 Node 及脚本的绝对路径直接 spawn `desktop-host-stdio.mjs`，仅私有 stdin/stdout/stderr，不经 shell、不暴露脚本参数或环境配置给 TSX。示例的可信环境只保留 PATH/TMPDIR/LANG；不得继承 NODE_OPTIONS、NODE_PATH、模型密钥或 Electron 注入项。可执行文件/脚本的分发、签名与原生调用权限仍由桥接任务验收。
- `startDesktopHost` 的 `run` / `projectNames`、`trustedProjects`、`close` 仅限可信 Node 层测试/生命周期，不是渲染接口。默认真实 PI SDK 1.5.0 在 Host 内运行，非另一个 PI 进程；复用 Store/Scheduler，固定本地模型夹具仅绑定 127.0.0.1 随机端口并验证内存随机认证值。无 LAN / 手机配对依赖，不读正式模型地址/凭据。
- 每次启动建立私有临时根、规范化项目、默认会话及独立 SQLite/PI 历史。界面只拿标识/名称，不能注册目录或传路径、命令、provider、模型 URL、凭据。普通 text 是模型提示而非直接 shell 方法；本地夹具仅确定性回显或固定 write/read/hold 场景，不是商业模型推理。
- 所有操作显式 projectId/sessionId；任务读/取消再次校验完整归属。同项目不同会话不能互读任务。幂等键按会话作用域，重复同文本返回同任务当前状态，不同文本冲突；最多 32 个独特任务/Host（含终态），每项目最多 16 会话。不支持重启持久化去重或恢复。

## 帧与事件约束

- UTF-8 NDJSON；请求行不含 LF ≤16384 字节，响应含 LF ≤524288 字节；逐段检查单帧大小，避免先拼接整个批次。无效 UTF-8/JSON 交验证器返回泛化错误；超限/截断帧关闭管道。错误返回只有 code，无异常正文/栈。
- 单次写入完成前不处理下一请求，阻塞写入最长 5 秒；输出 error/close、输入异常和期限到达立即停止准入、销毁故障流并启动同一 close。父管道在启动期间丢失也不再接纳任务。EOF 撤销任务；若 EOF 位于尚未消费的多请求积压之后，可能先触发写超时并记失败，而不保证这些请求已执行或收到响应。
- 事件只投影公开 text_delta / task_state / tool_start / tool_end；不返回工具参数/结果、原始模型协议、usage、推理、检查点或私有路径。模型公开文本本身可能包含用户提示/文件内容，不声称通用秘密过滤器。
- 每页 1..100 条、事件预算 64KiB；每任务保留 ≤4096 条且 ≤1MiB，落后明确 `cursor_expired`，不可静默跳页。delta ≤4096 UTF-16 单元并有 truncated 标记，工具 ID ≤200 单元且名称白名单。SQLite/PI 原始历史不受此内存 journal 限额约束，不声称全落盘/工具输出配额。
- **必须 terminal && hasMore=false 才读完**；terminal=true 的首页仍可能有积压。连续传回 cursor，hasMore=true 立即续页，非终态空页等待后再取。cancel 返回可能仍 running，是停止请求而非清理确认。cursor_expired 提示丢失，不自动重提任务。桥接需自有有界 pending 表、响应帧限额与退出失效处理；此处不宣称原生端已实现。

## 生命周期与验证边界

正常/EOF/异常关闭停止 Scheduler，等待至多 15 秒 drain，再关闭模型监听、SQLite 并删除临时数据。失败 drain 不删除临时状态，命令入口泛化报错、非零退出。真实测试观察固定 bash 工具 PID 消失及临时目录删除；只覆盖登记工具，不保证任意脱离后代、OS 沙箱、SIGKILL/崩溃恢复。失败验收器最终 SIGKILL 仅用于自有 Host 收尾，不计正常退出通过。

```sh
# 使用本机既有 Node >=22.19（本次实际 v24.15.0），不安装依赖或改全局工具链
node --test probes/nsh-validation/desktop-host.test.mjs
node probes/nsh-validation/verify-desktop-host.mjs
npm test
npm run test:electron
python3 -m unittest discover -s tests -v
```

真实专项覆盖可信目录/会话/任务归属、幂等/限额/分页、终态积压、cursor gap、公开投影/泛化失败、真实 PI write/read/流式、双项目/排队取消、活跃停止/Host close、私有子进程 EOF、UTF-8/帧限额、串行背压/写期限/EPIPE/关闭/输入异常/启动丢管道，以及真实 PI 在故障和 EOF 后的已登记命令清理。测试结果和全仓失败按证据分别报告，未通过不抹除；无 NSH/GUI、正式构建/安装、外部模型、手机或完整业务性能验收。N01-D1、D2、D3 保持未勾选。
