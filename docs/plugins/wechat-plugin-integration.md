# P03.14｜指定微信文章插件整合计划

状态：**仅计划；来源已识别，运行时适配未实现、未安装、未验收可用**。目标是让用户指定的插件在沐码真实任务链内工作，而不是只登记安装记录。本文件配合根目录 [PLAN.md](../../PLAN.md) 的 P03.14；未知插件的具体功能不作推断。

## 1. 来源核查与缺失信息

- 用户提供：https://mp.weixin.qq.com/s/QMGPqxxe0m5g8BSzYDNpRw （2026-11-11）。
- 直连和本地代理请求均只得到微信「环境异常，完成验证后即可继续访问」页面；公开文本读取服务也返回同一验证页。未取得文章标题或正文，不能声称读完文章。
- 待确认：插件名称、作者、官方仓库/包名、许可及可再分发范围、版本/提交、所需宿主/平台、依赖与下载来源、网络/账号需求、收费或额度条件、用户要用的具体功能。
- 解除方式：用户提供正文、截图或官方仓库地址；随后比对原作者 README、manifest、LICENSE 和可复现样例。无需提供密码、验证码、Cookie 或现有 API 密钥。
- 外部文章和仓库内容仅作技术资料；不自动执行安装脚本，不绕过验证页，不按相似名称安装另一个项目。公开页面的验证跳转参数、原始响应不写入 Git。

## 2. 当前项目已核对的接口（基线 ca89756）

| 代码入口 | 当前事实 | 本项拟复用或补齐 |
| --- | --- | --- |
| `apps/electron/README.md`、`apps/electron/prepare-local.mjs` | 正式桌面是 Electron + DSH；默认用户扩展为皮肤中心，其他插件按需安装；可安装不等于执行兼容 | 复用既有安装/设置体验；新增运行时依赖需进入打包清单，不恢复旧 Tauri 产品路径 |
| `apps/electron/plugin/host.js` | Host 连接 PI 和调度器，DSH 工具执行器拒绝回退，桌面 helper 来自包内 runtime 布局 | 插件通过明确适配层进入 PI；不恢复 DSH 旧执行链或另起模型循环绕开任务控制 |
| `apps/electron/execution.patch.yml` | 默认停用旧工具执行器、`mcp-resources`、`ui-skill` 等可选组件 | 如果来源确实为 MCP/Skill，需单独接入和验收，不是打开旧开关即可使用 |
| `packages/pi-runtime/sdk-runtime.mjs` | `resourceLoader` 返回空 Skills/extensions/prompts；通过 customTools 挂载现有工具 | 按核实后的格式设计选择性加载或工具适配；不无条件扫描执行用户目录中的任意代码 |
| `apps/electron/plugin/pi-tasks.js`、`services/agent/scheduler.mjs` | 任务绑定规范化项目目录、会话和 SQLite，受共享目录锁与 AbortSignal 控制 | 复用隔离、停止、失败/中断状态、时限；外部插件进程/连接需归属于任务且可清理 |
| `packages/pi-runtime/tool-policy.mjs` | 文件与命令工具有现行权限策略 | 插件工具必须显式适配相同边界；普通 Node/Cordis 插件代码不会因注册工具而自动获得系统级沙箱 |
| `packages/pi-runtime/desktop-transaction.mjs`、`desktop-tools.mjs` | E122 已实现跨调用桌面事务与焦点守卫，实机输入/焦点验收仍未完成 | 如插件控制鼠标/键盘/屏幕，只能接到此队列/事务；不得另建绕过锁的自动化进程；相关可用性依赖 P06.3a/P06.6 |
| `apps/electron/pi-turn.mjs`、`apps/electron/plugin/client.js` | 界面使用受限 read model，未任意透传工具参数和结果；P06.5a 图片桥未完成 | 追加已校验工具标签、阶段与结果资源引用；图片/文件验证项目与任务归属，不开放任意路径读取 |

上述为代码审阅结论，不是第三方插件已兼容的证明。正式应用仍为 0.1.41；0.1.43 是隔离候选，这次只改计划和文档测试。

## 3. 来源确认后选择一种必要接法

下列是**条件路线，不是插件已确认的属性，也不是一次性实现通用插件平台的承诺**：

- **DSH/Cordis UI 插件**：核对上游版本/API 和 hooks 信任机制；界面复用宿主，执行行为抽成 PI 工具。若要求 DSH 旧内核，先评估适配成本，不关闭 PI 路由保护硬装。
- **PI extension / Skill / 提示词工作流**：区分会执行代码的扩展和声明式技能内容；固定可信来源/版本/显式启用范围，校验 frontmatter、路径、容量、工具依赖与命名冲突，再接受控 resourceLoader。指令不能覆盖项目权限或偷偷启用额外命令工具。
- **MCP server**：仅在来源确认需要时实现所需的 stdio/HTTP 传输；本机进程用参数数组、最小环境、规范 cwd，远程连接验证服务身份及必要认证；实现有界初始化/调用、取消和 shutdown。schema、资源 URI 和工具结果不直接信任，不默认支持整个 MCP 生态。
- **CLI / SDK**：从 Host 侧提供 schema 明确的 PI customTools；固定依赖、限制参数/环境/输出大小，追踪子进程树，网络和文件操作遵守项目权限。无法受控或不兼容时明确拒绝，而非由任意 shell 拼接掩盖问题。

所有路线沿用现有模型选择/费用上限/手动覆盖，不要求复制模型密钥到新配置。确需插件服务凭据时复用应用私有凭据存储，只传必要凭据，日志、Git、聊天、渲染器不取得密钥；服务确需 OAuth 等授权则按官方流程单独设计，不能根据未知协议臆造兼容。

## 4. 可用性的交付标准

1. **明确入口**：按实际插件形态在插件页或设置页显示来源、版本、启用状态、配置与缺失依赖；未配置/未授权/不支持时给真实原因，不显示假成功。
2. **真实执行**：用户在已有项目会话发任务，由同一 Scheduler → PI → 插件适配层实际执行，产物可独立验证；最小样例必须待来源确认后具体化。
3. **可控收尾**：单任务停止中止网络请求和本任务子进程，释放目录/桌面资源，不影响另一项目；应用重启中断任务不自动重放有副作用操作。
4. **可见且私密**：展示真实动作、失败与脱敏结果；文件/图片以有归属的资源引用提供，拒绝路径穿越和越权；不把原始载荷直接塞进过程卡片。
5. **可维护**：按需启用/停用；固定版本并验证更新失败、停用和卸载行为；保留聊天、模型配置、皮肤、其他插件和用户产物。若需用户数据迁移，先说明、备份并另获同意。
6. **分层交付**：模拟测试、真实插件隔离测试、真实外部服务测试、安装版 GUI 实测分别登记证据。构建成功或源码推送不等于插件可用；正式安装仍需单独授权并遵循 E84。

## 5. 测试与验收矩阵（均为后续实施要求）

