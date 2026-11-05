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

## 2026-11-03 15:56:44 +08:00｜M01：iPhone 连接复查与剩余前置条件

- 时间说明：此时间为本批次设备查询后写入记录的北京时间，不冒充各条命令精确执行时间。保留此前“无设备”的历史记录，当前状态以本次复查为准。
- 修改或新增内容：更新 AGENTS.md 的手机现状，更新 PLAN.md 的 M01.8/E06 及实机阻塞条件；新增 probes/m01/evidence/ios-preflight.json 脱敏证据；新增文档回归检查，区分 USB 配对成功与应用安装、同 Wi-Fi 验收成功。
- 遇到的难题：用户连接手机后 CoreDevice 已可通信，但开发者模式关闭；security find-identity 仍显示有效签名身份为 0。xctrace 列表将设备列为 offline，不能将其误读为 USB 未配对，也不能宣称已具备运行条件。
- 处理方式：通过 devicectl 的结构化详情核对配对/隧道/开发者模式；只保留系统版本、产品型号和状态，不保存设备名称、UDID、序列号或原始设备输出。查阅 Apple 开发者模式及 DCloud iOS 基座签名官方文档，记录由用户在手机完成开发者模式、在本机配置签名的解除步骤；未更改手机安全设置、未创建证书、未安装应用。
- 验证结果：iPhone14,2 / iOS 27.0.1；pairingState=paired、transportType=wired、tunnelState=connected；developerModeStatus=disabled；有效签名身份为 0。设备连接前置条件已满足，但原生应用安装和局域网通信未验收。交付前执行 npm test（5 项）及 npm run test:docs（新增检查后 11 项）和差异检查，结果以本批次命令输出为证据；该证据对应本条日志所在工作区及同批次提交。
- 遗留问题：M01.8 继续未完成。解除条件为用户开启手机开发者模式并按提示重启确认，配置有效签名和匹配的 app/profile，然后运行 uni-app x 最小样例验证网络、扫码、事件通道与证书；USB 连接不代替同 Wi-Fi 验收。其他 M01 未完成项保持原状。
- 对应 Git 提交：本批次唯一提交说明 `docs(M01): record paired iPhone and remaining device prerequisites`；查询命令：git log --all --oneline --grep='^docs(M01): record paired iPhone and remaining device prerequisites$'。本次文档、测试、证据同一提交保存，并推送后核对远程 HEAD。

## 2026-11-03 16:01:14 +08:00｜M01：确认 iPhone 开发者模式开启

- 时间说明：采用本次设备查询批次结束时读取的北京时间。前一次用户开启后复查仍返回 disabled/tunnel unavailable，本次重新查询已明确返回 enabled/connected；不推断前一次缓存或断连的具体原因。
- 修改或新增内容：追加 probes/m01/evidence/ios-preflight-enabled.json，保留此前 preflight 证据原貌；AGENTS.md 更新当前设备状态；PLAN.md 新增 E07，解除开发者模式阻塞，保留签名与应用实机验收未完成；新增文档回归检查以防把开发者模式开启当作应用安装或局域网验收通过。
- 遇到的难题：手机开发者模式和 USB 通信已就绪，但 Mac 有效签名身份仍为 0，单凭设备连通不能安装开发应用或宣称 uni-app x 真机验证完成。
- 处理方式：重新读取 CoreDevice 结构化详情并仅保存非唯一标识的状态字段；签名检查只记录有效身份数量；未变更手机安全设置、未创建签名凭据、未安装应用。继续要求由用户在本机完成开发签名配置，密码及私钥不进入聊天、代码或日志。
- 验证结果：iOS 27.0.1 / iPhone14,2；developerModeStatus=enabled、pairingState=paired、transportType=wired、tunnelState=connected；有效代码签名身份 0。本批次提交前运行 npm test（5 项）与 npm run test:docs（新增检查后 12 项）及 git diff --cached --check，结果以命令输出为证据；无真实应用安装/局域网验收结论。
- 遗留问题：仍需可用开发签名和与 app 匹配的 profile，然后执行 uni-app x 最小真机样例；M01.8 保持未完成。GUI Mac 授权及其他 M01 未完成项仍按原计划推进。
- 对应 Git 提交：本批次唯一提交说明 `docs(M01): confirm iPhone developer mode enabled`；查询命令：git log --all --oneline --grep='^docs(M01): confirm iPhone developer mode enabled$'。文档、证据及测试同批提交，推送后核对本地与远程 HEAD。

## 2026-11-03 16:12:18 +08:00｜M01：验证开发签名并修复 WWDR 证书链

- 时间说明：本批次首次查询为北京时间 16:09:22；本条以后续证书链处理和基座/profile 检查后的读取时间记录，不将它冒充所有操作的精确时间。
- 修改或新增内容：AGENTS.md 更新有效开发签名已识别的现状；PLAN.md 新增 E08 及已验证的 M01.8a 前置子项，保留 M01.8 应用实测未完成；新增 ios-signing-ready.json 脱敏证据、签名就绪不等于安装通过的文档测试，以及 memory/2026-11-03-ios-signing.md 排查记录。主机登录钥匙串补充 Apple 官方 WWDR G3 公共中间证书，未改动信任策略。
- 遇到的难题：用户已创建 Apple Development 身份，security find-identity 能匹配 1 个身份但有效身份为 0。已安装的旧 WWDR 中间证书于 2023 年过期，与新开发证书的 G3 签发者不匹配。单独叶证书链查询可通过，不能代替有效签名身份检查。文档测试初轮还有一项沿用 E07 历史失败状态要求当前计划继续提示创建证书，已改为核验对应历史证据行，避免否认 E08 的新结果。
- 处理方式：先读取并脱敏核对证书签发者、有效期及匹配/有效身份数量；查阅 Apple 官方 WWDR 说明，从 https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer 获取公开 G3 中间证书，验证其系统信任链成功后仅导入登录钥匙串，再复查签名身份。没有导出私钥、创建新的开发身份、删除旧证书或设为始终信任。官方说明为 https://developer.apple.com/help/account/certificates/wwdr-intermediate-certificates 。
- 验证结果：有效身份从 0 变为 1，检测到 Apple Development；官方中间证书验证退出码 0。iPhone 开发者模式 enabled、USB paired/wired/connected。标准 provisioning profile 目录计数为 0；HBuilderX 预期的 uniappx-launcher/base/iPhone_base.ipa 路径未发现基座。本批次提交前运行 npm test（5 项）和 npm run test:docs（新增后 13 项）及差异检查，结果以本批次命令输出为证据；未执行应用签名、安装或同 Wi-Fi 验收。
- 遗留问题：签名身份就绪前置条件解除，但仍需最小 uni-app x 工程、运行基座、匹配的 app/profile 及实际构建安装，不能因证书可识别就勾选 M01.8。Mac GUI 权限和其余 M01 待验收项保持原状。
- 对应 Git 提交：本批次唯一提交说明 `docs(M01): verify development signing and repair WWDR chain`；查询命令：git log --all --oneline --grep='^docs(M01): verify development signing and repair WWDR chain$'。文档、测试及证据同批提交并推送后核对远程 HEAD；主机钥匙串的公开中间证书属于本机环境修复，不随 Git 回滚，开发私钥未进入仓库。

## 2026-11-03 17:02:39 +08:00｜M01：uni-app x 真机安装启动与 Wi-Fi 健康检查

- 时间说明：此为本轮证据整理时间。项目创建日志为 16:25:22，基座安装成功为 16:37:14，最终完整编译成功为 16:42:23，手机健康检查成功日志为 16:45:45.252；这些时间来自实际命令/运行日志。用户完成钥匙串和开发者信任的精确操作时间未核实，不编造。
- 修改或新增内容：通过已登录的 HBuilderX CLI 创建独立 uni-app x VDOM 默认工程，新增手机连接检查页、局域网地址及挑战响应策略；新增只提供健康接口的 Mac 测试服务；新增 Xcode 自动 profile 准备脚本、临时原生目标模板和基座签名脚本；新增地址/响应/服务/页面语法及 profile 策略测试；补充 profile、私钥和 HBuilderX 产物忽略规则；新增复现说明和 ios-mobile-runtime.json 脱敏实机证据；同步三个根目录文档及 npm 入口。
- 遇到的难题：当前 HBuilderX 已更新为 5.34，与早期环境快照不同；CLI 创建项目时在 --path 下增加项目名子目录，首次使用了错误根路径；iOS 编译/运行要求已签名基座；generic/platform=iOS 自动 profile 生成因没有选中设备失败；首次私钥访问等待系统授权；基座安装后 iOS 拒绝未信任开发者的启动；HBuilderX 的 pageQuery 未传到页面；一次诊断日志代码出现多余括号导致差量编译失败；CoreDevice 列表的 tunnel 状态会暂时显示 disconnected，即使详情查询可建立连接。
- 处理方式：以实际 CLI help/schema 为准，使用正确子目录并下载官方 uni-app x 组件；Xcode 明确选择已连接 iPhone，允许自动管理 profile 与设备注册后构建成功；复用有效开发身份，在本机逐项签名 13 个嵌套组件及基座并严格验证，不导出私钥，去掉测试不需的原基座推送/Apple 登录权限；系统工具禁止访问 SecurityAgent，因此由用户在本机完成钥匙串授权；用户在手机信任开发者后，CoreDevice 启动成功；手机页面手动填写 Mac 地址完成实测；修复括号并新增页面脚本静态语法检查，随后真实 iOS 编译通过；自动 profile 脚本改为从已配对列表选设备后查询最新详情，不用列表缓存的 tunnel 状态断定不可达。
- 验证结果：HBuilderX 5.34.2026102909 / uni-app x 编译器 5.34 VDOM；Xcode 自动 profile 构建成功，基座签名验证通过，私钥未导出；iPhone14,2 / iOS 27.0.1 安装成功，用户信任开发者后原生启动退出码 0，设备 App Launch/页面就绪日志出现；最终页面编译和同步成功。手机日志为 M01_HTTP_HEALTH_PASSED network=wifi challenge=matched，Mac 为 health-response fromLoopback=false，用户确认收到 Mac 健康检查响应。证据见 probes/m01/evidence/ios-mobile-runtime.json，只保存脱敏摘要，不保存原始载荷、证书主体、Team ID 或 UDID。提交前执行 npm test（8 项）和 npm run test:docs（18 项，含 profile 策略），并检查暂存差异；结果以本批次最终命令输出为证据。
- 遗留问题：M01.8 仍未整体完成，TLS 证书信任、事件通道和扫码尚未实测；HTTP 健康检查仅交换无敏感数据的挑战值，不提供远程任务接口，不能当作生产认证加密验收。正式手机客户端、多项目远程开发和模型调用尚未接入；Mac GUI 权限及 M01 其他未完成项不提前勾选。开发 profile 有有效期，过期后需重新生成签名安装；IPA/profile/本机 Xcode 文件留在忽略目录，不公开发布。临时 Mac 健康服务用于本轮验证，停止和复现步骤见手机探针 README。
- 对应 Git 提交：本批次唯一提交说明 `feat(M01): add signed iPhone probe and verify Wi-Fi health`；查询命令：git log --all --oneline --grep='^feat(M01): add signed iPhone probe and verify Wi-Fi health$'。代码、测试、证据及三个根目录文档同批提交并推送后核对远程 HEAD；本机账户授权及开发设备注册不随 Git 回滚。

## 2026-11-03 17:38:18 +08:00｜M01：Mac 权限入口、浏览器工具与停止控制

