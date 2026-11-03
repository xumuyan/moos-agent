# 操作日志

时间统一采用北京时间（Asia/Shanghai，UTC+08:00）。仅记录实际发生的操作；历史时间无法核实时明确标注。不得写入密码、令牌或原始抓包载荷。

## 2026-11-03 14:21:39 +08:00｜仓库规范初始化

- 时间说明：此时间为本轮文件编写前读取的北京时间；后续验证属于同一操作批次，不将该时间冒充各命令精确执行时间。
- 修改或新增内容：克隆用户指定的 xumuyan/moos-agent 空仓库；新增根目录 AGENTS.md（五条协作规则）、operatelog.md（操作日志）、PLAN.md（分阶段计划）；新增 tests/test_repository_docs.py 文档检查。
- 遇到的难题：当前目录没有 Git 元数据；远程仓库没有历史提交、应用代码、测试或业务计划。提交文件无法包含自身最终提交哈希。
- 处理方式：将远程仓库克隆到当前空目录；依据已授权范围初始化文档并建立自动检查；业务开发和应用部署列为待明确；以唯一提交说明关联当前提交，后续记录已存在的哈希。
- 验证结果：本地文档实际验收：三个根目录文件非空；五条规则逐条对照用户要求；日志字段及未解决事项完整；计划按依赖分阶段且未提前勾选远程或业务任务。自动验证命令为 `python3 -m unittest discover -s tests -v`（4 项检查）和 `git diff --check`，结果以本次提交前命令输出为证据；远程推送尚未执行。
- 遗留问题：业务目标、技术栈、部署目标与业务验收标准尚未提供，等待需求明确；本轮不包含应用开发或部署。
- 对应 Git 提交：本批次提交说明 `docs: initialize repository rules, operation log and plan`；提交后可用 `git log --all --format='%h %s' --grep='^docs: initialize repository rules, operation log and plan$'` 查询。提交与推送证据在后续条目记录。

## 2026-11-03 14:23:04 +08:00｜提交验收与推送权限阻塞

- 修改或新增内容：更新 PLAN.md，记录初始化提交完成、远程推送受阻及解除条件；更新文档检查，防止权限阻塞时误勾选推送完成。
- 遇到的难题：git push -u origin main 返回 HTTP 403，GitHub 拒绝当前身份 xuguopeng 向 xumuyan/moos-agent 写入。
- 处理方式：保留本地提交，不更换凭据或强制推送；如实记录远程未完成。解除条件为授予当前身份写入权限，或以具有权限的身份认证后重试。
- 验证结果：初始化提交为 01b880d0e5cc8f71a8491ab09f23c94b6a980487；此前 4 项测试全部通过、git diff --cached --check 通过。git ls-remote origin refs/heads/main 无输出，未发现远程 main。此次日志修订交付前再次运行全部测试（新增阻塞状态检查后共 5 项）及暂存差异检查；测试结果以命令输出为证据。
- 遗留问题：GitHub 推送未完成；业务需求和应用部署目标仍待明确。所有文件和提交保留在本地。
- 对应 Git 提交：本条修订使用唯一提交说明 `docs: record blocked GitHub push and acceptance evidence`，可通过 git log --all --oneline 查询；该提交推送同样依赖上述权限解除。

## 2026-11-03 14:29:22 +08:00｜恢复 GitHub 推送并完成远程验收