| 层级 | 必验场景 | 通过依据 |
| --- | --- | --- |
| 来源/依赖 | manifest/许可证/版本锁/供应链；支持的 Mac 架构/系统、安装脚本与资源来源 | 可追溯官方来源与依赖清单，许可不明不再分发 |
| 单元/负例 | schema、缺失配置、错误码、只读、越界/符号链接、输出限额、提示注入与隐私 | 非法或越权调用在副作用前拒绝；未配置不挂载；秘密不进入事件/日志/UI |
| 生命周期 | 两项目并行、同目录串行、运行/排队取消、超时、子进程退出、断连/重启 | 资源归属正确，无重复副作用、不遗留锁/子进程、不停止其他项目 |
| PI 集成 | 真实 PI SDK + 本地模拟服务；再使用固定版本真实插件和临时数据 | 工具确实被模型调用且产物符合预期；模拟和真实结果分开记录 |
| GUI | 配置/启用、实际调用、结果卡/产物、失败指引、停止、重启、停用/卸载 | 独立目录内实操，不以按钮存在代替可用；与所选插件真实功能逐项对照 |
| 桌面能力（如涉及） | 观察—操作—验证互斥、失焦拒绝、权限拒绝/恢复、截图归属 | 依赖 P06.3a/P06.5a/P06.6 的授权实机证据，不用合成helper代替 |
| 打包与升级 | `npm run build:app`、验签/包内依赖、无fixture、安装包/下载/落盘体积 | 依赖真正随包或按校验来源获取；经授权 E84 更新后旧数据不丢、插件功能可用 |

基线回归入口：`npm test`、`npm run test:electron`（完整包内与皮肤夹具）、`npm run test:desktop-native`、PI 桥和皮肤探针、`PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v`。功能开发需新增插件专项测试与真实验收，不以本文或文档测试代替。

## 6. 推进顺序与当前解除条件

P03.14.1 资料/最小场景 → P03.14.2 适配设计 → P03.14.3 执行桥 → P03.14.4 管理与结果 → P03.14.5 隔离/打包验收 → P03.14.6 单独授权后的安装可用性验收。未依赖桌面的部分可独立推进，不等待 D01/M09；未知来源期间继续原有 P06.5a。

当前只差识别插件所需的原始资料，并非已证明插件不兼容。收到正文/截图/仓库后先将第 1、3、4 节从条件方案细化为确定方案，再开发；本轮不安装任何插件、不更改用户配置、不退出或替换正式沐码。

## 7. 2026-11-15 来源解除与团队模式确定方案（取代前文当前阻塞结论）

第 1–6 节保留最初微信环境异常的核查历史及条件路线，不再代表来源仍未知。上轮已读到文章《27 万 Star 的 DeepSeek Harness 终于有了队长。》，本轮从作者仓库固定源码核对；未重新读取微信正文，不把源码审阅当作插件运行验收。

### 7.1 固定来源与真实工作方式

- 作者仓库： https://github.com/NanmiCoder/dsh-agent-teams ，包 `@nanmicoder/dsh-agent-teams`，源码声明版本 0.1.30；文章示例 0.1.29。审阅提交 `4354b0f6a793b75c1904c0ee85eef4043a37c733`（main 快照，不等同验证 npm 发布包与该提交完全一致）。MIT 许可证 Copyright (c) 2026 程序员阿江(Relakkes)，复用分发须保留许可；本轮不复制上游实现到正式代码、不自动执行安装脚本。
- `README_ZH.md`、`src/tools.ts`、`src/members.ts`、`src/scheduler.ts`、`src/client/index.tsx`、工具名与兼容表已只读核对，哈希及结论见 `docs/evidence/desktop/agent-teams-source-review.json`。兼容表列出 DSH 0.2.2-rc.1，但这是上游宿主声明，不覆盖沐码的 PI 改造。
- 当前会话为队长，14 个团队工具；成员使用 4 个协调工具及普通工作工具。任务依赖就绪才领取，独立可续聊子会话按任务唤醒，空闲不调用模型；消息邮箱/团队图持久化在工作区 `.agent-teams/`。转派绑定 attempt_id，先使旧 attempt 失效并等待原执行收尾，不能接受迟到结果。
- 默认 `approval: required` 只建立 staged 草案，用户确认后启动；支持 `approval: automatic` 立即执行。关闭团队面板不停止团队，完成仍可查看归档与成员对话。面板更新/成员通知为事件驱动，不需忙轮询。
- `spawnMember()` 要求 `ctx.subagents.getProvider()` 与可续聊成员能力；缺 provider 明确报错。沐码停用 spawn/fork 旧执行器并由 Host 给 DSH 空工具目录；仅安装插件不能让 PI 自动获得团队工具。
- 服务/费用：利用宿主已配置的模型路由，不是阅读文章就获得免费算力；每个活跃队长/成员轮次都会产生各模型用量。MIT 不等于模型免费；真实费用、外部研究工具与各模型能力均未实测。

### 7.2 用户截图对应交互（拟实现）

1. 在左下角「＋」菜单增加「协作模式」，可选「普通模式 / 团队协作」。默认普通，不更换当前模型、权限、附件及历史。
2. 选中团队后，在「＋」右侧原生 `conversation.input.left` 插槽显示「团队协作 ×」；菜单使用宿主 `commandUi.register`，不靠坐标或 DOM MutationObserver 伪造入口。标签可打开团队面板，×仅切换后续发送模式，不暗中停止已运行团队。
3. 模式属于当前会话，不影响其他会话；发送时由 Host 校验并把模式快照绑定到该轮任务，排队后切换不改变已提交任务。重试沿用原轮模式；后台未支持时明确拒绝，禁止偷偷回退普通聊天。持久化采用独立设置键，不改聊天记录格式；测试仅使用临时数据，不预写真实用户设置。
4. 团队模式通过队长拆任务→创建成员及有向无环依赖→执行→汇总；右侧面板显示成员、任务、依赖、状态和真实事件。可打开成员对话、查看结果/用量，关闭面板不取消。禁止把一模型扮演多人输出当成独立成员执行。
5. 按沐码既有自动执行约定默认自动启动，不照搬上游必点一次批准与二次停止确认；预览/修改计划可后续显式提供，不新增每步确认。系统授权照常。停止团队取消其排队/活跃成员及桌面动作，并等待真实收尾；切换标签不等于停止按钮。

### 7.3 必须先解决的执行与锁边界

- 运行仍为 Host → PI customTools；队长与成员有独立 PI 会话、角色/工具权限、模型路由快照、project/team/task/attempt 归属；不重开 DSH 原执行器，不额外复制模型密钥。优先隔离验证复用上游状态/调度/UI所需适配面；成本或接口不合适时再按 MIT 保留许可复用，不能现在承诺原包直接工作。
- 当前 Scheduler 对同一规范化目录串行。不能让队长占住目录锁等待又提交同目录成员：这会自锁。需要拆成短规划轮次、无锁等待阶段与受调度的成员轮次，或设计经测试的团队锁租约；不得简单移除路径锁。
- 首个闭环同目录成员轮次串行（明确显示排队），依赖语义仍成立，不承诺同项目并行提速。后续只有实现受控只读工具集/路径边界，或独立 worktree 加受控合并，才开放安全并行；其他项目可继续按全局额度并行。不能把只读提示词当强制权限隔离。
- 停止、超时、断连与重启：关闭子请求/受控进程/待执行桌面动作；取消后不再放出下游，迟到消息不覆盖终态，重启遗留转 interrupted 待显式继续，不自动重放写操作。成员不能自行再建团队或绕开全局槽位、目录锁、桌面事务。现有取消剩余回归仍须复验。
- 团队事件增量订阅/合并更新，仅实际变更触发 UI；面板隐藏不动画/轮询全部成员，避免在已有高 CPU 问题上新增持续重绘。设置成员数、总轮次/时间/用量上限，有界失败处理，不无限唤醒或递归。