- 时间说明：此为本批次记录整理的北京时间；开始环境读取时间为 17:14:14。权限界面观察及用户操作精确时间未逐项核实，不将整理时间冒充所有操作时间。
- 修改或新增内容：扩展原生 helper 的固定本地 Safari 浏览器验证模式与权限请求命令；桌面界面新增权限状态、显式请求、浏览器验证、截图展示和立即停止；Rust 层新增单验证任务控制、取消进程、超时和应用退出清理；helper 检查父进程存活及 Safari 焦点，只有确认目标 URL/唯一窗口标题后才截取页面内容；新增本机开发签名脚本、UI/无效输入/进程隔离测试、README 及脱敏授权前证据；同步三份根目录文档和 npm 测试/签名入口。
- 遇到的难题：旧应用进程仍在运行，需要退出加载新版；为避免开发构建更换身份影响授权，需复用现有开发证书签名；最初按旧版系统名称引导权限，用户无法定位；实际 macOS 27 页面叫“录屏与系统录音”和“设备控制和数据访问”，录屏列表未列出应用；点击手动添加时先触发系统身份验证，尚未进入应用选择器。
- 处理方式：正常 GUI 退出旧实例，构建并用已有 Apple Development 身份签名 helper、Node 与应用包，严格验证签名，不导出私钥；只通过应用明确按钮发起请求，未替用户开启系统权限；读取系统设置实际页面修正引导，定位手动添加入口，系统触控 ID/密码由用户本人完成，保持身份验证请求待处理。浏览器流程不使用 open URL 冒充输入，改用真实 Cmd+N/Cmd+L/文本/回车，截图限制为已验证的测试页内容，取消只终止本任务 helper，不关闭 Safari 或中止其他子进程。
- 验证结果：npm test 的 10 项测试通过，涵盖界面权限阻塞、成功/取消、手机与 PI 既有检查及原生无效浏览器参数；npm run test:desktop-native 的 3 项 Rust 测试通过，含重复运行拒绝、启动前取消、仅结束所属进程；npm run build:probe 成功，npm run sign:mac-probe 返回签名验证成功。新版 GUI 曾显示两项权限均未授权，系统录屏列表不含应用；手动添加前系统要求用户身份验证。证据见 probes/m01/evidence/desktop-browser-preflight.json。最终 npm test 10 项、Python 文档/profile 检查 19 项和 Rust 原生控制 3 项均通过，共 32 项；git diff --check 通过，暂存后另检查 git diff --cached --check。GUI 浏览器访问、截图、撤销恢复尚未验收，不用自动测试或终端已有权限代替。
- 遗留问题：M01.6 仍未完成，当前等待用户完成系统身份验证并手动添加/允许应用，之后才能做正常 GUI 浏览器实测；授权撤销恢复、Retina/跨屏、实际 GUI 退出/崩溃链和手机剩余项仍按计划保留未完成。当前仅是固定本地测试页的原生工具，尚未由 PI 模型规划驱动，未宣称可自动操作任意网站/软件。开发包未公证；其他已有实机证据保持原貌。
- 对应 Git 提交：本批次唯一提交说明 `feat(M01): add permission-guided desktop browser verification`；查询命令：git log --all --oneline --grep='^feat(M01): add permission-guided desktop browser verification$'。代码、测试、证据及文档同批提交并推送后核对远程 HEAD；不提前填写自身哈希。

## 2026-11-03 21:21:38 +08:00｜M01：安装验证版到应用程序目录

- 时间说明：安装前检查北京时间为 21:18:42，本条使用安装启动和验证后的记录时间，非每个操作精确执行时间。
- 修改或新增内容：将已签名的 f12ef52 验证版复制到 /Applications/Moos M01 Probe.app；同步 AGENTS.md、PLAN.md 的安装位置与 E12；README 补充权限选择路径；新增 desktop-installation.json 和安装就绪不等于权限验收的文档检查。
- 遇到的难题：此前只在仓库 target 目录运行，应用程序文件夹中确实没有该应用，用户因此无法在常用位置选择权限目标。
- 处理方式：检查目标不存在且 /Applications 可写，验证源签名，正常 GUI 退出旧实例；使用 ditto 复制完整 bundle，不覆盖已有未知应用；验证安装版签名并从完整安装路径打开，避免启动旧构建实例。未改变隐私开关、未索取或代输密码。
- 验证结果：源/目标 codesign --verify --deep --strict 均通过；安装 bundle ID 为 dev.moos.m01-probe、版本 0.1.0。进程检查确认唯一实例来自 /Applications；实际点击安装版“运行 PI 本地验证”，界面 status=passed，使用本地模拟模型，无真实服务调用；两项权限仍显示未授权。交付前 npm test 10 项、npm run test:docs 20 项及 npm run test:desktop-native 3 项均通过，共 33 项；git diff --check 通过，暂存后另检查 git diff --cached --check。
- 遗留问题：实际 GUI 浏览器访问与截图仍待权限授权，M01.6 保持未完成；本机安装版未公证，不是正式产品交付。后续更新安装应先检查目标身份并退出已有实例，不混淆 target 产物与安装版。
- 对应 Git 提交：本批次唯一提交说明 `docs(M01): record Applications installation and runtime check`；查询命令：git log --all --oneline --grep='^docs(M01): record Applications installation and runtime check$'。记录、测试及三个根目录文档同批提交并推送后核对远程 HEAD；本机应用副本不随 Git 回滚。

## 2026-11-04 08:43:05 +08:00｜M01：修正权限页面跳转并核实体积

- 时间为本轮整理时间，未核实用户授权和旧版浏览器成功操作的精确时间。
- 修改或新增内容：两个权限命令分别显式打开 Privacy_ScreenCapture 与 Privacy_Accessibility；新增只读路由检查、按钮参数回归测试及 E13 脱敏证据；同步规则和计划。未修改权限开关，未替用户授权。
- 遇到的难题：原实现仅调用系统权限申请 API，实际点击辅助功能后设置仍停在录屏页。
- 处理方式：改为固定的独立系统设置 URL，保留只读权限状态。重新构建、使用现有开发身份签名，退出旧实例后更新 /Applications 安装副本并严格验证签名。
- 验证结果：npm test 11 项通过；npm run test:desktop-native 3 项通过；npm run build:probe 和 npm run sign:mac-probe 成功。安装版实际点击两个按钮，分别观察到“录屏与系统录音”和“设备控制和数据访问”，两项权限均已授权。旧安装版 permission-settings 退出码 2，新版只读路由检查通过，回归覆盖不同路由及 UI 参数。Python 文档检查初次因日志字段合并未符合契约失败，拆分字段后复测；最终 21 项文档/profile 检查通过，总计 35 项自动检查通过，git diff --cached --check 通过。
- 浏览器证据限制：调查期间发现旧版 GUI 已有 passed 报告（实际输入、URL/标记验证、1710×936 页面截图）；但本轮修正版复测失败，reason=target-url-not-observed。不宣称浏览器稳定通过，原因尚未查明；M01.6 保持未完成，解除条件为调查失败并重复实测、补齐撤销恢复。未把历史成功覆盖为失败，也未把本次失败隐藏。
- 体积结果：替换前安装版文件逻辑总量 233.03 MiB，实际磁盘 275.93 MiB；Node 113.72 MiB，PI 依赖逻辑 108.93 MiB（磁盘 151.82 MiB），主程序 4.90 MiB。当前完整内置，无额外运行时下载；未重新测量压缩包。原有压缩包历史基线见 E03。后续验证依赖裁剪与可校验下载/缓存；只把运行时移到应用外不会减少完整落盘体积。
- 遗留问题：小包方案、浏览器稳定性、撤销恢复及原计划其他未完成项仍待验证。本次只验收权限独立跳转，未宣称整体桌面操作完成。
- 对应 Git 提交：本批次唯一说明 `fix(M01): route permission buttons to distinct settings panes`；查询：git log --all --oneline --grep='^fix(M01): route permission buttons to distinct settings panes$'。证据对应提交前工作区；提交推送后核对远程 HEAD，不提前编造提交哈希。

## 2026-11-04 08:57:05 +08:00｜D01：记录暂缓开发的 Git 管理工具插件

- 修改或新增内容：PLAN.md 新增 D01 分八项的后续计划，按 WebStorm 常用 Git 流程覆盖仓库状态、diff/历史、暂存提交、分支标签、远程同步、冲突和 stash、智能体目录锁、分批验收；同步 AGENTS.md 并增加暂缓范围及验收契约测试。
- 遇到的难题：用户新增需求范围较大，要求可暂缓；当前仍在处理 M01 浏览器验证，不能混入首版完成条件或宣称已有 Git 插件。
- 处理方式：独立后续 D01，依赖 M09/M03/M06，全部保持未完成；记录长期对齐目标、具体功能、跨端待定边界、受阻原因和解除条件，当前不增加运行时依赖、不改变客户端实现。
- 验证结果：本次为需求规划变更，人工核对八项均未勾选、无插件已实现声明、包含前置依赖和真实 UI/仓库内容验收；自动检查执行 npm test、npm run test:docs、npm run test:desktop-native，分别为 11、22、3 项通过，共 36 项；git diff --cached --check 通过。
- 遗留问题：Git 插件尚未设计、开发或实测，不能声称与 WebStorm 完全等同。M01 浏览器故障调查继续，未在本次需求记录中改动功能或验收状态。
- 对应 Git 提交：本批次唯一提交说明 `docs(D01): plan deferred Git management plugin`；查询命令：git log --all --oneline --grep='^docs(D01): plan deferred Git management plugin$'。推送后核对远程 HEAD，不提前填写自身哈希。

## 2026-11-04 09:07:37 +08:00｜M01：修复浏览器键盘修饰键继承并验证停止恢复

- 修改或新增内容：原生浏览器输入使用私有 CGEventSource 与显式修饰键，快捷键仅按下携带 Command，抬键/文字/回车清除标志；新增只读事件回归检查，失焦报告增加阶段，地址未识别报告保留输入标志位。新增 E14、专用测试页截图及证据检查，同步三份根文档及探针说明。
- 遇到的难题：复现期间既遇到 safari-lost-focus，也遇到 target-url-not-observed；仅凭错误无法判断。旧实现 Cmd+L 的抬键仍携带 Command，后续 nil 事件源的文字事件继承系统状态。
- 处理方式：先增加阶段/位标志诊断并从正常 GUI 重现，捕获 textEventFlags=537919488，Command 位 1048576 确实置位；随后统一事件构造并清除非快捷键状态，未更改目标 URL 核验条件。构建签名后退出旧实例，验证源/目标签名，再复制到 /Applications 并正常 GUI 启动。只记录阶段和标志，不记录其他网页载荷。参考 Apple CGEventSourceStateID 与 keyboardSetUnicodeString 官方说明，实际根因以本机诊断和修复前后行为为准。
- 验证结果：npm test 11 项通过（新增实际事件构造标志断言，无输入注入）；npm run test:desktop-native 3 项通过；npm run build:probe、npm run sign:mac-probe 与安装目标签名验证通过。旧安装版 keyboard-events 模式退出 2；诊断版在旧输入行为下复现带 Command 的失败。修复后 GUI 初始连续三次 passed，再一次 passed；首次停止点击发生在任务已完成之后，未计为取消验收，随后同一界面操作批次实际停止，界面为“本次验证已停止。”、报告 cancelled 且无截图，之后新任务 passed。共五次成功均核对 URL/窗口标记并返回 1710×936 测试页截图，最终截图已人工查看且 SHA-256 写入 E14。证据对应提交前工作区，源码基线和各次本地报告标记见 E14。npm run test:docs 23 项通过，合计 37 项自动检查通过；git diff --cached --check 通过。npm run verify:probe 包内离线 PI 模拟验证通过（无桌面输入，不能替代上述 GUI 证据）；新 ZIP 75,283,046 字节，逻辑应用 244,364,223 字节，磁盘 289,353,728 字节，完整内置体积未优化，报告摘要见 E14。
- 遗留问题：权限撤销/恢复需要用户在系统安全界面实际操作后验证；M01.6 继续未完成。Retina/跨屏与 GUI 崩溃链未验收，固定页工具尚未由模型驱动，不代表任意网站自动操作或正式产品完成。此前失败报告和日志保持不变。
- 对应 Git 提交：本批次唯一提交说明 `fix(M01): isolate browser keyboard modifier state`；查询：git log --all --oneline --grep='^fix(M01): isolate browser keyboard modifier state$'。本机安装副本不随 Git 回滚；提交推送后核对远程 HEAD，不提前编造哈希。

