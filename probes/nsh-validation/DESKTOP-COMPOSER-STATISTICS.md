# N01-D3 · 输入栏底部会话统计

独立 NSH Mac 候选把输入框下方的素材说明条换成「轮数／步数、缓存命中、上下文」。点仪表图标及轮步按钮，在底栏上方向上打开「会话统计」，可用 Esc 收起，切会话不带走展开状态。上下文使用完整数字和千位分隔。模型用时和首 token 平均（TTFT）尚无独立的测量数据，显示 `—`；最近一轮执行用时和工具用时合计只显示已观测值。

## 口径与边界

- 轮数是当前视图内、当前项目和会话已验证终态且公开事件排空的不同任务数；失败和取消也可能成为已确认的一轮，不代表成功。首次确认前显示 `—`，不扫描旧历史，不持久化。工具步数统计已观测的工具结束事件（含报错结束），跨确认轮累计；任一轮无法确定时总数显示 `—`。
- 最近一轮执行用时是 Host 从 `running` 观察到终态的单调时钟差，不含排队。工具用时仅在开始和结束事件完整配对时显示，合计各工具耗时，并行部分可重叠；没有工具时间样本时显示 `—`。缓存命中取最近一轮最后一个非压缩使用量事件的已报告缓存读取量除以 `totalTokens - outputTokens`，分母包含提示的缓存写入量；缺值、无有效分母或比例不合法时不估算。上下文用该事件中的总 token 数和已报告窗口大小，缺项显示 `—`。
- 隔离 Host 仍是六个方法，仅在现有 `tasks.events` 的终态且排空页附带可选统计字段，不发布原始 usage、工具参数、结果、凭据或模型服务标识。客户端收到页面后暂存，控制器验证作用域、任务、事件顺序和游标，确认排空才入账。不改变发送、停止和队列派发条件。
- 仪表图标来自 `@deepseek-ai/dsh-web-frontend` 0.2.2-rc.1 的 `gauge-outline`，随源保留 `DSH-ICONS-LICENSE.txt` 的 MIT 版权声明。授权作品仅本机捕获，不发布艺术、字体或截图。

## 实际验收

`node probes/nsh-validation/verify-desktop-theme.mjs --statistics`：无艺术 `run-zgxF2M`，本机授权艺术 `run-aeFsoo`。两组各 4/4、各 12 张 1× 内容截图，覆盖浅/深色和 1240×820／680×720。原生驱动检查空态、终态未排空不更新、排空后更新、第二轮零步、缺失值、弹窗方向与边界、Esc 和会话隔离。已打开带艺术浅色窄窗展开图检查；这是 AppKit 开发宿主的合成数据，不是人工操作或用户签收。首次 `run-wMb3yl` 因 `App.capture` 不在测试 API 中而失败，改用 `app.screenshot` 后重验，保留首轮和早期成功记录。

`node --test probes/nsh-validation/desktop-host.test.mjs probes/nsh-validation/desktop-composer-statistics.test.mjs` 17/17，覆盖真实 PI 回环夹具统计、分页、非法和缺失数据、任务去重和作用域。`node probes/nsh-validation/verify-desktop-host.mjs` 通过私有管道、真实 PI SDK 和回环夹具 12 项，未连接外部模型，也不等于 PI＋GUI。源码、前序回执、布局和截图哈希见 `desktop-composer-statistics-verification.json`；全量回归及阻塞见 `operatelog.md`。

正式 Electron 沐码不构建、不安装、不部署，手机暂停。待核对本候选的真实操作、IME、2×、PI＋GUI、历史与恢复、签名整包，以及与 Electron 在同负载下的整包和全进程资源差异。当前结果不代表迁移可交付或性能收益。