### 7.4 分步验收（均未实现）

- 先打通一队长＋两成员：临时工作区给三文件测试样例，队长规划两项有依赖任务，成员独立 PI 会话执行，队长汇总，外部测试核对真实产物；另测双就绪任务在同目录正确排队，不死锁。真实 PI SDK＋本地模拟模型与线上模型分开记证据。
- 覆盖菜单切换/×/窄窗/皮肤、会话隔离与重开、发送/排队/重试模式快照、后台不支持拒绝、成员消息与任务依赖/循环拒绝、attempt 迟到、全局配额、两项目并行、同目录串行、停止与超时收尾、失败阻断下游、重启不重放、权限/凭据不泄漏和面板关闭继续运行。
- 先交隔离后端闭环，再接菜单与面板，最后全量回归/签名构建/隔离 GUI。不得先放一个显示可用的空壳团队开关。正式安装需另行授权 E84；本轮只有源码审阅与方案/文档契约更新，不是 GUI 或模型实际验收。


### 7.5 PI 自研后端隔离候选（2026-11-15，未开放入口）

新增 `packages/pi-runtime/team-runtime.mjs`，不是安装上游插件，也未复制上游源码。自研有限DAG customTools方案已以真实PI SDK+本地模拟模型核对三会话、真实写入/独立读取产物及队长汇总。父Scheduler以一个团队租约持有规范化目录/并发槽，直接逐轮调用PI，不再把成员递归提交回同目录队列，因此没有队长等待成员队列自锁。团队内部串行，其他项目仍可并行；这是首轮租约方案，替代7.3的拆锁候选，不放松目录锁。

请求准备48次、2–6任务、已报告token40万、父任务截止时限；未报告用量不估算，单次请求可能超额，不是严格费用封顶。验证必须成功工具事件+显式结论，工具失败阻断后续；此证据门槛不等于能证明任意业务目标正确。验证成员需要运行会写缓存的测试，因此沿用真实任务权限，不谎称强制只读。取消等待子轮次真实收尾；失败不汇总成成功，迟到事件/协调工具拒绝，无忙轮询。后端候选9项专项、串行完整核心274/274；默认核心两次有helper超时，Rust离线仍受阻，不宣称全绿。证据 `docs/evidence/desktop/agent-teams-pi-backend.json`。

正式host未调用该候选；菜单/标签/面板、模式快照/重试持久化、成员聊天入口、线上模型/GUI/新构建尚未实现或验收。子会话JSONL与父team_state事件只构成隔离历史，不构成完整团队恢复协议。旧7.4“均未实现”是当时历史，本检查点只更新后端候选，不把模式或上游插件标成可用；不部署、不改真实用户数据。


### 7.6 Host路由与提交模式快照候选（2026-11-15，界面仍未开放）

本节更新7.5之后的源码状态：Host已按已接受消息的`source.rpcId`解析`moos-pi-mode:v1:<ordinary|team>:<UUID-shaped suffix>`，普通任务继续`runPiSdk`，团队进入`runPiTeam`。该ID仅为路由元数据，不是授权；仍验证正常会话、规范目录、模型和权限。创建队列任务的同一事务写`task_submission={version:1,mode}`，排队后切换不改变已提交模式。显式重试从数据库取原模式/目标，历史无快照任务默认普通，保留前缀内的非法版本/模式和损坏存储拒绝，不静默降级。

应用重启沿原逻辑标中断、不自动重放；显式重试生成新父任务及成员历史，队长获得先检查已有产物/避免盲目重复副作用的指引。这不是节点级恢复或事务性恰好一次执行，模型指引不能充当外部副作用去重保证。

专项19/19，真实生产Host.apply→路由→Scheduler→PI SDK→本地模拟模型→write answer.txt=42→独立read/verdict→队长交付；新隔离包同链路亦通过。默认核心275/275，Electron110通过9跳过，build-D7oaW7包内118通过1跳过、严格验签/无fixture；Rust离线缺tauri，皮肤专项缺材料，全仓仍非全绿。详见`docs/evidence/desktop/agent-teams-host-route.json`。

**客户端发送身份钩子、＋菜单/团队协作×标签及团队进度面板仍未接入**，不能把Host可调用说成用户可用；测试请求ID为测试构造，不冒充用户菜单发送。外部模型、正常GUI、节点恢复和正式安装仍待验收。不启动或替换现用沐码，不改真实用户数据，不安装上游插件或恢复旧DSH执行器。

### 7.7 客户端发送身份、菜单与真实进度候选（2026-11-15，未安装）

本节是7.6之后的状态，不改写之前无界面的历史。已接Session的beginSubmission和direct prompt身份兜底；菜单「团队协作」及「团队协作 ×」使用commandUi与conversation.input.left。默认普通、按Session临时保存，不适用于routed subagent；切换/×只改变之后生成的请求身份，不取消现有任务。显式重试保持原ID，Host仍以原task_submission恢复模式/目标。排队/回显/附件引用的ID由同一入口生成；VM测试不是完整真实附件上传验收。

进度来自父team_state，最多128事件/6节点，展示角色、依赖、真实枚举状态和通用阻塞指引，父终态覆盖；不暴露成员原文、目标、验收正文或任意路径，无新增团队轮询。尚无独立右侧成员消息/详细阻塞面板；投影目前校验父/角色及running attempt形状，不是完整逐节点attempt关联，不能冒称投影已屏蔽所有stale。runtime的stale工具/迟到emit防护独立保留。无节点恢复或恰好一次副作用保证。

专项34/34；新无fixture build-a0XbOz严格验签，包内Electron123通过1skip。隐藏QA窗口经CDP完成实际菜单/发送→Host→PI→写42→独立读→汇总，运行中×不取消，下一条普通成功，9次本地模拟请求。两次脚本选择失败保留。可复验 `node scripts/verify-electron-team.mjs .generated/moos-electron/build-a0XbOz/沐码.app`，只接受.generated/moos-electron内真路径、复制新QA包/独立数据，不修改原包或正式数据。此脚本不是正常可见GUI/原生输入验收，不是外部模型或生产安装。默认核心初轮helper超时保留、最终npm test 276/276，完整串行276/276；脚本另有流式文字/DB终态竞态，等待终态后复验成功；Rust缺离线tauri、皮肤材料不足，全仓非全绿。证据 `docs/evidence/desktop/agent-teams-client-ui.json`。外部模型、正常GUI、真实停止/重试全链路与剩余恢复/配额场景继续验证；正式安装需另获授权E84。

### 7.8 节点轮次关联与异常链路（2026-11-15，隔离候选）