## 2026-11-04 09:27:00 +08:00｜M01.6：录屏和辅助功能分别撤销与恢复实机验收

- 时间说明：此为记录整理北京时间；用户在系统设置切换开关的精确时间未独立核实，各次应用报告通过唯一 ID 对应，不以整理时间冒充每次操作时间。
- 修改或新增内容：新增 E15 脱敏证据，更新 UI 回归测试覆盖“已有成功截图 → 撤销任一权限 → 隐藏旧截图/拒绝执行 → 恢复 → 新任务通过”；文档检查校验两种真实 GUI 撤销/恢复证据，修正旧授权前快照测试不应永久锁定当前计划为未完成；同步 AGENTS.md、PLAN.md 及探针 README，M01.6 本机项完成，M01 整体保持未完成。未改运行时代码、未重打包安装。
- 遇到的难题：两项系统权限必须分别操作，旧成功截图和初始权限文字不能代替当前检查；授权前的历史文档测试硬编码 M01.6 必须未完成，与后续真实验收状态不符。
- 处理方式：所有开关均由用户在系统设置操作；使用 /Applications 中 cfec622 的正常 GUI 安装版，每次重新检查并点击真实浏览器按钮，核对独立报告与截图文件有无。更新测试依据 E15 检验完成证据，同时保留 E11/E12/E13/E14 当时的未授权、失败或待验收事实，不改历史日志。
- 验证结果：录屏撤销时 screenCaptureGranted=false、accessibilityGranted=true，任务 blocked/system-permission-required，无截图；录屏恢复后实际输入 URL、核对 URL/窗口标记、1710×936 页面截图 passed。辅助功能撤销时两项分别 true/false，界面显示未授权，任务同样 blocked 且旧截图已隐藏，无本次截图；恢复后重新检查两项 true，新浏览器任务及截图 passed，最终截图已查看，哈希与本机路径见 E15。npm test 12 项通过；npm run test:desktop-native 3 项通过；npm run test:docs 24 项通过，共 39 项自动检查通过；git diff --cached --check 通过。应用代码未变化，继续复用 cfec622 已验证构建与签名；本轮再次 codesign --verify --deep --strict 验证通过，进程路径确认来自 /Applications。
- 遗留问题：M01.7 完整 GUI 退出/崩溃链、Retina/跨屏坐标和 M01.8 手机剩余通信尚未验收；本次不代表模型驱动电脑任务或正式产品完成，后续更换系统/签名身份需重新实测。Git 插件 D01 仍暂缓。
- 对应 Git 提交：本批次唯一提交说明 `test(M01): verify GUI permission revocation and recovery`；查询命令：git log --all --oneline --grep='^test(M01): verify GUI permission revocation and recovery$'。证据对应提交前测试/文档工作区，实际运行应用为 cfec622；推送后核对远程 HEAD，不提前填写自身哈希。

## 2026-11-05 08:08:01 +08:00｜M01.7a：正常 GUI 退出的运行时链清理

- 修改或新增内容：Tauri 增加 RuntimeControl 子进程登记，固定权限/PI 验证进程完成或异常后移除登记；退出开始后拒绝新进程，已登记进程先收 SIGTERM，3 秒未退出再 SIGKILL 并回收，保留既有浏览器 helper 取消路径。stdout/stderr 由独立线程持续排空，成功后 stdout 最多等待 1 秒，避免大体积输出或后代继承管道阻塞退出。新增 PI 活跃保持、原子 hold 文件及正常 Tauri 退出专用验证参数、打包进程退出断言、11 项原生测试、E16 脱敏证据和文档契约；同步三个根文档及探针 README。
- 遇到的难题：原退出事件只取消浏览器 helper，Node 宿主只能依赖自身父进程看门狗；Rust 标准库没有直接发送 SIGTERM 的 Child API。独立代码审查发现 SIGKILL 回退和无关进程隔离缺少直接测试，并指出大体积 stderr 与后代继承 stdout 可能破坏有界退出；hold 文件直接写入也存在监视者读到部分 JSON 的竞态。
- 处理方式：通过 libc 发送固定 SIGTERM，登记器在锁内完成关闭状态检查与子进程登记，避免退出和新增进程竞态；不引入任意 shell 参数或结束 Safari。按 TDD 为 SIGKILL、无关进程、大体积 stderr 和后代管道分别补充失败测试后修复；hold 文件改为临时文件写完后原子 rename。打包验证仅在测试参数下记录临时 PID 并调用正常 Tauri 退出，提交证据不保存 PID。
- 验证结果：macOS 27.0.1/arm64。`npm test` 12 项通过；`npm run test:desktop-native` 11 项通过，覆盖 SIGTERM、SIGKILL 回退、退出后拒绝新进程、运行中进程清理、完成后移除登记、无关进程隔离、大体积 stderr 和后代输出等待上限；`npm run test:docs` 25 项通过。`npm run build:probe` 与 `npm run verify:probe` 通过，最终报告 recordedAt=2026-11-05T00:08:01.670Z，本地模拟模型 PI 活跃时正常退出后 Node 宿主与真实 PI 子进程均不存在，ZIP SHA-256 为 d1949b1380120b70fea490f66bea812338dedeca1d30e6370a131c76b2630f89。证据对应提交前工作区，见 probes/m01/evidence/desktop-gui-exit.json。
- 遗留问题：只覆盖正常 Tauri 退出，不覆盖应用被强制终止或崩溃后的清理；多个顽固子进程目前串行等待，最坏退出耗时随数量增加；Retina、跨屏坐标及 M01.8 手机剩余通信仍未验收，M01.7 和 M01 整体保持未完成。真实 GLM/中转站、正式产品任务链和多项目隔离不在本次范围。
- 对应 Git 提交：本批次唯一提交说明 `fix(M01): clean up runtime children on GUI exit`；查询命令：git log --all --oneline --grep='^fix(M01): clean up runtime children on GUI exit$'。提交并推送后核对远程 HEAD，不预填自身哈希。

## 2026-11-05 08:15:45 +08:00｜M01.7a：GitHub 推送与远程核验

- 修改或新增内容：补记 M01.7a 实现提交的首次推送失败、凭据处理和远程验收结果，不改变运行时实现或阶段完成范围。
- 遇到的难题：首次 `git push origin main` 返回 HTTP 403，Git 默认凭据身份 xuguopeng 无权写入 xumuyan/moos-agent。
- 处理方式：保留本地提交，确认 GitHub CLI 活动账号为仓库所有者 xumuyan；仅本次 Git 命令显式使用 `gh auth git-credential` 凭据助手，未修改全局 Git 配置、未强制推送或暴露凭据。
- 验证结果：实现提交 `eb9609113900654a804fd86ab71291c30e5699e3` 推送成功；`git ls-remote origin refs/heads/main` 与 `git rev-parse HEAD` 均为该哈希，远程 main 与本地 HEAD 一致，工作区在本条文档补记前干净。
- 遗留问题：M01.7 的崩溃清理、Retina 和跨屏坐标仍未验收，M01 整体未完成；本条只记录远程交付，不扩大 E16 验收范围。
- 对应 Git 提交：已推送实现提交 `eb9609113900654a804fd86ab71291c30e5699e3`；本条补记使用唯一提交说明 `docs(M01): record GUI exit remote delivery`，查询命令：git log --all --oneline --grep='^docs(M01): record GUI exit remote delivery$'。

## 2026-11-05 08:45:24 +08:00｜M01.7b：打包 GUI 强制终止后的运行时链验收

- 修改或新增内容：扩展 `scripts/verify-m01.mjs`，异步启动打包探针并等待 PI 活跃 hold，仅对本次探针 App 发送 SIGKILL，在有界时间内核对 App、Node 宿主及真实 PI 子进程退出。新增 `scripts/owned-processes.mjs` 统一有界等待与失败清理，4 项真实/模拟回归覆盖进程回收、清理失败报告、exit 等待超时及 Promise 拒绝；新增 E17 脱敏证据和文档契约，同步 PLAN、AGENTS、探针 README；无需修改应用生产代码。
- 遇到的难题：正常 Tauri 退出事件无法处理 SIGKILL，必须单独验证 Node 父进程看门狗与 PI 关闭链；测试还必须避免误杀 Safari 或无关进程。新增文档契约首轮因 PLAN 尚无 E17 而按预期失败。独立审查指出初版失败清理只发信号、不等待也不报告清理失败，不能证明失败后无进程泄漏；复审又指出 App exit 等待缺少超时、exit Promise 拒绝可能绕过错误聚合。
- 处理方式：复用原子 hold 报告取得本次 Node/PI 测试 PID，只向新启动的探针子进程对象发送 SIGKILL；随后每 50ms 检查两个运行时 PID，最多等待 10 秒。审查后先观察清理辅助模块不存在的失败，再实现统一清理：等待 App exit 和所有本次 PID 消失，清理失败与原验证错误一起通过 AggregateError 显式报告；App exit 等待统一设置 10 秒上限，Promise 拒绝转为清理错误返回，4 项回归通过。全程使用本地模拟模型，不读取真实模型凭据。补齐 E17 计划和证据记录，不扩大坐标验收范围。
- 验证结果：macOS 27.0.1/arm64。首次、重新构建后及两轮审查修复后的 `npm run verify:probe` 均通过，最终报告 recordedAt=2026-11-05T01:05:09.538Z；PI 活跃时探针 App 被 SIGKILL 后，App、Node 宿主与真实 PI 子进程均退出。`npm test` 16 项（含 4 项清理回归）、`npm run test:desktop-native` 11 项、`npm run build:probe` 通过；`npm run test:docs` 26 项通过。ZIP SHA-256 为 d2f3f84aac7390591b5681f5c57fb32c34d567d6ef01917261b21f2613c1bb22，证据对应提交前验证脚本工作区。
- 遗留问题：只覆盖显式 SIGKILL 强制终止，不模拟断电或内核异常；Retina、跨屏坐标仍未验收，M01.7 和 M01 整体保持未完成。真实 GLM/中转站和正式产品任务链不在本次范围。
- 对应 Git 提交：本批次唯一提交说明 `test(M01): verify GUI crash runtime cleanup`；查询命令：git log --all --oneline --grep='^test(M01): verify GUI crash runtime cleanup$'。提交并推送后核对远程 HEAD，不预填自身哈希。

## 2026-11-05 11:09:02 +08:00｜M01.7c：当前双屏自身窗口坐标有限验收

- 时间说明：此为日志编写前读取的北京时间；打包验收报告时间 2026-11-05T02:58:03.526Z 对应北京时间 10:58:03.526，非日志时间。
- 修改或新增内容：原生 helper 新增无输入/截图的逐屏报告、坐标计划及输入焦点检查模式；自测支持显式目标屏，将窗口放于目标屏中央。AppKit 到 CG 的全局坐标换算与像素尺寸取整使用共享函数；浏览器和自身窗口捕获使用 SCContentFilter.pointPixelScale。新增 E18、测试并同步计划、规则与探针说明。
- 遇到的难题：原报告 screenScale=1 仅是当前 NSScreen.main 的值，不能据此断言 Retina 故障；物理分辨率除逻辑点也不一定等于 backing scale（本机内置屏逻辑宽度 1710、物理宽度 2880，但 backing scale 为 2）。独立审查发现旧自测点击后未再次确认输入框焦点、键盘可能继承修饰键；尺寸断言不能证明原生清晰度。
- 处理方式：先运行新增逐屏、坐标与焦点门禁测试，观察缺少模式时失败，再实现；点击后等待 200ms，重新确认 active/key/field editor 后才通过已有私有事件源输入，失焦停止不抢焦。记录独立 NSScreen scale 和捕获过滤器 scale；缩小验收声明，仅接受自身窗口输入与配置像素尺寸，明确不接受清晰度或 Safari Retina。复审在该有限范围下无阻断问题。未操作 Safari、未覆盖安装版或系统授权。
- 验证结果：macOS 27.0.1/arm64，`npm test` 16 项、`npm run test:desktop-native` 11 项通过；构建与 `npm run verify:probe -- --desktop-input` 通过，正常/强制 GUI 退出回归也通过。1× 主屏点击 (960,544)，520×232 点窗口输出 520×232 像素；左侧 2× Retina 副屏点击 (-855,591)，同尺寸窗口输出 1040×464 像素，输入均成功。ZIP SHA-256 为 69afbda89b07143f85b70ce9d423ee4f15a175c54dcc291c6e09ab58610f53aa；证据对应提交前工作区。最终文档测试及差异检查以提交前命令输出为准；截图内容未独立像素校验。
- 遗留问题：原生清晰度、Safari Retina、镜像/旋转/热插拔及其他屏幕排列未验收；坐标数学夹具不是额外硬件证据。M01.7 与 M01 整体保持未完成。截图留在忽略目录，仅提交脱敏 JSON。
- 对应 Git 提交：本批次唯一提交说明 `test(M01): verify own-window dual-display coordinates`；查询命令：git log --all --oneline --grep='^test(M01): verify own-window dual-display coordinates$'。按仓库规则提交推送后核对远程 HEAD，不预填哈希。

