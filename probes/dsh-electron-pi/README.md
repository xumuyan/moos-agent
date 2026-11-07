# 原版 DSH Electron 接入 Moos PI

这个探针在 P03.11 的原版 DSH Electron 窗口中添加一个「Moos PI · 本地验收」执行入口。DSH 提供窗口、皮肤、会话和停止操作。Moos 安装包里的 PI SDK 负责模型循环、文件操作和命令执行。桥在 DSH 已有的 Host 中调用 PI SDK，每个 DSH 会话使用独立的 PI 会话数据目录。

先完成相邻的 DSH 皮肤探针并安装原版皮肤。从验证窗口按 `⌘Q` 后，在仓库根目录执行。

```sh
bash probes/dsh-electron-pi/probe.sh install
bash probes/dsh-electron-pi/probe.sh open
```

在原版窗口添加启动命令打印的临时工作区。在该工作区的新会话里打开模型菜单，进入「模型」子菜单并选择「Moos PI · 本地验收」。

1. 发送 `MOOS_FIXTURE_WRITE electron_ok`。PI 写入 `result.txt`，用 bash 验证内容。会话显示两项工具结果。
2. 发送 `MOOS_FIXTURE_HOLD`。任务开始后点「停止生成」，会话显示「已停止」。
3. 在同一会话发送 `MOOS_FIXTURE_WRITE electron_resume`。文件内容变为 `electron_resume`，会话保留停止状态和后续结果。

桥仅接受固定临时工作区及本地验收指令，由本机模拟模型驱动。允许的 PI 工具结果以简短文本流呈现。桌面皮肤、插件安装和验收数据留在 Git 忽略的独立配置。真实模型、完整权限策略、文件变更卡片、Token 用量投影、后台并发和正式安装包分阶段验收。

```sh
node --test probes/dsh-electron-pi/index.test.mjs
```