后续实现更新7.7的投影缺口：runtime节点completed/blocked携带本次turn的attemptId；投影只绑定首次running，父任务/节点/角色/UUID-shaped轮次均匹配且done后才接受完成/阻塞，错配/重复/终态回退忽略。每节点每父任务一轮；显式重试产生新父任务，不在旧节点替换轮次，不是节点恢复。旧无attempt终态只保留未知节点状态、父终态仍权威，不改真实数据库或迁移。事件仍最多128/6节点，无新增轮询或私有正文/attempt暴露；不宣称captain阶段全部轮次关联。

新build-WmgJoT无fixture、源码核对/严格验签；包内124通过1皮肤skip。`node scripts/verify-electron-team.mjs <generated-app> [success|blocked|stop]` 三场景均以独立复制隐藏QA包/CDP/本地模拟模型通过：成功两个节点完成；实际读42后synthetic verdict=false，显示check验收阻塞/父失败，无总结/假交付；点击停止生成确实关闭挂起模型连接、父cancelled，无文件/验证成员，后续普通成功。该停止场景不覆盖活跃shell/子进程或桌面动作取消，非正常GUI/外部模型验收。核心初轮276/276，另次QA并行回归275通过1helper超时记录保留，QA结束后默认完整复跑276/276、64.02s，专项最终21/21；Rust离线缺tauri及皮肤材料仍受阻。证据`docs/evidence/desktop/agent-teams-attempt-lifecycle.json`。详细成员/阻塞界面、真实附件/重试GUI、恢复/外部模型/正常GUI待做；不安装/替换/重启正式沐码，不改真实数据。

### 7.9 显式重试：保存模式与输入框选择分离（2026-11-15，隔离验收）

运行 `node scripts/verify-electron-team.mjs <generated-app> retry`。使用既有无fixture的build-WmgJoT，仅复制QA包、隐藏窗口、CDP操作、合成本地模型及独立配置；本轮没有应用runtime改动或新构建。原团队运行中清团队标签为普通；实际write42/独立read后故意verdict=false，再点「继续上次任务」：保存team和原目标沿用，不改变输入框；产生新父任务、全新attempt、6份不同父所属角色历史（各队长/执行/验证），请求不含旧assistant上下文。队长和执行成员先read原产物、不再次write，验证独立read后两节点完成并汇总；随后普通请求成功，数据库failed/succeeded/succeeded及team/team/ordinary核对。

最终retry 17次本地请求、所有检查通过；success/blocked/stop回归亦过。两次QA脚本失败保留：工具结果不保证name，须按tool_call_id关联前面tool_calls；Page.close可能先退出再丢CDP回执，脚本与真实退出竞争并仍要求exitCode0，不吞异常强行当成功。证据`docs/evidence/desktop/agent-teams-retry-ui.json`含失败/通过记录与哈希、最终命令/回归及严格验签；核心276/276，皮肤/Rust门仍阻塞，全仓未全绿。此例的“先检查”由本地合成模型遵循提示，不能保证任意线上模型不重复副作用；不是节点恢复，不覆盖cancelled/interrupted GUI重试、附件生命周期、正常GUI/原生输入或外部模型。正式应用/数据未动，安装另获授权。


### 7.10 成员结果凭据与依赖阻塞（2026-11-15，隔离候选）

执行过程→团队协作→“节点 · 成员结果与验收”展开角色、状态、依赖、工具记录计数及验收分类。执行成员只标轮次结束，不代表验收通过；验证成员区分已提交通过且有成功检查、明确未通过、缺少结论、存在工具失败。计数是tool_end记录数（含协调工具），不是去重动作数/测试个数，也不证明任意业务目标正确。凭据采用v1/固定枚举/0–10000有界计数，只在本父节点角色attempt的running→done→终态完整关联后输出；旧或损坏凭据不补造。明确blocked依赖可传递给仍queued的下游，显示实际阻塞ID；其他任务取消/异常不猜测原因。成员正文、verdict.summary、私有推理与工具载荷不进入新详情；这不是已实现通用文本脱敏或完整成员消息/产物链接/用量面板。

首轮四场景业务断言虽通过，截图显示通用action-list flex将详情挤列且背景干扰，视觉未验收；加团队专属单列grid、不透明Canvas/CanvasText底色与DOM几何断言后重建。最终build-39USi2签名通过、无fixture/源码匹配；success/blocked/stop/retry的复制隐藏QA/CDP/本地模型复验均通过（不是正常GUI/原生键鼠或外部模型）。blocked计划增加依赖check的final节点，实际check验收未过、final未执行并显示来源check；Stop无伪造通过凭据；retry新父有通过详情、输入框普通不变。核心277/277、专项31/31、包内126通过1skip；Rust/皮肤仍受阻，不宣称全仓全绿。证据`docs/evidence/desktop/agent-teams-member-details.json`，包含初始断言与视觉问题、最终命令/报告及源码哈希。复验 `node scripts/verify-electron-team.mjs '.generated/moos-electron/build-39USi2/沐码.app' [success|blocked|stop|retry]`。正式应用/真实数据未动，安装仍需另获授权。


### 7.11 文件附件与排队的实际上传链路（2026-11-15，隔离验收）

运行 `node scripts/verify-electron-team.mjs '.generated/moos-electron/build-39USi2/沐码.app' attachments`。脚本通过原生HTML file input的change事件加入浏览器File，真实执行后台上传与receipt服务，不替换上传API；浏览器生成文件无OS路径，因此走上传链路。17B小文本进目标，154016B文本超过128KiB预算落盘.moos-uploads；队长和执行成员实际read上传文件，再write answer.txt=42，独立验证成员实际read/提交结论，落盘上传原字节核对一致。

运行中退出团队模式，再上传20B文本并点“排队发送”；在队长请求仍挂起时把未来输入模式切回team。解除本地模型测试门后，团队先交付，排队任务保持ordinary且模型读到它自己的文本附件；数据库team/ordinary和succeeded/succeeded，输入框保持team。门是测试服务协调，不是产品审批。另先上传9文件并实际发送，路由显示最多8附件错误，零PI任务/零模型请求，随后有效附件发送成功；不据此宣称上传网络故障/重试/取消或原子回滚通过。

仅QA脚本/测试/证据变化，既有build-39USi2重新验签、runtime及shell归档源码核对，未重构建或安装。最终附件场景11请求/13项检查全真，另外success/blocked/stop/retry通过；专项11/11、核心277/277，源码117通过10skip、包内126通过1skip，Rust离线/皮肤门仍阻塞。证据`docs/evidence/desktop/agent-teams-attachment-queue.json`。这是隐藏复制QA包/CDP/本地模型/合成文本文件；原生文件选择器/拖放/OS路径引用、图片、steer、上传网络故障/重试/删除/取消、正常GUI与外部模型均待验收。截图中通用错误提示可见，但皮肤下整体错误对比度未在本轮验收。正式应用和用户数据未动。


### 7.12 停止后的显式重试（2026-11-15，隔离验收）

运行 `node scripts/verify-electron-team.mjs '.generated/moos-electron/build-39USi2/沐码.app' stop-retry`。原团队实际write answer.txt=42后，在执行成员后续模型请求挂起期间点击“停止生成”；真实模型连接关闭，原父任务cancelled，尚未启动验证成员，文件保留。停止时无成功验收凭据；节点可以保留最后running/queued观察，父已停止权威，不伪造节点已完成。等待1秒没有自动新任务/模型请求，再从普通输入框点“继续上次任务”。