## 2026-11-05 13:21:18 +08:00｜P01：正式桌面 PI 聊天与多项目子集

- 时间说明：此为本批次收尾前读取的北京时间，不代表所有开发和验证的精确时间；证据对应本次提交前工作区。
- 修改或新增内容：建立正式 Tauri 2 / React / TypeScript / Ant Design X 桌面、SQLite 项目会话任务事件存储、并发 2 与同规范化路径串行调度、真实 PI 1.5.0 RPC 适配、流式聊天和真实工具记录、单任务停止、模型设置与原生 Keychain 桥。增加本地 fixture、端到端验收、原生与界面测试及完整运行时打包入口；同步 PLAN.md 和文档检查。手机、桌面控制、自动模型路由暂缓，保留此前 M01 未完成结论。
- 遇到的难题：PI 任务字段和模型默认上限不一致；原生检测错误使用未启用的全局对象；流式拆分密钥可能越过逐块脱敏；配置同时写入同一临时文件；关闭超时不能重试；全量历史超过原生 4 MiB 帧会断开；多轮工具记录顺序错误；慢启动使取消测试出现假失败；React 19 需要 Ant Design 官方兼容补丁；原生同名开发/打包进程的 AppleScript 选择发生歧义。
- 处理方式：先失败测试再最小修复任务映射、流式脱敏、配置串行与失败回滚、共享关闭等待及重试、历史有界分页/大行分块、原生 isTauri IPC 和多轮时间线；取消测试等待真实 PID 并始终清理；使用官方 React 补丁。通过直接 PID 绑定 AX 检查纠正 GUI 身份误判，不把开发窗口中的 fixture 内容归给打包版。所有模型测试仅用本地模拟模型，不读取已有真实模型凭据。
- 验证结果：主代理最终当前 `npm test` 54/54、`npm run test:docs` 28/28、正式桌面 Rust 8/8、旧探针 Rust 11/11 通过；前端当前 14/14 与 TypeScript/Vite 构建通过（历史分页界面仍在收尾，最终结果另补）。浏览器实际提交 UI_A/UI_B 均产生真实 PI write/bash 和各自结果；HOLD 第二次运行已停止且未添加成功回复；首个 HOLD 在点击停止前已自然完成，不能算作取消证据。表单空值拦截、无 localStorage 数据、当前控制台无错误。`npm run build:app` 成功，包内 Node 的独立 snapshot/shutdown 通过；完整本地包约 230 MiB，磁盘分配约 273 MiB，非最终小包。根及桌面生产依赖 `npm audit --omit=dev --registry=https://registry.npmjs.org --audit-level=high` 均报告 0 漏洞。截图已保存到忽略目录但读取工具未呈现像素，不声称视觉截图独立验收。最终差异检查和后续验收以提交前实际命令为准。
- 遗留问题：真实模型未验收；用户须在正式应用本机填写模型配置后验证 GLM/中转站。不以本地 fixture 证明服务能力、图片输入或计费。打包 GUI 通过 PID 绑定 AX 操作添加一个自建临时项目和新会话，正常关闭并重启后 SQLite 和 GUI 保留相同 ID，证据 /tmp/moos-native-accept-6db29f/32-sqlite-after-restart.txt 与 33-ui-restored.txt；这不覆盖活跃任务退出。钥匙串表单填写受阻，未成功保存测试模型，不记录为 Keychain 已验收；打包 GUI 完整聊天仍待真实配置实测；本地包为 ad-hoc 签名，未公证或正式安装。前端仍有大 chunk 警告及 jsdom 高度 NaN 警告；不影响已执行测试通过，不隐瞒。任意 shell 不是系统沙箱，脱敏不保证阻止任意编码外传。尚未推送，不提前记录远程成功。
- 收尾复验：`npm test` 59/59、文档 28/28；`npm --prefix apps/desktop test -- --maxWorkers=1` 23/23；正式 Rust 8/8、探针 Rust 11/11；最终 `npm run build:app` 通过。前端并行执行曾有一项 20 秒超时，单工作进程全量通过，保留该资源竞争限制。原生测试曾因时间戳临时目录冲突失败，加入进程内原子编号后全量重跑通过。新增历史版本变化回归先失败后通过；后端修复活跃任务被历史挤出、可变记录分块混合和元数据失控，任务接纳上限 128。浏览器用自建 fixture 的 65 条历史验证分页/返回最新、120200 字节大行完整还原（内容 40014 字符），没有调用真实模型。真实模型、Keychain 系统交互与完整原生聊天仍未验收。
- 对应 Git 提交：本批次唯一提交说明 `feat(M02-M04): add multi-project PI desktop chat`；查询命令：git log --all --oneline --grep='^feat(M02-M04): add multi-project PI desktop chat$'。完成验证后按规则提交推送并核对远程 HEAD。

## 2026-11-05 13:59:44 +08:00｜P01：工作空间使用系统目录选择器

- 修改或新增内容：移除添加项目的绝对路径输入框，两个添加入口直接调用原生文件夹选择器；取消不写入，选择后切换到所选项目，重复目录沿用服务端规范化去重。增加 rfd 原生依赖与锁文件、选择/取消/异常/原生 IPC 和刷新竞态回归，同步 PLAN.md。
- 遇到的难题：原按钮文字称选择目录，实际只打开输入框且没有原生命令；后台轮询可能覆盖添加后的项目选择。
- 处理方式：新增独立 pick_directory 命令，异步打开 macOS 系统窗口，不通过 Node 或浏览器传递选择命令；保留待选 ID 至快照包含项目后再切换。先观察选择流程及竞态测试失败再修复。浏览器明确提示使用桌面应用，不假装能获取本地绝对目录。
- 验证结果：前端 `npm --prefix apps/desktop test -- --maxWorkers=1` 28/28、`npm test` 59/59、文档 28/28、探针原生 11/11；正式原生 8/8 与首次选择器打包通过，最终前端竞态修复后的 `npm run build:app` 重打包亦通过。目录选择与项目切换竞态均观察失败后修复通过；原生 IPC 测试最初误期望 undefined 参数，按 Tauri 默认空对象修正后通过。旧版 0bfed17784889d002b22055a70ce2ca0794ddb21 已推送且远程 HEAD 一致，本条不提前宣称新改动已推送。
- 实机证据：macOS 27.0.1/arm64，debug PID 39983 绑定 AX；picker-05-sheet.txt 第 74 行出现原生 AXSheet/open-panel、第 397—400 行有“选择项目目录”与 Cancel/Open，取消后 picker-07-after-cancel.txt 恢复项目界面。证据位于 /tmp/moos-native-accept-6db29f。新增目录及重复选择未完成：前台变为 loginwindow，且共享项目状态出现并发干扰；未向非目标应用输入，未把有限取消证据当成完整 ID 不变验证。
- 遗留问题：目录新增/去重完整实机验收需桌面解锁且暂停其他 GUI 操作后补验；真实模型、Keychain 系统交互及完整原生聊天仍未验收；现有 jsdom NaN 高度和 Vite 大 chunk 警告保留，不因本次选择器改动宣称解除。
- 对应 Git 提交：本批次唯一提交说明 `fix(M03): select workspace directories with native dialog`；查询命令：git log --all --oneline --grep='^fix(M03): select workspace directories with native dialog$'。

## 2026-11-05 14:29:03 +08:00｜P01：模型列表与配置诊断

- 时间说明：此为本批次收尾阶段读取的北京时间，验证跨越其后时间；证据对应本条所在提交前工作区。
- 修改或新增内容：设置增加获取模型列表、可选或手填模型 ID、当前草稿短文本测试与状态/耗时；原生桥支持临时密钥优先和编辑空密钥复用，不保存诊断草稿。后端支持两个 OpenAI 协议、安全错误分类、8 秒含响应体超时、1 MiB 响应及 500 个模型上限、禁止重定向。新增后端、原生、界面和文档测试；同步 PLAN.md。
- 遇到的难题：原生通用错误会隐藏诊断原因；外部错误文本可能泄露密钥；单宿主锁会令慢诊断延迟停止任务；原有目录刷新测试默认 1 秒等待与 1 秒轮询相撞，全量界面测试并行负载时还出现 20 秒交互超时。
- 处理方式：诊断使用固定脱敏结构化结果，不返回上游原文；HTTP 200 仍校验完成状态与实际文本；过期草稿结果不展示。独立诊断通道不打开任务数据库；按先失败再通过补充通道隔离测试。目录刷新等待调整为 2.5 秒，不改变生产轮询；保留失败记录并在最终单独运行界面全量复验。
- 验证结果：本批次主代理 `npm test` 109/109、正式原生初版 10/10、旧探针 11/11、文档新增边界检查先失败后 29/29；根与桌面生产依赖 npm audit 均 0 漏洞。最终通道修复、界面全量及打包结果在收尾复验字段追加，不以初版结果替代最终状态。
- 实际验收：macOS 27.0.1/arm64，Vite 127.0.0.1:1420，独立临时 fixture；浏览器实际编辑服务、空密钥获取列表及下拉 fixture、测试 completions 成功 HTTP 200/6 ms，草稿切换 responses 测试成功 HTTP 200/25 ms。手填 missing-model 返回协议错误 HTTP 400，非法 URL 被表单拦截，修改清除旧成功结果；快照仍保存原 completions/fixture，localStorage 为空，控制台无错误或警告。所有上游为本地模拟服务，无真实密钥读取或外部计费；浏览器结果不替代正式 macOS 钥匙串授权验收。
- 遗留问题：真实模型未验收，需用户在正式应用填写服务后实测；列表接口不可用不代表推理不可用，短文本成功也不代表工具/图片能力。原有 Keychain 系统授权、完整打包 GUI 聊天及目录选择部分实机验收仍待补验；jsdom NaN 高度和 Vite 大 chunk 警告未处理。
- 收尾复验：最终 `npm run test:desktop-product` 12/12、`npm test` 109/109、`npm run test:docs` 29/29、旧探针 11/11；`npm --prefix apps/desktop test -- --maxWorkers=1 --testTimeout=60000` 41/41，默认 20 秒在高负载下的失败保留，不宣称默认期限全量稳定。`npm run build:app` 通过，TypeScript/Vite 与 Rust release 均成功；包内 Node 以 --diagnostics 处理 missing_key/shutdown 正常退出且未创建任何存储。独立通道测试在本地 HTTP 诊断等待期间，对活跃任务的 snapshot/cancel 均在 1 秒内完成；不替代 Tauri 命令路由及 GUI 退出的端到端验收。设置与隔离补丁均经只读审查，无阻塞问题；路由/双宿主 GUI 退出的自动集成覆盖仍可补充。最终差异和 Rust 格式检查通过，日志修订后再运行文档检查。
- 对应 Git 提交：本批次唯一提交说明 `feat(M04): add model listing and safe provider diagnostics`；查询命令：git log --all --oneline --grep='^feat(M04): add model listing and safe provider diagnostics$'。验证后提交推送并核对远程，不预填未知哈希。

