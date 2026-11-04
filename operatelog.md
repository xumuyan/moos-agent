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