重试原目标/保存team，新父及fresh attempts/独立角色历史；队长和执行成员先read文件，不再次write，独立验证成员read/verdict成功再汇总。数据库cancelled/succeeded/succeeded、team/team/ordinary，原任务事件与重试前逐条相同，旧2角色+新3角色共5份持久化历史；输入框普通不变，后续普通任务成功。实际无重写依赖合成模型遵循检查提示，不代表任意外部模型副作用去重、同节点恢复或恰好一次。

仅QA脚本/测试/文档变化，既有build-39USi2重新验签和源码核对，未构建/安装。最终stop-retry 14请求/15检查全真，其余success/blocked/stop/retry/attachments五场景均通过；专项11/11、核心277/277，源码117通过10skip、包内126通过1skip，Rust离线tauri/皮肤门仍阻塞。证据`docs/evidence/desktop/agent-teams-stopped-retry.json`。仅复制隐藏QA/CDP/本地模型，不是正常GUI/原生输入/外部模型；中断重启重试、活跃shell/子进程/桌面取消等未验收。未安装/退出/重启正式应用或改用户数据。


### 7.13 中断重启后的显式重试（2026-11-15，隔离验收）

命令 `node scripts/verify-electron-team.mjs '.generated/moos-electron/build-39USi2/沐码.app' interrupt-retry`。原团队实际write42、执行成员后续模型请求挂起时，只定向故障本次复制QA及其已观察后代：SIGSTOP父，SIGKILL后代与父，不使用全局应用名或共享进程组；先唯一绑定本QA Host。冷SQLite必须仍running/旧事件逐条相同，不能用预写interrupted或普通退出代替。复用同副本和临时数据启动，重新选择已保存团队会话。startup旧事件前缀相同、只追加一条task_state/interrupted/host_interrupted；原文件保留，UI已中断，无假成功凭据。1秒无新请求/任务，显式点击继续上次任务后才创建新team父/原目标/全新轮次与成员历史，队长/执行成员read而不再write、独立验证read/verdict/汇总成功；下一普通任务成功，输入框仍普通，原中断后事件流不再改变。数据库interrupted/succeeded/succeeded、team/team/ordinary，旧2+新3共5份角色历史。

最终14请求/18检查全真，其余success/blocked/stop/retry/attachments/stop-retry通过；专项11/11、核心277/277，源码Electron117通过10skip、包内126通过1skip；Rust离线缺tauri exit101/皮肤材料缺失，全仓未全绿。既有build-39USi2无fixture/严格验签/源码匹配，未新构建或安装；证据`docs/evidence/desktop/agent-teams-interrupted-retry.json`包含失败/修复：ps转义中文全路径使guard拒绝，改在已绑定后代PID内匹配唯一ASCII临时目录后缀；重启默认会话导致找不到团队卡，补选原会话，未绕过检查。

只覆盖隐藏CDP/本地模型和整棵QA进程树人为故障，不是正常GUI、原生输入或外部模型，不证明仅杀App父进程看门狗清理、操作系统重启/断电恢复、活跃shell/桌面取消或节点恢复/恰好一次。无重复write依赖合成模型，不能保证任意模型不会重复副作用。第一次故意SIGKILL不是正常退出验收，重启后的最终实例仍必须exitCode0。截图中PI执行过程/重试dock显示已中断，但上游DSH气泡仍标已停止并提示进程退出/工具结果未知；不宣称全界面术语统一或皮肤下整体错误对比度通过。正式应用与真实数据未动。

本轮blocked回归曾11项业务检查通过，但QA在既有10秒退出窗口内exitCode仍null，按失败保留；未放宽退出门，原样串行复跑41.6s、最终exit0通过，延迟根因未确认（证据保留首报告与复跑报告），不把复跑成功冒充根因已修复。


### 7.14 活跃 shell 与子进程停止（2026-11-15，隔离验收）

执行 `node scripts/verify-electron-team.mjs '.generated/moos-electron/build-39USi2/沐码.app' shell-stop`。不同于只挂起模型请求，本场景由真实PI bash工具先写42到answer.txt及shell.pid/child.pid，然后启动/bin/sleep120并wait，最后原本会写late.txt。默认workspace-write、不改执行权限或请求提权。点停止前检查shell/child PID有效且不同、child的实际PPID为shell、shell祖先为本次spawn的QA、SQLite父running且真实成员bash tool_start、文件42存在而late.txt不存在。

真实点停止生成，不由QA runner直接发kill给工具进程；随后两个PID均ESRCH，父cancelled、无verifier/summary/假交付或通过凭据。已写42保留，1秒观察late.txt仍不存在；再发送ordinary成功说明同项目租约可再次使用。不是其他项目并发不受影响证明。最终4本地请求/11检查真，其他success/blocked/stop/retry/attachments/stop-retry/interrupt-retry七场景通过；专项11/11、核心277/277；源码Electron117通过10skip、包内126通过1skip；Rust离线tauri缺失exit101/皮肤材料缺失，全仓未全绿。复用build-39USi2无fixture、严格验签和runtime/shell归档源码匹配，未新构建/安装。证据`docs/evidence/desktop/agent-teams-shell-stop.json`。

仅证明这条bash+单个直接sleep子进程的取消，不覆盖daemon/脱离进程/孙进程/忽略信号等任意拓扑，也非排队或活跃桌面动作取消、任意副作用恰好一次。隐藏QA/CDP/本地模型，不是正常GUI/原生输入/外部模型验收，既有偶发QA退出延迟根因仍未确认。正式应用和真实数据未动。

本轮初始blocked业务11项通过但QA退出超时，核心首次276/277中桌面geometry drift用例遇helper超时；分别原样串行复跑40.55s正常exit0、核心277/277，未改门限或桌面保护，失败/首结果保留于证据，延迟与超时根因仍未确认。


### 7.15 跨项目团队停止隔离（2026-11-16，真实Host/PI，未安装）

新增 `node --test apps/electron/team-stop-isolation.test.mjs`，可通过 `MOOS_ELECTRON_TEST_DSH_CLI=<generated-app>/Contents/Resources/host-runtime/bin/dsh` 复验未改包内Host/runtime。真实Host.apply注册PI adapter，Scheduler运行两规范工作区，真实PI SDK使用本地合成模型。A成员bash先写自己的A_ONLY_42并记录shell/direct sleep120子PID，ps核对父子及祖先为本次Host；B不同目录/会话的成员模型响应保持挂起，SQLite两父任务同时running。

只abort A实际adapter请求，A cancelled且两个PID均ESRCH；测试不直接kill工具进程，无late写/无后续verifier或summary。1秒后B连接仍开、controller未abort、父仍running、完整有序事件快照不变。然后释放B本地响应，真正write B_ONLY_42、独立read/team_verdict、summary交付；A旧事件流不变，检查每条事件task/project/conversation/team归属，两个工作区文件各自字节正确，A下一普通成功。源码与包内各12请求/8检查真。挂起/释放是测试同步，不增加产品确认。