## 2026-11-05 16:54:03 +08:00｜P02：确认 DSH 风格前端、插件与长任务运行时设计

- 修改或新增内容：新增 `docs/superpowers/specs/2026-11-05-dsh-ui-plugin-design.md`，固定 DeepSeek Harness 参考提交与 MIT 许可边界，设计 Moos UI Adapter、页面和设置结构、三档权限、Token/缓存/费用口径、`plugin.json`、固定 Slot、插件沙箱、皮肤变量、单一隐藏运行时、长任务策略、内置终端及分阶段验收；PLAN.md 新增 P02.1—P02.9，全部保持未完成；文档测试新增“已确认设计不能冒充已实现”的约束。本批次没有修改产品运行时代码，也未宣称页面、插件、长任务或终端已经可用。
- 遇到的难题：首次文档测试因设计稿写作“单一隐藏的 Moos Agent Runtime”，与测试要求的统一术语“单一隐藏运行时”不一致；随后自查发现测试还要求明确插件包入口名 `plugin.json`。隔离工作区首次执行正式 Rust 测试时，`build.rs` 因尚未准备内置 Node 而退出 101。附加 `cargo fmt --check` 发现历史 M01 探针现有源码与当前 rustfmt 输出不一致。
- 处理方式：统一设计术语并明确 `plugin.json` 契约；运行仓库已有 `npm run prepare:runtime` 后原样重跑正式 Rust 测试。格式检查只读执行，没有格式化或夹带历史探针变更；该基线问题保留为遗留项。本批次在独立工作树完成，未覆盖原工作区中其他开发者尚未提交的改动。
- 验证结果：`npm run test:docs` 30/30、`npm test` 109/109、`npm run test:desktop-ui` 41/41、准备运行时后 `npm run test:desktop-product` 12/12、`npm run test:desktop-native` 11/11 均通过；文档设计验收通过，`git diff --check` 通过。桌面 UI 测试仍输出既有 jsdom `NaN` 高度警告但用例通过。首次正式 Rust 测试在环境前置条件缺失时退出 101，补齐运行时后通过；探针 `cargo fmt --check` 未通过，显示的是已有探针格式差异。本批次没有启动产品 GUI 或执行功能实机验收，因为交付范围仅为设计与计划，不能以文档测试替代后续实现验收。
- 遗留问题：P02.1—P02.9 均待实施；当前逐任务 Node 启动、600000ms 上限和通用 `Task execution failed` 仍存在。PI SDK 单运行时必须先完成会话恢复、并发、取消、工具事件、模型代理与退出清理验证；插件沙箱、皮肤、Token/缓存统计、终端和 DSH 风格页面均未实现。M01 探针 rustfmt 基线差异、桌面 UI jsdom 警告也未在本次范围处理。
- 对应 Git 提交：本批次唯一提交说明 `docs(P02): define DSH UI and plugin architecture`；查询命令：`git log --all --oneline --grep='^docs(P02): define DSH UI and plugin architecture$'`。提交并推送后核对远程 HEAD，不预填未知哈希。

## 2026-11-05 16:55:39 +08:00｜P02：设计提交的 GitHub 推送与远程核验

- 修改或新增内容：补记 P02 设计提交的推送过程与远程验收结果，不修改设计范围、产品代码或 P02 完成状态。
- 遇到的难题：默认 `git push origin HEAD:main` 使用无仓库写权限的本机账号 xuguopeng，GitHub 返回 HTTP 403。
- 处理方式：保留本地提交，确认 GitHub CLI 当前活动账号为仓库所有者 xumuyan；仅对本次 Git 命令使用 `gh auth git-credential`，未修改全局 Git 配置、未强制推送、未记录或输出原始令牌。
- 验证结果：设计提交 `81bb914575572e26b70488e4800feccf071d64d6` 已快进推送至 GitHub main；`git ls-remote origin refs/heads/main` 与当时本地 HEAD 均为该哈希。该结果只证明设计文档远程交付，不证明 P02 功能实现。
- 遗留问题：P02.1—P02.9 继续全部未完成；本条日志自身仍需按仓库规则提交、推送并再次核对远程。
- 对应 Git 提交：已推送设计提交 `81bb914575572e26b70488e4800feccf071d64d6`；本条补记使用唯一提交说明 `docs(P02): record design remote delivery`，查询命令：`git log --all --oneline --grep='^docs(P02): record design remote delivery$'`。

## 2026-11-05 17:11:11 +08:00｜P02：九批实施计划与运行时迁移门禁

- 修改或新增内容：新增 `docs/superpowers/plans/2026-11-05-dsh-ui-plugin-implementation.md`，将 P02.1—P02.9 拆为第三方边界/UI Adapter、完整页面、PI SDK 单运行时门禁、长任务、Usage、Slot/皮肤、本地插件沙箱、Tauri 原生 PTY 和系统验收九批；每批列出具体文件、测试先行步骤、实际验收、提交说明和完成条件。PLAN.md 链接实施计划并保持九项全部未完成，修正旧架构文字为“SDK 门禁通过前保留 RPC，迁移后只保留一条正式路径”。设计稿按当前仓库规则统一为 macOS Keychain，不再写本地密钥文件。新增文档契约测试约束计划顺序、RPC 回退门禁和未完成状态。
- 遇到的难题：brainstorming 工作流要求下一步使用 writing-plans，但当前会话没有该技能，只能采用等价的手工实施计划模板。新增文档测试首轮因“SDK 验证通过以前”和测试中的“门禁通过以前”措辞不一致失败；修正后第二轮又发现计划只写“原生 PTY”，没有完整写出测试要求的“Tauri 原生 PTY”。梳理现状还发现 Tauri 正式产品同时维护普通和诊断两个 Node 宿主，旧 PLAN 的“不同时维护 SDK”与用户已确认的 P02.3 可行性门禁冲突。
- 处理方式：完整阅读 brainstorming 技能并在用户确认书面设计后只进入计划阶段，未修改产品代码；根据现有 App、Controller、Store、PI adapter、Rust host 和测试入口逐文件拆解实施步骤。将测试锁定为更准确的 SDK 门禁措辞，并在计划标题明确 Tauri 原生 PTY；把双宿主合并和逐任务 spawn 移除列入 P02.3 验收矩阵，门禁失败时明确保留 RPC。自检扫描 TODO/TBD、旧密钥文件文字和旧 SDK 冲突文字，均无残留。
- 验证结果：最终 `npm run test:docs` 31/31、`npm test` 109/109、`npm run test:desktop-ui` 41/41、`npm run test:desktop-product` 12/12、`npm run build:desktop` 和 `git diff --check` 通过。文档测试两次预期失败均已如实保留在本条：第一次缺少精确 SDK 门禁短语，第二次缺少完整“Tauri 原生 PTY”短语。桌面 UI 仍有既有 jsdom `NaN` 高度警告，生产构建仍有 804.37 kB chunk 警告；本次未启动 GUI 实测，因为范围仅为实施计划和契约修订，不能据此宣称 P02 功能可用。
- 遗留问题：P02.1—P02.9 全部尚未实施；当前两个正式 Node 宿主、逐任务 PI RPC spawn、600000ms 上限和通用 `Task execution failed` 仍存在。下一批从 P02.1 的第三方清单和失败测试开始，完成并推送前不启动 P02.2/P02.3。真实模型、超过 10 分钟任务、进程树、插件沙箱、皮肤和 PTY 均待对应批次实际验收。
- 对应 Git 提交：本批次唯一提交说明 `docs(P02): add phased implementation plan`；查询命令：`git log --all --oneline --grep='^docs(P02): add phased implementation plan$'`。验证后提交推送并核对远程，不预填未知哈希。

## 2026-11-05 17:12:09 +08:00｜P02：实施计划 GitHub 远程交付核验

- 修改或新增内容：补记 P02 九批实施计划提交的 GitHub 推送与远程核验结果，不修改实施计划、产品代码或任务完成状态。
- 遇到的难题：本条未遇到新的推送错误；为避免使用默认无权限 Git 身份，沿用已确认的 GitHub CLI 活动账号完成本次推送。
- 处理方式：仅对本次推送命令使用 `gh auth git-credential`，未修改全局 Git 配置、未强制推送、未记录原始令牌；推送前确认远程 main 等于本次提交的直接父提交，保证快进。
- 验证结果：实施计划提交 `e19115627266bc86396c79a5f89934ef4aec0cce` 已快进推送至 GitHub main；`git ls-remote origin refs/heads/main` 与当时本地 HEAD 均为该哈希。该结果只证明计划远程交付，不证明任何 P02 产品功能完成。
- 遗留问题：P02.1—P02.9 全部未实施；下一步仍从 P02.1 开始。本条日志自身需创建独立提交、推送并再次核对远程。
- 对应 Git 提交：已推送计划提交 `e19115627266bc86396c79a5f89934ef4aec0cce`；本条补记使用唯一提交说明 `docs(P02): record implementation plan delivery`，查询命令：`git log --all --oneline --grep='^docs(P02): record implementation plan delivery$'`。

## 2026-11-05 17:31:13 +08:00｜P02.1：第三方边界、UI Adapter 与静态 AppShell

- 修改或新增内容：新增根目录 `THIRD_PARTY_NOTICES.md` 和 DeepSeek Harness 文件级来源记录，固定 `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`、MIT 与 Copyright (c) 2026 DeepSeek；P02.1 采用 Moos 独立实现，未复制上游源码、品牌或图形素材。新增 Snapshot→Workspace ViewModel、类型化 UI 命令白名单和敏感参数拒绝；新增 AppShell、工作区/会话侧栏、对话主区、响应式上下文栏、输入 Dock 和主题变量，将正式 App 接入而不改变后端方法语义。新增 5 项适配器/组件测试和 E19 脱敏证据；PLAN.md 将且仅将 P02.1 勾选完成，P02.2—P02.9 保持未完成。
- 遇到的难题：三组测试先因实现文件不存在按预期失败；完整 UI 回归随后有 2 项失败，原因是无参数 `pick_directory` 经新命令适配器额外传入空对象，破坏旧桥调用形状。本机另一工作区已占用 4318/1420，不能停止无关进程。browse 技能默认查找旧 `~/.claude` 路径，实际工具位于 Codex 目录；继续启动又发现缺少 Bun，官方安装脚本当前 SHA-256 `04882bf...` 与技能固定安全值 `bab8acf...` 不一致，未执行安装。浏览器实际视口只有 872px，右栏按响应式断点隐藏，不能冒充宽屏视觉验收。
- 处理方式：先保留失败测试再实现最小契约；无参数命令恢复为只传方法名，有参数命令继续传类型化对象。使用临时且不提交的 4319/1421 配置隔离本工作树，结束后只停止本次两个进程并删除临时配置；不触碰占用 4318/1420 的无关进程。Bun 校验失败后停止 browse 安装并改用现有系统浏览器自动化；实际提交固定本地 PI fixture 任务、切换项目、返回停止并打开设置。右栏只记录 DOM/组件/CSS 契约和窄屏隐藏事实。浏览器技能意外向 `.gitignore` 加入 `.gstack/` 后已移除，未纳入提交。
- 验证结果：新增适配器/组件 5/5，最终 `npm run test:desktop-ui` 46/46、`npm test` 109/109、`npm run test:desktop-product` 12/12、`npm run test:desktop-native` 11/11、`npm run test:docs` 32/32、`npm run build:desktop` 和 `git diff --check` 通过。浏览器使用真实 PI 1.5.0 + 本地模拟模型完成 `MOOS_FIXTURE_WRITE P02_SHELL` 的 write/bash 和回复；`MOOS_FIXTURE_HOLD` 运行时切到第二项目显示 1 个后台任务且未取消，返回后停止为 cancelled；设置页成功打开。语义 Shell、侧栏、主区、右栏和输入区各 1 个，无横向溢出，控制台错误/警告 0；截图已人工查看但未提交原始图像，脱敏结果见 E19。既有 jsdom `NaN` 高度警告和 807.33 kB chunk 警告仍存在。
- 遗留问题：未做宽屏右栏视觉实测、打包 Mac GUI 或生产进程树验收；当前两个 Node 宿主、逐任务 PI RPC spawn、600000ms 上限和通用 `Task execution failed` 未改变。P02.2 的完整三栏交互、三档权限和设置中心，及 P02.3—P02.9 的 SDK、长任务、Usage、插件、皮肤、PTY 和总验收均未完成。browse 的 Bun 安装脚本校验差异需技能维护者更新可信哈希或提供已验证运行时后才能使用该工具。
- 对应 Git 提交：本批次唯一提交说明 `feat(P02.1): add UI adapter and DSH-style shell`；查询命令：`git log --all --oneline --grep='^feat(P02.1): add UI adapter and DSH-style shell$'`。验证后提交推送并核对远程，不预填未知哈希。

