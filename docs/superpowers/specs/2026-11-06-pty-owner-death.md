# P02.9：PTY 强退清理与运行时分层验收

范围沿用已确认的 P02.9，不扩展插件权限。原版在所属原生进程 SIGKILL 后遗留 PTY 命令，真实回归先失败后修复。

## 处理

每个 PTY 增加一个同一 Rust 可执行程序的无窗口 guardian 模式，在 Tauri 初始化前分派；不增加 Node 或 Web 服务。父进程传入一份仅对子进程清除 CLOEXEC 的 master 描述符，守护等待控制管道 EOF，因此 UI 强退时仍保留终端，用 SID、shell 启动身份和后代快照检查限定清理对象。握手最多 2 秒，失败取消创建并释放目录锁；正常关闭、自然退出也回收 guardian。不会向第三方 Worker 暴露该入口。

仅覆盖附属于 shell 会话的命令，不承诺清理主动 setsid/disown 分离的 daemon；没有 OS 文件沙箱。强退时无法执行应用内 Drop，不能仅依赖正常退出路径。

## 验证

Rust 原生 PTY 回归分别使用 debug binary 和实际 Release bundle 内同一 guardian binary，测试 SIGKILL 所属测试进程后 shell/附属长命令退出，正常关闭保留无关进程、握手失败释放目录锁、无效模式不能终止进程。

`scripts/verify-product-runtime.mjs --app=/explicit/Moos.app --output=/private/report.json --long` 从显式安装包运行内置 Node + PI SDK，使用独立临时数据和本地确定性模型，20 个写入/bash 验证任务、两个项目并行、模型/工具取消、同目录排队取消与 605 秒任务。输出是 SDK/stdio 证据，不能代替 GUI 长任务、Dock 闪烁或真实服务账单。

`scripts/verify-product-watchdog.mjs --app=/explicit/Moos.app --output=/private/report.json` 强退自己启动的 wrapper，检查内置 Node、工具子进程和临时代理停止；不能代替 SIGKILL 实际 App 的组合验收。报告仅保存脱敏计数与状态，不输出原始模型诊断或凭据。

P02.9 保持未完成，GUI 20 任务/超过十分钟/组合强退、真实模型 usage、插件完整组合及最终安装体积仍按实际结果补齐。凭据由用户在本机输入，临时服务元数据存在不代表密钥可用。