源码专项11通过1skip、包内新专项1/1、核心277/277；源码Electron118通过10skip、包内127通过1skip；Rust离线tauri缺失exit101/皮肤材料缺失，全仓未全绿；八既有隐藏renderer场景回归通过，复用build-39USi2严格验签且Host/route/tasks/runtime及client归档源码匹配。首success九项业务检查真但normal QA quit null !== 0失败，保留原日志/gui-shT9Bv报告；原样串行重跑exit0通过，根因未确认、退出门限不改。新场景无Electron renderer/按钮输入，合成Cordis服务上下文不等于完整DSH实例；上轮真实隐藏UI shell-stop证据单独保留。两项目的此拓扑不外推B活跃shell、任意N项目/守护或脱离进程、桌面动作取消、正常GUI/外部模型或性能，历史QA退出延迟/helper超时根因仍未确认。证据`docs/evidence/desktop/agent-teams-stop-isolation.json`。正式应用及用户数据未动。


### 7.16 双项目活跃 shell 停止隔离（2026-11-16，真实Host/PI，未安装）

2026-11-16 双项目活跃shell停止隔离检查点（保留历史）：扩展既有Host/PI双项目测试，A bash/direct sleep120和B bash/direct cat FIFO均实际运行，四PID不同，ps父子及祖先归属本次隔离Host。只abort A，A cancelled/两PID ESRCH；1秒后B原PID存活/直接父子不变/任务running/控制器未abort/完整事件快照不变。只向FIFO写RELEASE_B数据，B原命令自然退出并写B_ONLY_42，独立read/verdict/summary成功；取消A事件不变、产物及每条事件归属正确，A下一ordinary成功。源码/未改包内各12请求11检查真，既有挂起模型场景仍通过；源码专项12通过1skip/13，包内新专项2/2，核心277/277；源码Electron119通过10skip、包内128通过1skip；Rust离线缺tauri exit101/皮肤材料缺失，全仓未全绿。八隐藏renderer场景最终通过；shell-stop/stop-retry/attachments首轮业务全过但正常退出超时，失败保留、原样串行重跑，不改门限且根因未确认。首测试脚本缺引号导致解析失败（未运行Host）保留并修正。复用build-39USi2严格验签/runtime及client归档字节核对，无runtime修改或重建。证据`docs/evidence/desktop/agent-teams-dual-shell-isolation.json`。仅合成Cordis/本地模型的真实Host链路，无双项目renderer或原生Stop；只覆盖两项目当前直接子进程拓扑/一秒窗口，不外推永久隔离、任意进程树/桌面取消/恰好一次。正常GUI/外部模型/完整成员面板/恢复及QA退出/helper超时根因待做，P03.14.1–6不勾；正式应用/用户数据未动。

复验命令 `node --test apps/electron/team-stop-isolation.test.mjs` 同时执行既有B挂起模型和新增B活跃shell两场景。指定 `MOOS_ELECTRON_TEST_DSH_CLI=<generated-app>/Contents/Resources/host-runtime/bin/dsh` 复验包内Host/runtime；均使用独立临时数据，不修改正式应用。B使用非阻塞FIFO打开确认读取者仍存在，测试只写同步数据，不通过信号终止或重启B命令来制造完成。


### 7.17 QA退出时间线（2026-11-16，未复现超时，未安装）

2026-11-16 QA退出诊断检查点（保留历史失败）：只在复制QA main加入白名单退出事件/时间戳，记录window/webcontents销毁、before/will/quit及host.stop开始/settled；生产源码main/Host及候选包不改，原host.stop Promise和最终exitCode0/10秒门限保留。新增VM测试验证未放行Host清理前不退出、settled后原quit仍执行，解析器只保留event/at并拒绝未知入口/事件。八隐藏renderer场景带时间线均exit0，Host停止154–223ms；本轮QA退出未复现超时；首核心278通过1失败（既有geometry drift断言实际helper超时），保留首日志并原样串行复跑，不改桌面门限；不据成功测量宣称历史退出延迟根因已确认或修复，日志可能影响时序，既有失败证据保留。专项3/3、核心279/279，源码Electron119通过10skip、包内128通过1skip；Rust离线tauri缺失exit101/皮肤材料缺失，全仓未全绿。复用build-39USi2严格验签/runtime及client归档匹配，未重建/安装。证据`docs/evidence/desktop/agent-teams-qa-shutdown.json`。正常GUI/外部模型、完整成员面板/恢复、双项目renderer/桌面取消及QA退出/helper时限根因继续待做，P03.14.1–6不勾，正式应用/真实数据未动。

命令仍为 `node scripts/verify-electron-team.mjs <generated-app> <scenario>`。报告shutdown.events包含白名单事件及Date.now毫秒；退出失败仍判失败并保留时间线，不从Host settled推断任意后代均退出，不从CDP回执推断正常退出。新增scripts/team-qa-shutdown.mjs仅由隔离验收脚本使用，不打入正式应用。


### 7.18 QA退出失败进程快照（2026-11-16，故障注入，未安装）

2026-11-16 QA退出失败进程诊断检查点（保留历史）：只扩隔离脚本，在关闭窗口前与退出失败后/清理前采集本次QA PID后代的pid/ppid/state，ps只请求这三列，最多128行/1.5秒/1MiB，无命令行/环境。解析/真实ps及QA专用quit阻止VM测试通过。明确MOOS_QA_BLOCK_QUIT=1仅在生产路径拒绝后的复制QA main注入before-quit preventDefault：实际write/read/verdict/汇总及9业务检查全过，但Host settled后应用未退出，原10秒/exitCode0严格判失败，清理前快照保留根和2后代；不把注入当历史故障复现。八正常场景均无注入exit0并有关闭前快照；默认npm test两次同一geometry drift实际helper超时，首日志和原样复跑均保留；首完整串行新增真实ps测试超时返回unavailable亦保留，最后完整原测试清单--test-concurrency=1原样复跑282/282通过，不等于默认npm test或ps时序故障修复；专项6/6，包内双项目专项2/2，核心单文件并发完整清单282/282，源码Electron119通过10skip、包内128通过1skip；Rust离线缺tauri exit101/皮肤材料缺失，全仓未全绿。复用build-39USi2严格验签及runtime/client源码归档匹配，无runtime修改/重建安装。证据`docs/evidence/desktop/agent-teams-qa-quit-process.json`。PID快照非跨PID复用身份/脱离后代/全进程清理证明；历史QA/helper超时根因未确认，P03.14.1–6不勾，正常GUI/外部模型/完整成员界面与恢复待做，正式应用/真实数据未改。


### 7.19 成员文件事件索引（2026-11-16，仅定位工具记录，未安装）