## 2026-11-05 17:34:07 +08:00｜P02.1：GitHub 远程交付核对

- 修改或新增内容：将 P02.1 功能提交 `3a4ddec073a92ef5b9e369a6ce2ba9be8630caf1` 快进推送至 GitHub `main`，并核对远程分支哈希；本条只补记远程交付结果，不修改产品代码、测试或验收结论。
- 遇到的难题：默认 Git 凭据对应的账号无该仓库写权限；沿用已验证的 GitHub CLI 凭据助手执行推送。推送前 `origin/main` 与功能提交的父提交均为 `7fe8cf771d9a8f3db1edfc1e6186a03631b05884`，不存在并发远程提交或重写历史需求。
- 处理方式：执行 `git fetch origin main` 核对快进关系，再以 GitHub CLI 凭据助手执行 `git push origin HEAD:main`；推送后分别读取本地 `HEAD` 与 `git ls-remote origin refs/heads/main`。
- 验证结果：推送输出为 `7fe8cf7..3a4ddec  HEAD -> main`；本地 `HEAD` 与 GitHub `main` 均为 `3a4ddec073a92ef5b9e369a6ce2ba9be8630caf1`。功能测试与实际验收范围沿用同一提交内 E19 和前一条日志，不因远程交付扩大。
- 遗留问题：P02.2—P02.9 仍未完成；browse 技能的本地遥测脚本因全局安装目录中的脚本无执行权限且本机无 Bun 未能写入时间线，不影响 Moos 产品测试，未修改全局工具规避。此日志补记仍需独立提交、推送并再次核对远程。
- 对应 Git 提交：已推送功能提交 `3a4ddec073a92ef5b9e369a6ce2ba9be8630caf1`；本条补记使用唯一提交说明 `docs(P02.1): record shell remote delivery`，查询命令：`git log --all --oneline --grep='^docs(P02.1): record shell remote delivery$'`。

## 2026-11-05 17:51:10 +08:00｜P02.2：完整工作区体验、权限菜单与设置中心

- 修改或新增内容：新增真实事件 `TaskTrajectory`、脱敏 `ToolCard`、消息列表展示组件、输入区状态和三档 `PermissionMenu`；权限档位固定为“请求批准 / 帮我批准 / 完全访问权限”，默认“帮我批准”，只将非敏感 UI 偏好保存在 WebView localStorage。新增九分区设置中心，保留既有模型 Keychain 与诊断表单，其余未实现能力显示真实“计划中/未接入”状态；右侧上下文栏支持手动收起和恢复。新增 4 项组件测试、E20 脱敏证据，并在 PLAN.md 只勾选 P02.2。
- 遇到的难题：测试先行时三个新组件模块尚不存在，3 个 suite 按预期失败；实现后测试错误假设 Ant Design 可选择菜单使用 `menuitemradio`，实际可访问角色为 `menuitem`，且闭合 `details` 内容在可见性断言中不可见。首次 `npm run build:app` 需要重新编译 Tauri 依赖，耗时约 3 分 33 秒。GUI 自动化中一次状态刷新超时导致会话重置，但未修改用户数据。
- 处理方式：按实际 Ant Design 语义修正测试角色，工具卡默认展开以直接展示真实输入摘要和结果；递归过滤凭据形状的字段，不合成 Think/隐藏推理。设置页对 Usage、插件、主题、手机连接、高级运行时明确说明未实现。打包后直接启动工作树产物，不覆盖 `/Applications` 中已有应用；GUI 逐项核对设置导航、权限菜单、历史轨迹和右栏折叠，并恢复右栏原状态。
- 验证结果：`npm run test:desktop-ui` 51/51、`npm test` 109/109、`npm run test:desktop-product` 12/12、`npm run test:docs` 33/33、`npm run build:desktop`、`npm run build:app` 和 `git diff --check` 通过。打包 GUI 实际显示九个设置分区、三档权限与 macOS 权限边界说明、真实持久化工具事件；右栏收起/恢复通过。Tauri 报告包 230.49 MiB，逻辑大小 240598 KiB、磁盘占用 279348 KiB。既有 jsdom `NaN` 高度警告和 874.18 kB chunk 警告仍存在。
- 遗留问题：权限档位尚未接入后端执行策略，不能扩大系统或任务权限；Usage、缓存命中、上下文窗口、插件、皮肤、产品级手机连接均未实现。当前完整 Node/PI、双宿主、逐任务 RPC spawn、600000ms 上限和 `Task execution failed` 未改变；P02.3—P02.9 仍未完成，包体也未优化。
- 对应 Git 提交：本批次使用唯一提交说明 `feat(P02.2): build DSH-style workspace experience`；查询命令：`git log --all --oneline --grep='^feat(P02.2): build DSH-style workspace experience$'`。验证后提交推送并核对远程，不预填未知哈希。

## 2026-11-05 17:56:47 +08:00｜P02.2：GitHub 远程交付核对

- 修改或新增内容：将 P02.2 功能提交 `8f9c7de883df939920c5e284e1d89beb4194a16d` 快进推送至 GitHub `main`，并补记远程核对结果；不修改产品代码或扩大 E20 验收范围。
- 遇到的难题：默认 Git 凭据仍无仓库写权限；本次没有远程并发提交，功能提交父节点和推送前 `origin/main` 均为 `2a93a0c90767ac2e887532ab997a44481891f9b4`。
- 处理方式：先执行 `git fetch origin main` 并核对直接父子关系，再仅对本次推送使用 GitHub CLI 凭据助手；不修改全局 Git 配置、不强制推送、不记录令牌。
- 验证结果：推送输出为 `2a93a0c..8f9c7de  HEAD -> main`；本地 `HEAD` 与 `git ls-remote origin refs/heads/main` 均为 `8f9c7de883df939920c5e284e1d89beb4194a16d`。
- 遗留问题：P02.3—P02.9 仍未完成，尤其 Node 双宿主/闪烁、逐任务 RPC、600 秒超时和通用失败提示均未由 P02.2 修复。本条日志自身仍需独立提交、推送并再次核对远程。
- 对应 Git 提交：已推送功能提交 `8f9c7de883df939920c5e284e1d89beb4194a16d`；本条补记使用唯一提交说明 `docs(P02.2): record workspace delivery`，查询命令：`git log --all --oneline --grep='^docs(P02.2): record workspace delivery$'`。

## 2026-11-05 18:19:32 +08:00｜P02.3：PI SDK 单一运行时迁移

- 时间说明：此为收尾阶段读取的北京时间；开发、失败测试、构建和进程验收发生在本条之前，无法核实每个中间动作的精确北京时间，均以命令结果和 E21 为准。
- 修改或新增内容：正式任务入口从每任务启动 `pi-coding-agent --mode rpc` 改为 PI 1.5.0 官方进程内 SDK；新增 `packages/pi-runtime/sdk-runtime.mjs`，保留旧 adapter 供 M01 历史探针及回退测试使用。SDK 会话按项目/会话持久化，复用严格本地认证代理和安全上下文，支持 completions/responses、七类开发工具、取消和重启续会话。Tauri Rust host 改为请求 ID 并发分发，普通任务与模型诊断共用一个 Node 宿主；移除正式 `--diagnostics` 第二宿主，并将 SDK runtime 加入打包资源。新增 Responses 流式 fixture、七工具及密钥/代理/取消验收、单宿主并发测试、E21 和文档契约。
- 遇到的难题：首次 SDK 接入错误假设包根导出 `AuthStorage`，改用 PI 1.5.0 实际 `ModelRuntime.create` API 后通过。新增 Responses 验收首轮失败，任务只记录 usage 后失败；直接诊断确认请求已到 `/responses`，实际是本地 fixture 只接受非流式诊断并返回 400，不是 SDK 路由故障。Rust 旧测试仍假设第二诊断宿主，迁移后按新单宿主架构失败。错误排查期间 SDK 异常曾临时拼接上游 errorMessage，收尾前已移除，避免把服务商原文带入公开错误。Rust 回归还报告 4 个无用 `mut` 警告，已清理。
- 处理方式：根据现有 adapter 的 Responses SSE 格式给 fixture 增加专用确定性流式场景；另增 `MOOS_FIXTURE_TOOLS`，由真实 PI SDK 依次执行 read/write/edit/bash/grep/find/ls 并核对 start/update/end。模型真实密钥只留在 Controller 内存和上游代理，SDK 仅取得每次随机代理 token；遍历运行时文件和快照确认不存在 fixture 上游密钥，任务结束后确认代理端口关闭。Rust stdout dispatcher 以响应 ID 唤醒各自等待者，慢模型诊断期间 snapshot/cancel 仍可并发完成。打包后只启动本工作树产物，按精确 PID 检查并只向本次 Moos App 发送 SIGKILL，不结束其他应用。
- 验证结果：`npm test` 111/111、`npm run test:desktop-ui` 51/51、`npm run test:desktop-product` 12/12 通过；PI SDK 验收包括两个协议、重启续会话、两项目并发、同真实目录串行、七工具事件、运行/排队取消和其他项目隔离。`npm run build:app` 通过，Tauri 报告 230.50 MiB。最终包进程树实际为 App PID 57255 → 唯一 Node PID 57260 → `services/agent/main.mjs`，未出现 `--diagnostics` 或 PI CLI/RPC 子进程；此前本轮本地 fixture HOLD 任务进程检查只观察到受控工具子进程并显示 `NO_PI_CLI_CHILD`。正常退出检查 Node 已退出；最终向 PID 57255 发送 SIGKILL 后 PID 57260 在有界轮询内退出。GUI 已加载最终单宿主包；E21 为脱敏提交前工作区证据。最终文档测试和差异检查在提交前另行执行。
- 遗留问题：未使用真实收费 GLM/中转站，本地 fixture 不能证明服务商兼容性、额度或费用；最终打包 App 的 SIGKILL 检查时没有活跃 SDK 工具，活跃工具清理由 SDK 取消集成测试覆盖，完整 P02.9 仍需组合实测。固定 600000ms 上限和通用长任务错误属于 P02.4，尚未修复；超过 10 分钟任务、Usage、插件、皮肤、PTY、小包优化均未完成。前端仍有既有 jsdom `NaN` 高度警告和 874.18 kB chunk 警告。
- 对应 Git 提交：本批次唯一提交说明 `feat(P02.3): migrate product tasks to one PI SDK runtime`；查询命令：`git log --all --oneline --grep='^feat(P02.3): migrate product tasks to one PI SDK runtime$'`。完成最终验证后提交、推送并核对远程，不预填自身哈希。

## 2026-11-05 18:21:23 +08:00｜P02.3：GitHub 远程交付核对