- 修改或新增内容：更新 PLAN.md，将已有初始化提交的推送及远程验收勾选完成；更新测试，要求已完成推送状态具有提交哈希及日志证据。
- 遇到的难题：Git 使用的凭据身份与 GitHub CLI 的活动身份不同，导致此前推送被拒绝。
- 处理方式：确认 gh auth status 中活动账号为仓库所有者 xumuyan；仅本次 Git 命令显式采用 gh auth git-credential 凭据助手，未修改全局 Git 配置，无需新增授权或暴露凭据。
- 验证结果：git push 成功创建远程 main；git rev-parse HEAD 与 git ls-remote origin refs/heads/main 均为 0e9f3012ccd57f4390d2696de3b5d614463e88b8，已有两次提交均已推送。本条文档修订在提交前执行全部 5 项文档测试及 git diff --cached --check，结果见本批次命令输出；修订提交随后同样推送并核对远程 HEAD，不预先记录未知哈希。
- 遗留问题：此前权限阻塞已解除；业务需求及应用部署目标仍待明确。本次仅完成仓库文档的 GitHub 发布。
- 对应 Git 提交：已验收提交 0e9f3012ccd57f4390d2696de3b5d614463e88b8；本条及计划、测试修订使用唯一提交说明 `docs: resolve GitHub authentication and record remote acceptance`，查询命令：git log --all --oneline --grep='^docs: resolve GitHub authentication and record remote acceptance$'。

## 2026-11-03 15:21:12 +08:00｜确认 MVP 范围并细化三个根目录文档

- 时间说明：此时间为本批次开始时读取的北京时间，非此前每条需求确认的历史时间；各次对话的精确时间未核实，不编造。本文档批次按用户“按照文档进行，三个文档”的授权落盘，尚未实施应用功能。
- 修改或新增内容：AGENTS.md 保留原五条规则，补充技术栈、模型自动路由、自动执行、多项目隔离、桌面独占队列、凭据和验收约束；PLAN.md 保留初始化证据，解除原业务需求未明确状态，增加已确认范围、架构、模型策略、M01—M09 依赖任务、A01—A10 最终验收、实施前置条件与参考文档；本日志追加决策与限制；更新 tests/test_repository_docs.py，检查阶段依赖顺序、未实测不勾选、关键约束一致性及每条日志审计字段。
- 遇到的难题：Tauri 小包不等于 PI 运行时体积小；多项目并行与单桌面鼠标键盘争用；中转兼容协议不保证视觉或工具能力；iPhone 真机局域网、证书、签名及本地权限尚未验证；此前业务待明确状态已过时。
- 处理方式：规划 M01 先验证完整运行时和打包体积；项目代码任务并行、同目录修改串行、整个观察—操作—验证片段持有桌面锁；记录模型能力实测要求和费用未知口径；计划写清手机通信和签名前置条件及解除条件，所有应用任务与实机验收保持未完成。配对后直接执行、自动升级模型无需费用确认，符合用户已确认偏好。初始并发 2 和任务次数/时长上限为可调整的实施默认值，非已测试指标。
- 验证结果：本批次工作区文档逐项对照已确认需求，检查完整数据流、依赖顺序、范围、失败/取消、证据要求与前置条件；已执行 `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v`，9 项全部通过；`git diff --check` 通过，提交前另运行 `git diff --cached --check`。证据为本批次命令输出，对应本条日志所在工作区及提交。未运行 PI、真实模型、桌面操作、Mac 安装包或 iPhone 真机验收；文档测试通过不能代表应用功能可用。
- 遗留问题：应用代码尚未创建；M01 需要核实工具链、架构与运行时方案，M04 需要本机填写模型配置，iPhone 实测需要设备与签名条件。具体原因和解除条件已写入 PLAN.md。业务需求未明确的历史阻塞已解除，旧日志保留原貌。
- 对应 Git 提交：本批次唯一提交说明 `docs: define multi-project Mac and iPhone MVP plan`；提交后查询命令：git log --all --oneline --grep='^docs: define multi-project Mac and iPhone MVP plan$'。文档验收后提交并推送，再核对远程 HEAD，当前条目不预填自身哈希。

## 2026-11-03 15:31:09 +08:00｜M01：PI RPC、Mac 原生工具及完整内置包验证