2026-11-16 成员文件索引检查点（隔离候选、未安装）：成员详情只从当前父任务/团队/角色/已接纳attempt的唯一、顺序正确且成功的write/edit起止事件提取工作区相对路径，要求位于running至done区间内；排除外部/控制字符/隐藏依赖路径、foreign/stale/重复/逆序/失败及bash/read；同路径去重，最多12项/400工具事件/128状态，截断提示。路径按钮只定位本卡原始工具动作并聚焦，不打开/读取文件、不推断命令产物；明确历史写入不代表当前文件存在/符号链接目标在项目内或验收通过。新增关联/越权/同角色多节点/上限/VM定位测试；新无fixture build-unpYE2严格签名、六份源码/归档匹配；真实SDK本地服务write→read→独立verdict/汇总后点击定位成功，read-only显式重试无虚构文件，八renderer场景最终业务检查及正常exit0，面板及定位图已按实际编码核对并目视。首success/blocked/retry与retry第二轮仍业务全过但normal QA quit失败，保留时间线/清理前进程快照；success首快照在quit事件后仍见根PID，非Host清理或Electron根因结论。默认npm test两次既有geometry drift实际helper超时，保留失败；最后原清单--test-concurrency=1通过，不宣称默认命令/时序修复；专项24/24，核心完整清单单文件并发282/282，源码Electron123通过10skip、包内132通过1skip；Rust离线缺tauri exit101，全仓未全绿。证据`docs/evidence/desktop/agent-teams-member-files.json`。正常GUI/外部模型/真正文件打开与完整成员侧栏/恢复/跨项目renderer与桌面取消仍待做，P03.14.1–6不勾；正式应用/聊天/配置未动。


### 7.20 已结束团队的历史刷新恢复（2026-11-16，未安装）

2026-11-16 历史团队刷新恢复检查点：仅扩QA/测试，runtime不改，复用未安装build-unpYE2严格签名及六份runtime/client源码归档核对。MOOS_QA_HISTORY_RELOAD=1只允许success/blocked，复制前拒绝其他场景；实际团队write→独立read/verdict→交付或阻塞，再发ordinary成功，Page.reload刷新同一隐藏工作台/原进程，重新打开保存会话。成功37事件/9请求、失败33事件/8请求，成员文字/文件索引/凭据/依赖阻塞逐项相同；再次点击answer.txt定位原本卡已完成动作，输入框仍ordinary且无伪重试，保留42；1秒观察无新模型请求且完整tasks/events逐项未变。两场景初轮及补截图复跑均exit0，10秒门限不改；面板/视口图核对，失败面板长图下部被固定输入框部分覆盖，另视口有阻塞，不把裁图当完整长面板可用性证明。专项25/25、完整核心串行283/283，源码Electron123通过10skip、包内132通过1skip；默认npm test 282通过1失败/helper超时，Rust离线缺tauri exit101，全仓未全绿，默认失败与串行成功并列，非根因修复。旧证据脚本哈希文档检查首失败保留，改用git show 5b9bf8e核对当时QA源码、保留历史哈希，新hash归本次证据。证据`docs/evidence/desktop/agent-teams-history-reload.json`。仅已结束任务刷新，不是冷启动/活跃任务/附件队列刷新/节点恢复/恰好一次保证；正常GUI/外部模型/完整成员侧栏仍待做，P03.14.1–6不勾；正式应用/数据未动。


### 7.21 执行中团队的工作台刷新（2026-11-16，未安装）

2026-11-16 执行中团队刷新检查点（隔离、未安装）：仅扩QA/测试，MOOS_QA_ACTIVE_RELOAD=1在复制前限定stop/shell-stop。真实PI执行成员响应挂起或bash/direct sleep存活时Page.reload同一工作台/Host，重新打开原会话，成员文字投影相同、输入框ordinary、无伪retry且Stop可用；一秒观察任务/事件逐项相同、请求3→3，原连接不关闭或原命令PID/直接父子关系保留。随后实际点Stop取消原任务，命令两PID ESRCH、无late.txt/无验证汇总，后续ordinary成功。最终两场景严格退出均exit0通过。首两次脚本在React投影更新前读取build断言失败，改等待已有轮询结果；第二轮两场景业务全真但10秒normal QA quit失败，时间线与清理前PID快照保留；最终原样复跑不等于根因修复。专项26/26、完整核心串行284/284，默认npm test既有helper超时失败；源码Electron123通过10skip、包内132通过1skip，Rust离线缺tauri exit101，全仓未全绿。复用build-unpYE2严格验签及六份源码/归档核对；旧历史刷新证据脚本hash改以git show 3850730:path核对，不改历史证据。证据`docs/evidence/desktop/agent-teams-active-reload.json`。非冷启动/崩溃/节点恢复/永久不重放或任意进程树取消，也非可见原生GUI/外部模型；附件排队/steer刷新、完整成员侧栏及既有时序根因待做，P03.14.1–6不勾。正式应用/聊天/配置未动。


### 7.22 成员已报告用量（2026-11-16，限定候选、整体验收受阻）

2026-11-16 成员已报告用量检查点（隔离候选、整体验收受阻、未安装）：runtime在活跃角色轮次边界盖写team/member/attempt归属，投影仅汇总本节点running至done及父终态前的已报告非负整数input/output/total，回复和压缩分开；0是实际报告、缺失显示未报告，不估算缺请求/费用，不输出模型/服务商/原始payload。父任务usage独立首256条、每项≤10亿，状态/用量截断及无效已归属计数提示不完整，不宣称完整账单/去重/恰好一次。新增真实SDK报告、伪归属/晚到/取消/区间/同角色多节点/非法/0/256上限/隐私与显示测试，专项42/42；新build-QWEhD0/0.1.49严格验签与六份源码归档一致。隐藏复制QA/本地模型成功与验收阻塞均显示build两条24 token/check三条36 token；不报告时显示未知。两场景刷新后同投影/事件不变、请求9→9或8→8、一秒无重放，最终exit0。八普通场景中七个最终正常exit0，但Stop三轮业务全真而10秒normal QA quit仍失败，明确受阻，不勾整体完成；附件首CDP timeout、两刷新首退出失败均保留后原样复跑通过，不据复跑宣称根因修复。默认核心285/286既有helper超时，完整原清单串行286/286；源码Electron126通过10skip、包内135通过1skip，Rust离线缺tauri exit101，全仓未全绿。用量三图目视，长面板底部仍被固定输入框遮挡，不称完整可用性通过；实际压缩只单测，非外部模型/正常GUI/完整账单或冷启动恢复验收。历史hash改按5b9bf8e/f50851a证据提交核对，旧JSON不变。证据`docs/evidence/desktop/agent-teams-member-usage.json`；P03.14.1–6不勾，正式应用/聊天/配置未动。


### 7.23 QA退出原生采样（2026-11-16，根因仍未确认）

2026-11-16 QA退出原生采样检查点（诊断、根因未确认、未安装）：仅扩隔离QA/测试，不改main/Host/runtime及host.stop→app.quit顺序；原10秒/实际exit0严格判失败之后才对本次仍存活复制QA子进程运行sample，1秒/10ms采样、3秒命令上限、2MiB大小上限。只输出主线程六项等待/事件循环布尔值和固定状态枚举，不导出符号/路径/原始采样，临时目录0700/文件0600并finally清理；缺失/异常显示unavailable，不当无阻塞或成功。两次探索正常Stop退出不作为修复，正式诊断Stop业务8检查全真但退出null，实际捕获主线程Mach消息等待；Host settled/will/quit仍不证明进程退出，不能据此归因Host或Electron。故障注入首采样unavailable保留、第二次有AppKit/CF事件循环/Mach等待；注入不是历史根因复现。其余七普通场景正常exit0，Stop不反复刷绿。专项12/12，完整原清单串行289/289；初默认核心289通过，之后默认288通过1失败/reads5而非6，再次287通过1失败1取消（桌面helper超时及adapter原25秒超时）全部保留，不宣称根因修复。源码Electron126通过10skip、包内135通过1skip；Rust离线缺tauri exit101，全仓未全绿。复用build-QWEhD0严格验签，六份源码重新hash与既有候选一致，不重建/安装；历史用量证据hash改以git show 023cc22核对，旧证据不改。证据`docs/evidence/desktop/agent-teams-qa-native-sample.json`。仅隐藏CDP/本地模型、点时采样，非可见原生GUI/外部模型、完整后代退出或PID复用防护；退出根因/helper时序/完整成员界面仍待做，P03.14.1–6不勾，正式应用/真实数据未动。