- 修改或新增内容：将 P02.3 单一 SDK 运行时功能提交 `d8c4c7d796ff171fe42d83d5ff335c05c0e6bdd6` 快进推送至 GitHub `main`，并补记远程核对结果；不修改运行时实现或扩大 E21 验收范围。
- 遇到的难题：默认 Git 凭据仍无仓库写权限；本次远程没有并发提交，推送前本地父提交、`origin/main` 与 `git ls-remote` 均为 `8b2ef43cb9ce9f48caa5bab67f49184766507ef7`。
- 处理方式：先 fetch 并核对直接父子关系，再仅对本次 push 使用已确认的 GitHub CLI 凭据助手；未修改全局 Git 配置、未强制推送、未输出或记录令牌。
- 验证结果：推送输出为 `8b2ef43..d8c4c7d  HEAD -> main`；本地 `HEAD` 与 GitHub `main` 均为 `d8c4c7d796ff171fe42d83d5ff335c05c0e6bdd6`。功能、测试及限制仍以同一提交的 E21 和前一条日志为准。
- 遗留问题：P02.4—P02.9 继续未完成；600 秒上限和长任务通用失败提示是下一批 P02.4 的范围。本条日志补记自身仍需独立提交、推送并再次核对远程。
- 对应 Git 提交：已推送功能提交 `d8c4c7d796ff171fe42d83d5ff335c05c0e6bdd6`；本条补记使用唯一提交说明 `docs(P02.3): record SDK runtime delivery`，查询命令：`git log --all --oneline --grep='^docs(P02.3): record SDK runtime delivery$'`。

## 2026-11-05 19:05:22 +08:00｜P02.4：有界长任务、心跳与安全错误分类

- 修改或新增内容：新增六档任务期限策略（10 分钟、30 分钟、1 小时、2 小时、6 小时、24 小时，默认 2 小时且禁止无限）、SQLite `settings` 及任务 `timeoutMs/heartbeatAt/stage/errorCode` 迁移、15 秒存活心跳、重启后 `host_interrupted` 且不自动重放、稳定安全错误码与固定中文提示。正式 PI SDK 任务使用所选期限控制模型请求和外层取消；新增 Undici 8.12.3 直接依赖，将共享响应头/正文传输上限设为产品最大 24 小时，各任务仍由自身更短的截止时间停止。高级设置接入真实配置并显示六档；任务区显示阶段、最近心跳和错误码。新增策略、错误、迁移、心跳、持久化、认证脱敏、安静请求取消和长任务回归测试，新增 E22，PLAN.md 只勾选 P02.4。
- 遇到的难题：真实本地长任务前三次分别在 300.084、301.138 和 301.165 秒失败，均有 20 次心跳并正确记录 `timeout`，没有伪报成功。第一次只延长 Moos 外层期限后仍触发 PI 默认 5 分钟 HTTP 空闲上限；加入 `httpIdleTimeoutMs` 后第二次复用了修改前已启动的 Node 宿主，重启宿主后的第三次仍失败，排除了模块缓存。检查 PI 会话文件得到安全的本机运行时错误，明确指出 Node fetch 等待响应头的 Undici dispatcher 仍为 5 分钟。另一次最终核心全量回归中，旧 M01 代理的超大请求用例发生单次 `ECONNRESET`，导致当轮 119/120；该用例单独 12/12 通过，之后完整全量重跑 120/120 通过。GUI 中已有历史任务仍显示当时持久化的旧 `Task execution failed`，没有篡改历史记录。
- 处理方式：先为 PI `SettingsManager` 同时设置 HTTP 空闲期限和 provider 请求期限，再根据会话错误配置一个共享 Undici Agent，使传输层允许到 24 小时；不把传输层设为无限，且保留每任务 AbortController 的精确期限、用户停止和代理关闭。每次修复后重启本次唯一 fixture 宿主，最终用完全新进程重新计时；失败记录全部保留在 E22，不用加速测试替代真实时长。GUI 在打包应用中将 2 小时改为 6 小时，正常退出重启后仍为 6 小时，再恢复 2 小时。验收结束后确认任务专属代理端口关闭、dev 宿主无 PI CLI/RPC 子进程，并只停止本轮 fixture 服务。
- 验证结果：最终真实本地 fixture 任务从北京时间 18:52:21.991 运行到 19:02:27.123，共 605.132 秒，40 次心跳，状态 `succeeded`、阶段 `completed`、无错误码，助手内容为 `完成 LONG`；结束后代理连接被拒绝且 dev 宿主没有子进程。`npm test` 最终 120/120、`npm run test:desktop-ui` 51/51、`npm run test:desktop-product` 12/12、`cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml`、`npm run test:docs` 35/35、`npm run build:app` 和 `git diff --check` 通过。Tauri 报告 230.51 MiB，逻辑大小 240626 KiB、磁盘占用 279392 KiB，包内确认 Undici 8.12.3。E22 记录提交前工作区状态及失败到成功的完整脱敏证据。
- 遗留问题：未调用真实收费 GLM 或 OpenAI 中转站，不能据本地 fixture 推断服务商 10 分钟以上稳定性、额度或费用；Usage/缓存命中/上下文统计、插件、皮肤、原生 PTY、完整 P02.9 和包体优化仍未完成。M01 历史 RPC adapter 继续保留探针的 10 分钟边界，不是正式产品任务入口；P02.5 从真实 usage 持久化开始。既有 UI jsdom `NaN` 高度警告和 875.44 kB chunk 警告未在本批处理。
- 对应 Git 提交：本批次唯一提交说明 `fix(P02.4): support bounded long-running tasks`；查询命令：`git log --all --oneline --grep='^fix(P02.4): support bounded long-running tasks$'`。完成最终提交、推送和远程核对后再补记实际哈希，不预填未知提交。

## 2026-11-05 19:06:50 +08:00｜P02.4：GitHub 远程交付核对

- 修改或新增内容：将 P02.4 有界长任务功能提交 `a3f49d3c8ed2c378cc7b2f57368d277b4c50e5d0` 快进推送至 GitHub `main`，并补记远程分支核对结果；不修改产品实现或扩大 E22 的验收范围。
- 遇到的难题：默认 Git 凭据仍不具备目标仓库写权限；本次远程没有并发提交，推送前功能提交父节点与 `origin/main` 都是 `d47ec0bd0d966a5a28f6f6addfc837f4829fea31`。
- 处理方式：先执行 `git fetch origin main` 并核对直接父子关系，再仅对本次 push 使用已确认的 GitHub CLI 凭据助手；未修改全局 Git 配置、未强制推送，也未输出或记录令牌。
- 验证结果：推送输出为 `d47ec0b..a3f49d3  HEAD -> main`；推送后本地 `HEAD` 与 `git ls-remote origin refs/heads/main` 都是 `a3f49d3c8ed2c378cc7b2f57368d277b4c50e5d0`。功能测试、真实 605.132 秒验收与限制仍以该提交内 E22 和前一条日志为准。
- 遗留问题：P02.5—P02.9 仍未完成；真实 Usage/缓存/上下文、插件、皮肤、原生 PTY、完整系统验收和包体优化继续按 PLAN.md 推进。本条远程交付日志自身还需独立提交、推送并再次核对远程。
- 对应 Git 提交：已推送功能提交 `a3f49d3c8ed2c378cc7b2f57368d277b4c50e5d0`；本条补记使用唯一提交说明 `docs(P02.4): record long-task delivery`，查询命令：`git log --all --oneline --grep='^docs(P02.4): record long-task delivery$'`。

## 2026-11-05 19:40:16 +08:00｜P02.5：可核实 Usage、缓存命中、上下文与费用

- 时间说明：此为最终打包完成后读取的北京时间；开发、失败测试和浏览器验收发生在本条之前，不将整理时间冒充每项操作的精确时间。
- 修改或新增内容：在严格本地模型代理中从 Completions/Responses SSE 捕获原始 usage，与 PI 规范化计数合并后按 task/project/conversation 归属写入 SQLite `usage_records`；新增时间、服务、项目、会话筛选、JSON 导出与清理命令。输入区显示最新缓存命中率和上下文用量，设置中显示输入/输出/缓存/推理 Token、命中率、费用、上下文和记录数；支持可选用户价格版本，并标记 provider/configured 来源。新增后端、界面、原生协议与文档测试及 E23。
- 遇到的难题：测试先行首轮后端 24 项中 3 项失败（usage 模块不存在、Store 无方法、快照无 usage），界面 3/3 失败（仍为占位组件）；实现后一个汇总断言因 JavaScript 浮点结果 `0.30000000000000004` 与 `0.3` 严格比较失败，改为误差断言。浏览器首次使用不符合 fixture 契约的中文任务，上游返回错误时 PI 仍产生 0 Token 消息，暴露会将失败请求误记为真实 usage。
- 处理方式：以服务商原始 usage 字段的存在性作为可用性证据；缓存命中率固定为 `cacheRead / (input + cacheRead)`，任一记录缺缓存或费用字段时汇总显示“暂无数据”，不从文本/字符估算。未捕获到原始 usage 对象时不发出 usage 事件，并给服务失败用例增加零记录回归。费用优先服务商返回值；用户价格仅在所有已报告 Token 类别都有价格时计算，不冒充账单。浏览器改用确定性 `MOOS_FIXTURE_WRITE UI_USAGE_1` 完成真实 PI write/bash 验收。
- 验证结果：Completions 的两个 PI 任务产生 6 条记录、96 输入、30 输出、24 缓存读取、20% 命中率和 $0.000720，控制器重启后仍可查；Responses 实测缺缓存字段时为暂无数据、费用 $0.000200。浏览器输入区实际显示 20.0% 和 25/128,000；设置显示 48/15/12 Token、20%、$0.000360 和 3 条，项目筛选后无数据字段正确，导出 JSON 仅含归属与用量字段，临时 fixture 记录清理后为 0。最终 `npm test` 125/125、`npm run test:desktop-ui` 53/53、`npm run test:desktop-product` 12/12、Rust fmt、`npm run build:desktop` 及 `npm run build:app` 通过；Tauri 报告 230.53 MiB，逻辑 240647 KiB、磁盘 279408 KiB。文档测试及最终差异检查在提交前另行执行。
- 遗留问题：未读取或计费真实 GLM Coding Plan/OpenAI 中转站，不能据 fixture 推断真实服务字段、账单或缓存语义；P02.9 需用用户本机配置补验。插件、皮肤、PTY、完整 P02 和小包目标未完成；现有 jsdom `NaN` 高度与 Vite 大 chunk 警告仍保留。
- 对应 Git 提交：本批次唯一提交说明 `feat(P02.5): persist and display verified model usage`；查询命令：`git log --all --oneline --grep='^feat(P02.5): persist and display verified model usage$'`。完成验证后提交、推送并核对远程，不预填自身哈希。

## 2026-11-05 19:50:49 +08:00｜P02.5：GitHub 远程交付核对

- 修改或新增内容：将 P02.5 可核实用量功能提交 `2ff0c25add23d4bd5be14e15f8b6bd046f16e424` 快进推送至 GitHub `main`，并补记远程核对结果；不修改产品代码或扩大 E23 验收范围。
- 遇到的难题：首次推送仍命中系统 `osxkeychain` 中无仓库写权限的 `xuguopeng` 凭据，GitHub 返回 HTTP 403。推送前已确认远程无并发提交，功能提交父节点与 `origin/main` 均为 `7d7e2d1e97bd148fbae01b6470d1ace217684c3f`。
- 处理方式：保留本地提交，核对 GitHub CLI 活动账号为仓库所有者 `xumuyan`；仅对重试的 Git 命令清空系统 helper 并使用 `gh auth git-credential`，未修改全局 Git 配置、未强制推送、未记录原始令牌。
- 验证结果：推送输出为 `7d7e2d1..2ff0c25  HEAD -> main`；推送后本地 `HEAD` 与 `git ls-remote origin refs/heads/main` 均为 `2ff0c25add23d4bd5be14e15f8b6bd046f16e424`。功能、测试、实际界面验收和限制仍以该提交内 E23 及前一条日志为准。
- 遗留问题：P02.6—P02.9 仍未完成；真实 GLM/中转站 usage 与账单、插件、皮肤、PTY、完整系统验收和小包目标继续按 PLAN.md 推进。本条远程交付日志自身仍需独立提交、推送并再次核对远程。
- 对应 Git 提交：已推送功能提交 `2ff0c25add23d4bd5be14e15f8b6bd046f16e424`；本条补记使用唯一提交说明 `docs(P02.5): record verified usage delivery`，查询命令：`git log --all --oneline --grep='^docs(P02.5): record verified usage delivery$'`。

