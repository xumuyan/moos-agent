# E128 — Dock 表面候选修复的有限实机证据

对应 `../m06-dock-surface.json`。只含独立测试窗口的图片，不包含真实聊天、配置、密钥或酒店数据。

## 已执行

在 arm64 / macOS 27.0.1 上以 `swiftc -O -target arm64-apple-macos14 apps/electron/desktop-helper.swift -o <temporary-helper>` 编译候选。临时 runner 使用源码 `createDesktopTools`、独立临时数据目录与真实 transaction/observation 协议；不使用模拟 helper。独立窗口源码为 `fixture.swift`，无网络、无持久化。

- `before.png`：输入为空，计数 0。
- 最新观察后执行 `desktop_type`，再截图：`after-type.png` 实际显示 `MUSU_CONTROL_TEST`，标签同步该值。
- 最新观察后点击测试按钮，返回 `after-click.png`：计数变为 1。
- 再次截图、人工回读、`desktop_end(verify)`；协议结果 `resultObservationConfirmed=true`，工具仍返回 `businessGoalVerified=false`。人工语义结论仅限上述独立窗口。
- runner dispose；独立窗口正常 terminate，确认进程退出。没有退出/替换正式沐码。

## 未通过 / 未验证

沐宿两次点击可派发，但一次点输入框后返回 JS 焦点变化错误，可能已经部分投递；不自动重放。后续新事务输入返回成功，截图搜索框仍为空。因此 **沐宿搜索输入语义未通过**，不能用独立窗口结果替代。

此补丁只处理精确系统 Dock 的全屏 layer20 管理表面，并要求实时 AX 命中同一焦点窗口。真实其他覆盖物/同进程不同窗口的完整拒绝矩阵、双屏输入、多项目/取消、正式聊天截图桥仍待实机验证。分类单元测试和源码约束检查不是这些现场验收。

隔离构建 `build-tHD6rO` 未安装，沿用 0.1.47 版本号（非新发布）。临时 helper 的 `-O` 与正式构建编译参数不同，二进制哈希不相等；未把临时输入验收称为包内输入验收。付费 GLM、真实 Key、官网/交易均未操作。