### 7.24 QA失败后有界清理（2026-11-16，非自然退出根因修复）

2026-11-16 QA失败后清理检查点（仅测试脚本修复、自然退出根因未确认、未安装）：一次隔离Stop再次业务8检查全真但10秒normal QA quit失败，采样命令unavailable；当时系统load345.98/100进程running/CPU无空闲/压缩约7.5GB，仅观测不归因为根因。只读查到四个旧故障注入QA仍存活，旧脚本SIGTERM后等5秒即返回、不核退出/不升级，确认独立清理缺陷。新增cleanupQaChild只接受本次spawn子进程句柄，先写原失败证据后TERM等5秒、仍活KILL再等5秒，记录固定status/termSent/killSent，不把强制清理当正常成功、不覆盖strict exitCode。测试覆盖已经退出/TERM退出/KILL/仍活/异常以及真实忽略TERM子进程ESRCH；专项14/14。历史注入PID逐一以旧report快照及精确QA.app路径核实后清除，遇身份变化停止且保留两次脚本失败，最终12个历史观测PID均不在；不碰正式应用。新实际注入仍exit1/null，后cleanup killSent真且本次观测主/后代PID全ESRCH；普通八场景均正常exit0，这次通过不抹旧退出失败/不称自然退出根因修复。默认核心290/291既有helper超时，完整原清单串行291/291；源码Electron126通过10skip、包内135通过1skip、Rust离线缺tauri exit101，全仓仍未全绿。复用build-QWEhD0严格验签，不重建/安装/runtime不改；历史native证据源码hash按git show d7cf54a核对、旧JSON不改。证据`docs/evidence/desktop/agent-teams-qa-cleanup.json`。仅当前复制QA子进程，非任意后代树/永久隔离/可见GUI/外部模型或生产退出验收；P03.14.1–6不勾，正式应用/真实聊天配置未动。


### 7.25 QA关闭请求计时（2026-11-16，非原生退出根因修复）

2026-11-16 QA关闭请求计时检查点（仅验收脚本纠偏、原生退出根因未确认、未安装）：代码审查确认旧算法先等Page.close回复或实际退出，再另等10秒，CDP回复延迟可能延长实际观测窗口。因此历史文案‘严格10秒’不精确：旧exit0要求仍在，但不能把旧结果追认为新截止通过；历史JSON/失败不改。新增waitQaExit先启动10000ms可取消定时器再发关闭请求，CDP ack不能单独算退出或重开窗口，actual exit或截止结束等待，最后仍检查exitCode0；请求错误直接失败，finally撤销定时器，不改Host/main和失败后采样/清理。专项16/16含受控时钟丢失/迟到ack、无退出ack、实际退出、错误及真实自有Node子进程无ack退出。隔离故障注入仍exit1/null，关闭请求后10002ms观察失败、随后自有QA清理KILL；普通8场景7个exit0，中断后重试20项业务检查全真但关闭后10004ms仍exitnull失败，sample仅Mach等待、清理前已自行退出；不复跑刷绿，仅本轮通过，不宣称修复历史自然退出。默认核心292通过/1失败/0取消，共293；完整原清单串行293/293（不当默认修复）；源码Electron126通过10skip、包内135通过1skip、Rust离线exit101缺tauri，全仓未全绿。复用build-QWEhD0验签、未重建/安装、真实数据未动。证据`docs/evidence/desktop/agent-teams-qa-exit-deadline.json`。Node定时器非硬实时，不能据此归因Mach等待或系统负载；P03.14.1–6不勾，正常GUI/外部模型/完整成员界面继续待验。


### 7.26 原生退出源码边界

候选Framework版本44.7.0；对照上游v44.7.0固定提交61f55c4ce540416b3e43f75f6c0f125d22e5e908及三个源码SHA-256（不是当前二进制完整源码/构建标志等价证明）。App::OnQuit在可选singleton清理前发quit；Browser::Shutdown在主循环退出派发前通知OnQuit，主循环使用QuitWhenIdleClosure；循环退出后还包括utility、Node和BrowserContext清理。以上只是可能的后续边界，不是自然故障调用栈或根因归属；条件编译的profiling等待不可据源码存在就判启用。

一次带新分类探索的隐藏复制QA interrupt-retry（gui-ShhyRe）20项业务真，实际exit0、关闭派发后267ms；未触发失败采样，未取得新分类结果。探索hook未交付或验收，原六布尔采样实现不变，也不宣称各候选等待已排除。保留gui-nex2zX/gui-aprEHG/gui-lS0geG原失败；这次正常退出不是修复证据，不再重复刷绿。证据 `docs/evidence/desktop/agent-teams-native-boundary-review.json`。

仅文档与契约更新，无runtime重建/安装或正式应用重启；10000ms/实际exit0、先失败再采样/清理及Host顺序保持。下一步须在真实失败中以经过测试的有界、非阻塞、白名单诊断区分原生阶段，再谈因果修复；完整团队界面/可见GUI/外部模型、全仓回归及P03.14整体仍未通过。


### 7.27 原生主线程白名单分类

隔离QA现有异步sample增加8个boundary布尔：idleLoop、singletonCleanup、nodeTeardown、browserContextTeardown、chromiumShutdown、launchServicesCheckOut、synchronousXpc、processExit。只匹配主线程函数帧的符号部分，不匹配镜像路径/worker元数据；既有六等待布尔保留。仍先10000ms/actual exit0判失败，冻结原exitCode后才采样；1秒/10ms采样、3秒命令上限、2MiB上限、临时目录0700/文件0600、finally删除；不引入同步sample或生产进程查找。

true仅为聚合样本中的函数族出现，不代表具体等待根因、排他阶段、先后或死锁；false不代表排除（符号剥离/别名/版本或格式可能漏识别）。合成测试逐类阳性，真实自有Node采样验证私有异步链路，实际注入复制QA报告只验证schema：gui-WQNQOr故意阻退出仍exit1/null，10003ms后失败，AppKit/CF/Mach真且八类false，清理TERM+KILL不是通过。一次无注入gui-aXOBDN 20项业务真/exit0/263ms，没有故障采样，不消除三个历史自然失败。

专项20/20；其他全量回归结果及默认helper失败/Rust离线依赖/皮肤skip如实保留于 `docs/evidence/desktop/agent-teams-native-frames.json`。仅QA helper/tests改动，候选QWEhD0重新验签，未重建/安装、不动main/Host或用户数据；自然退出根因/全仓/完整P03.14仍受阻，后续实需验收中遇自然失败才使用新诊断，不重复跑场景刷绿。