## 2026-11-05 20:34:45 +08:00｜P02.6：类型化 UI Slot、受信任内置插件与安全皮肤核心

- 时间说明：此为功能、测试和浏览器验收完成后读取的北京时间；不将整理时间冒充中间每项操作的精确时间。
- 修改或新增内容：新增 10 个固定、类型化 UI Slot，实现严格内置 manifest、Moos 版本/权限/重复 ID 校验、可重复撤销、启停清理、订阅和连续 3 次渲染错误自动停用；新增不启动 Node 或 Web 服务的受信任内置用量洞察插件。皮肤只接受白名单 Token、固定区域属性以及打包或有界栅格资源，支持隔离预览、显式应用持久化、重启恢复和非法值回退。设置中接入内置插件开关和海洋/石墨皮肤；新增 E24 脱敏证据并仅将 PLAN.md 的 P02.6 勾选完成。
- 遇到的难题：测试先行时 4 个 suite 因插件/皮肤模块尚不存在按预期失败；设置组件测试首轮将 Ant Design 按钮可访问名称假设为无空格的“停用”，实际为“停 用”。浏览器自动化环境不提供直接 localStorage 脚本读取；PluginBoundary 的预期异常还会由 React 输出错误日志。最终核心全量回归首轮在既有的代理大请求上限用例出现单次 `ECONNRESET`，当轮为 124/125，不记为通过。
- 处理方式：保留首轮失败后实现最小严格契约；测试按实际可访问名称改为容忍空白的正则。持久化不依赖脚本窃取，而是先显式应用石墨皮肤，再真实刷新页面核对根变量恢复；非法启动值通过仅 DEV 构建有效的参数注入，核对回退后再进入普通地址。PluginBoundary 测试仅屏蔽该预期错误的 console 噪声，仍断言隔离、计数与停用行为。对代理用例单独复测 1/1 后重跑完整核心集，未修改与本批无关的旧实现。
- 验证结果：代理边界用例复测 1/1，随后 `npm test` 125/125；`npm run test:desktop-ui` 63/63、`npm run test:desktop-product` 12/12、文档 37/37、Rust fmt 与 `git diff --check` 通过，`npm run build:desktop` 及 `npm run build:app` 均通过。Tauri 报告 230.53 MiB，逻辑大小 240647 KiB、磁盘占用 279408 KiB。浏览器 1280×720 实际验收确认：插件停用后输入区贡献消失、重启后恢复；皮肤预览不改根主题，显式应用后刷新恢复，切回默认后输入框可输入 `FOCUS_OK`，无水平溢出；不兼容启动皮肤回退默认且控制台问题为 0。脱敏证据见 E24。
- 遗留问题：P02.7 的本地 ZIP/文件夹安装、签名/权限/大小校验、第三方沙箱 API 与崩溃处理尚未实现，不能据内置插件推断恶意插件已隔离；P02.8 PTY、P02.9 总验收与包体优化仍未完成。现有 jsdom `NaN` 高度警告及 Vite 917.84 kB 大 chunk 警告未在本批处理。
- 对应 Git 提交：本批次使用唯一提交说明 `feat(P02.6): add typed UI slots and safe themes`；查询命令：`git log --all --oneline --grep='^feat(P02.6): add typed UI slots and safe themes$'`。完成最终验证后提交、推送并核对远程，不预填未知哈希。

## 2026-11-05 20:41:52 +08:00｜P02.6：GitHub 远程交付核对

- 修改或新增内容：将 P02.6 类型化 Slot、受信任内置插件和安全皮肤核心提交 `e3400a60995fa61ebecd55309dd50a6ff1f56661` 快进推送至 GitHub `main`，并补记远程核对结果；不修改产品代码或扩大 E24 验收范围。
- 遇到的难题：本次没有新的推送错误或远程并发提交；默认系统凭据历史上不具备仓库写权限，因此没有再用已知会失败的默认身份试探。推送前功能提交的父节点和 `origin/main` 均为 `fa60be04b0adaa689ba8567711e4f0455da547cd`。
- 处理方式：先执行 `git fetch origin main` 并核对快进关系，再仅对本次 push 清空默认 helper 并使用已确认的 GitHub CLI 凭据助手；未修改全局 Git 配置、未强制推送、未输出或记录令牌。
- 验证结果：推送输出为 `fa60be0..e3400a6  HEAD -> main`；推送后本地 `HEAD`、`origin/main` 与 `git ls-remote origin refs/heads/main` 均为 `e3400a60995fa61ebecd55309dd50a6ff1f56661`。功能测试、实际界面验收与限制仍以该提交内 E24 和前一条日志为准。
- 遗留问题：P02.7—P02.9 仍未完成；第三方 ZIP/文件夹安装与沙箱、原生 PTY、完整系统验收和包体优化继续按 PLAN.md 推进。本条日志自身仍需独立提交、推送并再次核对远程。
- 对应 Git 提交：已推送功能提交 `e3400a60995fa61ebecd55309dd50a6ff1f56661`；本条补记使用唯一提交说明 `docs(P02.6): record plugin theme delivery`，查询命令：`git log --all --oneline --grep='^docs(P02.6): record plugin theme delivery$'`。

## 2026-11-05 23:00:51 +08:00｜P02.7：本地插件安装、声明式 Worker 沙箱与生命周期

- 时间说明：此为主要 GUI 验收结束后读取的北京时间；开发、两次失败的 iframe 沙箱试验、主题修复、最终测试和打包发生在本条前后，不将整理时间冒充每项动作的精确时间。
- 修改或新增内容：新增 Rust `PluginManager` 和 Tauri 安装/列表/启停/卸载/入口/私有配置命令；文件夹或 ZIP 先进入临时目录，校验清单、ID、semver、Moos 版本、权限、入口、路径、链接、执行位/魔数、数量、大小和压缩比，再以备份和原子换名安装。新增本地 UI/皮肤夹具、设置管理界面和版本化声明式 API；UI 代码在 Blob Worker 中运行，不能取得 DOM/Tauri、网络、浏览器持久化、跨上下文通道、嵌套 Worker 或动态导入，只能注册声明 Slot/动作、发送通知和访问 32 KiB 私有配置。主线程校验 64 KiB 消息、每秒 200 条、启动/渲染期限、声明式视图深度/节点和脱敏上下文，并以健康看门狗处理忙循环、失联或异常终止。新增 E25，PLAN.md 勾选 P02.7，P02.8—P02.9 保持未完成。
- 遇到的难题：最初按隔离 iframe 设计，实际打包 App 中 `data:` iframe 和仅加载自身静态页的 sandbox iframe 均在 2 秒内无法完成握手；两次均被自动停用且主界面未崩溃，不能把设计推断当作可用实现。改为专用 Worker 后实际运行成功。GUI 首次皮肤验收又发现带点号的本地插件 ID 被前端内置主题正则静默过滤，只显示并误操作了内置“浅海”，因此没有把该次记为本地皮肤通过；放宽到与插件 ID 相容的安全字符并增加回归后才重新打包验收。最终并行全量测试中 UI 第一项因机器负载刚好超过既有 20 秒期限，整轮 70/71，不记为通过；单独完整重跑为 71/71。浏览器 Worker 没有可核实的单 Worker 硬内存配额，不能虚构该能力。
- 处理方式：放弃在 Tauri 中不稳定的 iframe 方案，Worker 启动前捕获内部通信函数，再冻结危险全局；CSP 只增加 `worker-src blob:`，继续禁止远程脚本、frame、object 和 form。插件只返回 text/badge/button/group 的有界数据，由主 React 树渲染，不接收 HTML/组件代码。增加 Worker crash/messageerror、洪水、启动/渲染超时和周期健康应答的统一停用路径；Rust 临时目录测试覆盖原子升级失败回滚、卸载保留/清除私有配置及恶意 ZIP。皮肤 ID 缺陷通过真实打包 GUI 复现后修复，实际应用“薄荷验收皮肤”并重启确认保持，随后恢复默认主题。验收源目录已移动到可恢复的废纸篓路径 `/Users/xuguopeng/.Trash/moos-p02-acceptance.XBcRST-20261105-2303`；应用数据中的三个验收包保留但均已停用，未删除用户其他数据。
- 验证结果：打包 GUI 实际完成文件夹安装、ZIP 安装、默认停用、启停恢复、通知、`composer.trailing`/`settings.section` Slot、1.0.0→1.1.0 升级保持启用、带脚本入口的 2.0.0 升级拒绝且 1.1.0 保留、Worker 抛错后自动回到默认停用。本地皮肤修复后可预览、显式应用、重启仍显示已应用，验收后恢复 Moos 默认。最终包启动进程树仅为 App PID 27739 → 一个内置 Node PID 27753 → `services/agent/main.mjs`，没有插件 Node/Web 服务。最终 `npm test` 125/125、`npm run test:desktop-product` 17/17、`npm run test:docs` 38/38；并行 UI 回归的超时失败后，单独完整 `npm run test:desktop-ui` 为 71/71。`cargo fmt --check`、`npm run build:app` 和 `git diff --check` 通过；Tauri 报告 230.94 MiB，逻辑 241067 KiB、磁盘 279828 KiB。现有 jsdom `NaN` 高度警告及 Vite 946.90 kB 大 chunk 警告仍存在。
- 遗留问题：没有在 GUI 点击最终“清理并卸载”的破坏性确认；卸载、升级回滚、保留/清理插件配置由真实 Rust 临时目录测试覆盖，前端测试覆盖确认框到命令路由。Worker 以输入/消息/时间/健康边界和异常终止处理资源滥用，但不具备操作系统级硬内存配额；任意恶意第三方代码安全性不能由 fixture 推断。在线插件市场、第三方原生插件、任意文件/Shell/截图/输入权限、P02.8 原生 PTY、P02.9 完整组合验收和小包优化仍未完成。
- 对应 Git 提交：本批次使用唯一提交说明 `feat(P02.7): install sandboxed local UI plugins`；查询命令：`git log --all --oneline --grep='^feat(P02.7): install sandboxed local UI plugins$'`。完成最终检查后创建提交、推送并核对远程，不预填未知哈希。

## 2026-11-05 23:16:19 +08:00｜P02.7：GitHub 远程交付核对

- 修改或新增内容：将 P02.7 本地插件安装、声明式 Worker 沙箱、生命周期和本地皮肤功能提交 `bdd0f39530ecdf04c72179b6018df4a939751db7` 快进推送至 GitHub `main`，并补记远程核对结果；不修改产品实现或扩大 E25 验收范围。
- 遇到的难题：本次没有新的推送错误；默认系统凭据历史上无仓库写权限，因此直接沿用已确认的 GitHub CLI 活动账号。推送前已 fetch，功能提交父节点、本地起点和 `origin/main` 均为 `80570376c7cda9f5a8465c42dadbb32e19f4ee2d`，没有远程并发提交。
- 处理方式：仅对本次 push 清空默认 helper 并使用 `gh auth git-credential`；未修改全局 Git 配置、未强制推送、未输出或记录令牌。推送后分别读取本地 HEAD 和 GitHub `refs/heads/main`。
- 验证结果：推送输出为 `8057037..bdd0f39  HEAD -> main`；本地 HEAD 与 `git ls-remote origin refs/heads/main` 均为 `bdd0f39530ecdf04c72179b6018df4a939751db7`。功能、测试、GUI 验收和限制仍以该提交内 E25 及前一条日志为准。
- 遗留问题：P02.8 原生 PTY 和 P02.9 完整组合验收仍未完成；在线市场、第三方原生插件、硬内存配额和小包优化不因本次推送变为已实现。本条远程交付日志自身仍需独立提交、推送并再次核对远程。
- 对应 Git 提交：已推送功能提交 `bdd0f39530ecdf04c72179b6018df4a939751db7`；本条补记使用唯一提交说明 `docs(P02.7): record local plugin delivery`，查询命令：`git log --all --oneline --grep='^docs(P02.7): record local plugin delivery$'`。
