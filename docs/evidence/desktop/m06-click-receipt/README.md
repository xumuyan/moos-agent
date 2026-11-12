# E133：一次点击的真实送达子集与安装版 Dock 误挡再确认（未安装）

2026-11-12 19:36–19:51 北京时间；两项权限已授予。一次性 SwiftUI 夹具（bundle `local.muma.click-receipt`，640×300 内容区，按钮 `SwiftUI click target`，无网络/无任务持久化/无键盘记录，只记录鼠标事件元数据与语义计数）。

## 时序
1. 沐码在前台时夹具截图按协议拒绝；`open` 激活夹具后观察到空夹具（count 0）。
2. MCP（安装版沐码 0.1.47 工具）两次 `desktop_click` 在投递前被拒，报「目标窗口或输入焦点无法确认/已经变化」。其间候选包 helper `focus` 六连读快照完全一致（AXWindow、path []、element==window 730,378,640,332、windowId 66577、pid 96046），前台 20 秒采样无翻转。
3. 安装版 helper（sha256 前 16 `759658664413f7cd`）同参数 `click --at 1049,539 --expect-focus <同一快照>` 返回 `{"reason":"target-occluded","status":"failed"}` exit 5，事件文件无新行——**未投递**。
4. 候选包 helper（E132 build-NtlJnq，sha256 前 16 `19eae0708ab454de`）同参数投递：`posted:true`，一次 down/up；夹具收到本地 NSEvent down/up（窗口坐标 319,171，间隔约 1.5ms），SwiftUI 按钮动作触发，计数 0→1（events.jsonl 最后一组）。
5. 新事务新截图人工确认「SwiftUI count: 1」，end 核对；夹具 SIGTERM 后确认进程消失。

## 归因与边界
- 安装版工具把 helper 六种拒绝统一映射为 DESKTOP_FOCUS_CHANGED 长消息；上述 target-occluded 即 E128 定位过的 Dock 全屏 layer-20 表面误挡（精确身份+实时 AX 命中的豁免只在候选里）。本次在安装版二进制上再确认，**不是新的焦点不稳定证据**。
- 证明子集：CGEvent 单次点击可真实送达 SwiftUI 按钮并产生语义变化；收到的事件与投递坐标一致。不证明所有控件/网页/场景送达，更不是安装验收。
- E132「侧栏点击 posted 但页面未切」仍是独立未解问题，本轮不涉及。
- events.jsonl 前 6 行属旧进程：夹具启动后机器前的**人工**点击两次（计数 1→2）， provenance 不同于 helper 投递；两条 `sandbox_extension…` 是启动 stderr 噪声，如实保留。
- 直接调用 helper 的投递试验是 runner 级动作（自有夹具、一次点击、非事务重放）；MCP 事务均逐一释放，无自动抢回/重放。