- 时间说明：此为本批次开始时间；环境检查、排查、编译与实测跨越其后的操作时段。机器报告使用 UTC 时间戳，2026-11-03T07:46:03.123Z 对应北京时间 15:46:03.123；正常 GUI 验证在此后进行，不将开始时间冒充每个操作的精确时间。
- 修改或新增内容：新增 package.json/package-lock.json、Node 版本提示和构建产物忽略规则；新增 M01 独立 Tauri 探针、真实 PI RPC 宿主和本地模型 fixture、Swift 权限/自有窗口桌面自测、运行时准备/包内验证脚本、5 项 Node/原生测试、可复现说明、脱敏报告和仅探针窗口截图；新增构建排查记录 memory/2026-11-03-m01-build.md；同步 AGENTS.md 与 PLAN.md 的 RPC 决策、部分完成状态、体积证据和阻塞条件；更新文档测试以支持有证据的子项完成，避免把终端权限或模拟模型当成正式产品验收。
- 遇到的难题：Tauri CLI 从根目录找不到嵌套工程，改从探针工程目录构建；release 报宏依赖缺失但文件实际存在；初始工程缺图标；Swift helper 默认随 SDK 设置最低 macOS 27，与 Tauri 声明不一致；默认 npm 镜像不支持审计 API；GUI 启动权限与终端上下文不同；未连接 iPhone 且没有有效开发签名身份；完整 Node/PI 运行时占据主要体积。
- 处理方式：ctypes.CDLL 证实旧宏 dylib 被 dyld 以 mis-aligned LINKEDIT string pool 拒载，设置 release.build-override.strip=false 后新宏可加载且打包通过；保留应用二进制符号剥离，未更改全局工具链；生成探针图标并只跟踪所需 macOS 资源；统一 Swift 编译目标及 Tauri 声明为 macOS 14，但只报告当前系统实测；审计改用官方 npm registry 并通过；使用独立临时配置和禁用用户资源发现的离线 PI 模拟模型，未读取用户模型密钥、未消耗付费额度；正常 GUI 启动查询确认两项权限为 false，保留待授权状态，不自行修改系统隐私权限。
- 验证结果：macOS 27.0.1/arm64；Node 24.15.0、npm 11.12.1、rustc 1.91.1、Xcode 27.0、HBuilderX 5.07.2026041006。npm test 的 5 项检查通过：PI 流式事件、read 工具、取消、异常命令、宿主 SIGTERM/SIGKILL 后子进程无残留，以及原生只读权限检查；npm run build:probe 成功；npm run verify:probe -- --desktop-input 从 /tmp 且仅系统 PATH 启动实际 .app，包内 Node/PI 验证通过，终端授权上下文中的 helper 完成自有窗口点击输入及 520×232 截图；LaunchServices 启动应用后实际点击界面按钮，PI status=passed，但 GUI 屏幕录制与辅助功能未授权。报告及截图见 probes/m01/evidence/。ZIP 74,881,498 字节，应用逻辑体积 239,507,687 字节，磁盘占用 284,495,872 字节，Node 119,944,608 字节，依赖逻辑体积 114,221,839 字节；无额外运行时下载。官方 registry 的 npm audit --omit=dev --audit-level=high 返回 0 漏洞。提交前再次运行 npm test（5 项通过）和 npm run test:docs（10 项通过），git diff --check 通过，暂存后另检查 git diff --cached --check，证据对应本条日志所在工作区及同批次提交。
- 遗留问题：M01 整体尚未完成。正常 GUI 身份需系统授权后实测，首次授权/撤销/恢复、完整应用异常退出、Retina/跨屏坐标及 iPhone 真机通信与证书未验收；真机解除条件为连接信任 iPhone 并具备开发签名。中转站/GLM 真实配置及调用待 M04；正式 React/Ant Design X 工程、手机客户端和产品功能未开发。完整内置基线约 71.41 MiB ZIP/228.41 MiB 逻辑体积，最终小包运行时分发仍需验证。开发包未公证、无发布签名，不当作正式安装交付；M02 依赖整个 M01，暂不提前勾选或宣称解锁。
- 对应 Git 提交：本批次唯一提交说明 `feat(M01): add packaged PI RPC and macOS feasibility probes`；查询命令：git log --all --oneline --grep='^feat(M01): add packaged PI RPC and macOS feasibility probes$'。本条及代码、测试、计划同一提交保存；推送后用 git ls-remote origin refs/heads/main 与本地 HEAD 核对，不预填自身哈希。
