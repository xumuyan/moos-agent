# N01-D1 / N01-D3｜模型选择和共享发送／停止

本检查点取代 `DESKTOP-COMPOSER.md` 中单独停止按钮的行为，保留该文档和清单为历史证据；不改输入框弓片、底饰、背景或人物。只在 NSH 独立候选内生效。

- **左侧模型选择**：空闲时可选择“本地夹具 · 标准／备选”。下次提交带所选 ID，Host 在入队时绑定有效模型。目录缺省的旧 Host 仍可提交（不附 ID），选择器禁用；目录畸形则报错、不提交。无端点、密钥、生产模型或持久化设置。
- **右侧一个动作**：空闲时是发送；提交开始即换成停止生成。任务 ID 未确认、停止进行中或任务已终止但事件还在读时，显示停止但不可重复触发。停止应答只是确认收到请求。终态且 `hasMore=false` 后，同一位置恢复发送，等待期间保留下一条草稿。回车只走发送，不触发停止。

## 本机隔离验证

`desktop-composer-controls-verification.json` 固定提交前混合工作区的源码 SHA、历史记录、回执、实际布局及 PNG 摘要。macOS 27.0.1 arm64，Node 22.22.0，NSH 0.5.0 AppKit 开发宿主，1×。

- `node probes/nsh-validation/verify-desktop-theme.mjs --composer`：授权艺术 `run-l8kUc7` 和无艺术 `run-Bn5k2r` 各 2/2，各 10 帧。明暗 × 1240×820／680×720，含展开选择器、草稿、运行和停止后。驱动验证按键/回车、模型值、只发一次/只停一次，以及停止应答 → `cancelled` 但仍有第 5 条事件 → 排空后恢复发送。实测布局保持左侧 32pt 选择器和右侧 44/38pt 动作，两者不相交。动画、中文输入法、手工操作及用户认可未验。
- `node probes/nsh-validation/verify-desktop-host.mjs`：子进程私有管道 + 真实 PI SDK + 回环夹具，11 项；覆盖备选模型实际被请求、同有效模型幂等、改换模型冲突、未知模型拒绝，同时保留实际文件/工具和停止回归。`node --test probes/nsh-validation/desktop-host.test.mjs` 14/14，包含同项目入队绑定。这个结果不等于真实 PI 与界面在同一应用内端到端通过。
- `node probes/nsh-validation/verify-desktop-native.mjs`：Foundation 私有管道 63 项、Mac Catalyst 桥 `good/denied/timeout` 41/6/5 项和独立退出探针通过（`run-UFTU9X`），不是 AppKit 界面的人工关闭测试或可发布整包。

初次选择器触发器不可按（0/2），改用原生 Button；后来首轮无艺术 1/2，停止后立即读到了旧的可用态，最终用可观察条件等待按钮禁用，再分别断言应答、终态待排空和排空，保留初始失败。侧栏活动专项仍 0/2，两套主题返回等待“读取 · 失败”超时；未确定根因。E124 缺真实报告、Rust 离线缺 `defmt`、Electron 隔离 DSH 用例跳过，仍不是全量交付。七份 owner 输入保持未跟踪且不变；未推送、部署、运行正式构建或恢复手机任务。
