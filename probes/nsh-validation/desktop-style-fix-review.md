# N01-D3 / style_audit｜本轮可执行的样式修复基准

## 1. 范围、证据等级与工作区

本轮交付是**审计基准，不是已修复界面**。开始 HEAD `22552db9380c3aedcd8ce82b4f1b9a5ede2cd28a`；2026-11-18 北京时间开始记录见忽略目录 `artifacts/nsh-validation/style-audit/initial.json`。检查祖先、根与目标目录 AGENTS.md（目标内无嵌套规则），读取 PLAN.md、operatelog.md 和已有主题/来源/证据文档。先前宽范围 find 超时与长输出截断不当作完成读取，改按目标和行段核对。

- **F（来源事实）**：`SKIN-SOURCE.md` / `skin-source.json`，maid-atelier 0.3.2，六个文本文件及17张必要素材逐项 bytes/SHA-256 本轮只读匹配。仅所选皮肤目录；不执行 hooks，不读取聊天、数据库、模型配置、凭据或其他私有存储。CC BY-NC-SA 4.0，署名 上善 → zipzip → Small-tailqwq；本机预览授权不等于发布或商业分发授权。原图/字体/hooks 不入 Git。
- **O（已观察）**：实际打开旧 `run-JGWPko/light-idle.png`、`light-chat.png`。这是 NSH development test host 原生内容捕获、合成响应，非真实 PI 任务、系统实时截图、人工 GUI 或正式独立包。原文件 PNG magic/IHDR 均为1240×820（查看工具返回 JPEG 预览，不代表磁盘文件编码）。路径/字节/hash与本轮保护清单见 `desktop-style-audit.json`。
- **U（未知/待验）**：正式 Electron 当前最终 computed-style、临时试穿、hooks 是否成功、真实字体 fallback、明暗窄窗可读性、动画、IME、用户视觉认可。持久选择不能证明这些运行态。`DESKTOP-STYLE-EVIDENCE.md` 的 CSS/token/Pillow 静态板**不是 Electron 窗口或 DOM 渲染**；E139 浅蓝图不是本皮肤实图，不计算虚假像素相似度。

7份初始未跟踪文件保留归属和原字节，不回滚、编辑、收编或暂存：DesktopApp.tsx、DesktopUIHost.swift、desktop-ui-acceptance.tsx、desktop-ui-controller.ts、desktop-ui-transport.ts、desktop-ui.test.mjs、verify-desktop-ui.mjs。本轮另锁9份展示/协议/桥/夹具原字节（JSON）；新增文件仅本评审、审计JSON、文档测试及 PLAN/日志增量。混合工作区测试不证明干净检出集成完成。

## 2. 问题 → 来源 → 修复约束 → 可复核结果

以下代码行号均相对 `probes/nsh-validation/`、固定于开始 HEAD；皮肤行号相对所选0.3.2目录。后续代码挪行必须更新定位，不以过期数字代替复查。P0先修、P1紧接、P2保留明确限制；全部仍是 open。

| ID / 优先级 / 等级 | 问题与定位 | 来源事实（非运行态证明） | 修复约束与复核标准 |
| --- | --- | --- | --- |
| SA01 / P0 / O+F | idle 蕾丝与标题交叠：旧图标题约x300/y28落在装饰带。`DesktopView.tsx:67–75`标题头高75、paddingTop14、透明底；`desktop-theme-layers.tsx:41–47`空态48高、51高平铺，蝴蝶结left46%。**zIndex提高仍不能消除透明背景下的图形相交**。 | patches.css:193–232 顶饰/landing/workspace，258–271 蝴蝶结居中及-1顶偏移；2430–2432 titlebar偏移；hooks.mjs:275–353创建装饰。Web titlebar偏移不等于原生内容再加32px。 | 先明确装饰带和文字安全区，调整头部排布/安全内距或局部承载层；不得删蕾丝、隐藏标题、换浅蓝头或重复计算侧栏/系统标题栏。M01/M02/M03/M04/M05/M06/M07/M08：标题及详情按钮完整可读、不与不透明饰纹相交；蝴蝶结相对聊天内容区域居中（不是全窗或固定46%），保存边界与截图。 |
| SA02 / P0 / O+F | 底部预览说明与框饰交叠：idle说明在y约796被底crest/金边覆盖，chat说明也贴输入框外饰。`DesktopView.tsx:86–97`框外扩bottom18、说明height32、空态另挂BottomTrim；layers:49–53底饰60高。 | patches.css:274–305 底饰60高、tile30、crest94×54，287–289 active移出；1634–1648 输入框边饰外扩。预览免责声明为本探针文字，**没有来源规定其32高**。 | 为输入框外饰、说明、空态底饰分别留安全区；空态与聊天不可共用未经验证的下边距。不得删“合成/非实际任务”说明冒充成品。M01–M08均测：完整文字与装饰可见且互不覆盖，不裁按钮/光标；底crest不得盖说明。 |
| SA03 / P1 / F+代码差异 | 侧栏角饰缺完整裁切/镜像与连线。view:35–65无sidebar-corners挂载；layers只有通用Art/NineSlice，不是角饰实现。旧图不能单独证明四角齐全。 | patches.css:411–451：62×62容器、130×130 top-right图、四角scale镜像、1px落点；线偏移62/8.875/8.05、宽1.35/1.25。529–531 rail隐藏。 | 角饰owner在图层内实现单源裁切/镜像，不能整图缩成62×62或拿九宫格替代；不可吞点击/遮品牌。M09四角同尺度裁图、含右/底边与内容边界；窄导航是NSH适配，不冒称Web rail。 |
| SA04 / P1 / O+F | 项目丝带/盾牌与会话选中已可见，不能笼统判“选中行没还原”。view:43–57：54高项目、36高flat会话；缺完整树线/时间/动态状态。 | patches.css:1047–1057 项目padding/字体；1069–1076及1109–1113盾牌尺寸；1123–1137丝带slice/inset；1144–1255树行；1257–1298 **flat特例**36高、金色3px条、渐变/7圆角。 | 保留项目54、flat36及当前flat语义；不要误把32高树行套到flat。盾牌/丝带/文本前后层正确，不裁左扩12px；切换A/B与多会话显示真实选择。若补树模式须独立定义，不能伪造时间/任务状态。M09/M10用长中文名、选中/未选中/禁用核对。 |
| SA05 / P1 / O+U | 顶部状态区：旧chat标题可读，副标题在y54、状态约y94；idle标题阻塞已见。view:15–16,68–79分离标题/说明/任务状态/错误。合成cancelled/已排空不是成功。 | patches.css:307–312 是Web tab header层级，不证明NSH75高或状态文案；skin.css:1/63明暗文字tokens。 | 不能为样式合并、隐藏或改写错误、cancelled、stopping、未确认完成；保持task/事件排空含义。M10测试长标题、长安全错误文案、停止等待、失败、已排空；顶区不挤正文或遮详情开关。 |
| SA06 / P1 / O+F | 消息留白/宽度：旧chat短助手及工具卡均占约680宽；view:80–84强制96%/max680，未按内容收缩；角色标签/工具卡属探针结构。theme:23–26大窗inset120是主动适配，不是来源。 | patches.css:1964–1971用户色/边；1974–1989助手**fit-content**、max-width:min(680px,96%)、padding14/18、18/7角。不能把此规则自动归给全部工具卡/用户宽度。 | 助手短文按内容收缩、长文受680/96%上限；保留用户右对齐/助手左对齐，工具样式单独声明原生适配。M03/M04/M11比对短文、长中文、Markdown/长路径、1000行滚动；正文无横溢，虚拟列表不失内容，不能减少历史来凑布局。 |
| SA07 / P1 / O+F | 输入框布局：旧图九宫格加载，底部按钮偏右、占位/功能说明位于框内；view:86–94只有Input与停止/发送，不能说完整DSH InputBar已接。框源1800×588。 | patches.css:1516–1542深蓝!important、paddingTop34、hero mirror高度；1634–1648 slice170/120/115、边72/54/52、外扩-20/-14/-18；1696–1712 caret/placeholder；1718–1735 dock文案在卡外。 | 明暗都保留来源深蓝渐变，不能用后续非important规则推导浅卡。保留原生nine-slice比例与pointerEvents:none，backdrop blur不等于模糊整卡。M01–M08/M10点击边饰下输入/停止/发送、空输入禁发、busy禁发、停止等待；无假附件/模型菜单，IME未验须明示。 |
| SA08 / P1 / F+U | 明暗窄窗/右栏：theme:23–36，<760侧栏184、>=1100详情、人物<=700规则；不是Web全部断点。已有7图只覆盖light窄窗，**没有dark-idle及dark-narrow**，本轮不据旧图宣称这些已通过。 | skin.css:63暗tokens；patches.css:132–171人物断点；481–487右栏颜色（**未给260固定宽**）；hooks.mjs:327–351人物舞台pointer-events:none。 | 保留原生适配但逐项标注；M05–M08及M12新抓暗idle/窄窗，文字/禁用控件可辨、输入不挤掉、导航可收回、详情不能抢最小宽。260宽仅NSH决策。人物为独立透明层，宫殿cover不包含人物；不可拉伸人物或粗暴模糊背景掩差。 |
| SA09 / P2 / F+U | 字体/动态/缩放未知：theme:8–10、layers:27–53只有静态排布；没有完整过渡。 | skin.css字体tokens、patches.css:314–320/2454–2471 reduced-motion；hooks.mjs:575–616运行态同步文本只读参考。 | 不执行hooks、不伪造动画已还原。M12做断点前后与动态resize、1×/2×实际scale记录；系统字体/Georgia及中文fallback如实记录。未覆盖时标未验；动画和IME不作为静态截图通过的附带结论。 |

## 3. 文件所有权与串行交接

这是后续任务的**边界建议**，不是替他人接管文件或宣布他们已完成；开始前再查status/hash及嵌套规则。共享文件不能两个owner并写。

| 工作包 | 可修改文件 | 依赖/不得修改 | 必须交还 |
| --- | --- | --- | --- |
| style_audit（本轮） | 本评审、desktop-style-audit.json、tests/test_nsh_style_audit.py、PLAN/operatelog增量 | 其他全部输入保持原字节 | 来源/问题/matrix/测试/真实回归记录 |
| style_layout（下一轮） | DesktopView.tsx、desktop-theme.ts、desktop-theme.test.tsx | 先SA01/SA02，再SA05/SA06/SA07；不编辑controller/transport/Swift | 几何边界测试、未隐藏真实状态、旧testID完整、前后同尺寸图 |
| style_layers（在layout提交后） | desktop-theme-layers.tsx、必要desktop-theme.ts及对应测试（须与layout串行） | SA03/SA04/SA08；素材manifest/art映射不随意更改；不发布艺术 | 四角/丝带/中心/裁切测例与组件裁图 |
| style_evidence（修复提交后） | desktop-style-capture.tsx、verify-desktop-theme.mjs、desktop-style-evidence.py及其测试/证据文档 | 不接管DesktopApp/Swift/真实业务入口；补缺暗态，固定同源素材 | M01–M12证据与限制、失败不覆盖、用户确认仍单列 |
| desktop_integration（不在本轮范围） | 7份初始未跟踪文件由原owner处理 | 不能让样式任务改变六方法、原生桥或服务；依赖清单缺项见旧review | 独立集成提交与干净检出复测；本轮不纳入其代码 |

强制保留：控制器/传输、`DesktopNativeBridge.swift`、`DesktopPipe.swift`、`DesktopUIHost.swift`；`desktop-contract.ts` v1 六方法 `projects.list`、`sessions.list`、`sessions.create`、`tasks.submit`、`tasks.cancel`、`tasks.events`。不得新增shell/路径/模型/凭据字段。终态还须 !hasMore 才排空；cancel确认不等于工具退出。不能改selection/stream/cancel/失败不重放逻辑解决视觉问题。

强制保留既有所有testID（含动态project-/session-）：desktop-root、sidebar、sidebar-brand、create-session、search-unavailable、projects、selection、sessions、sidebar-footer、settings-unavailable、chat-column、chat-header、toggle-navigation、toggle-details、status、error、empty-state、messages、message、composer、composer-frame、prompt、stop、send、art-status、details-panel、skin-layers、palace-background、wallpaper-scrim、character-left/right、top-trim、bottom-trim。允许新增独立几何锚点，不删除/改名旧ID或改事件handler。

## 4. 验收矩阵（本轮全部 pending，非勾选完成）

固定 NSH0.5.0 / zh-CN / 合成夹具 / reducedMotion=true，内容画布而非窗口外框；1240×820与680×720、实际scale1，不能把2×强缩为1×冒充。旧run的frame在desktop-style-verification.json；新run每图记录HEAD/混合工作区hash、OS/NSH/字体、明暗、内容与外框、scale、合成标识、素材hash、路径/bytes/SHA-256、步骤/预期/实际/失败原因。矩阵机器镜像见JSON，复核人必须打开新旧图，而非只看文件存在。

| ID | 主题/画布/状态 | 动作和可复核标准 | 旧图支持/缺口 |
| --- | --- | --- | --- |
| M01 | light 1240×820 idle | 新会话；核SA01标题、SA02说明与底饰、输入边饰；文字和不透明装饰无相交 | light-idle，已观察阻塞，未修 |
| M02 | dark 1240×820 idle | 同M01且暗字/占位/禁用可辨 | run-JGWPko无此图，必须新增 |
| M03 | light 1240×820 chat | 发合成短文→工具错误→停止→cancelled/已排空；核SA05/06/07，不伪造成功 | light-chat，短卡宽度及说明问题待修 |
| M04 | dark 1240×820 chat | 同M03，暗色角色/工具/正文对比 | 有dark-chat记录，本轮未逐图重验 |
| M05 | light 680×720 idle | 导航展开/收起；空态标题、说明、输入留空不溢出 | 旧窄图是chat，不证明idle |
| M06 | dark 680×720 idle | 同M05 | 缺图，新增 |
| M07 | light 680×720 chat | 导航展开/收起；长标题与停止按钮不被挤出，详情禁用 | narrow-sidebar/narrow-chat记录，本轮未逐图重验 |
| M08 | dark 680×720 chat | 同M07并验证暗色 | 缺图，新增 |
| M09 | light/dark 1240×820 sidebar | 四角裁图、丝带/盾牌、flat选中/未选中、长名与设置footer；禁用入口仍禁用 | sidebar旧组件板非Electron参考 |
| M10 | light/dark 1240×820 states | 长安全错误、submitting/running/stopping/drained、空输入；边饰下输入和点击停止/发送；来源无业务则仅夹具 | 需专门状态/命中测试；不等于IME或真实PI |
| M11 | light/dark 1240×820 transcript | 短助手fit-content、长文上限、Markdown/长路径、1000行滚动、工具错误；不丢行不横溢 | 旧短会话不足以证明长列表 |
| M12 | light/dark resize/details | 1240详情开/关；680隐藏；700/760/1100/1200阈值两侧；实际1×/2×分别记录，无覆盖就未验 | light-details/dark-details仅已有静态状态，不是动态resize验收 |

自动标准：更新布局/图层单元测试及原生几何锚点，记录文字区域、按钮hit区域和装饰安全区域，文字/按钮与不透明饰纹不可相交；安全区的数值来自修复布局和素材透明边，不凭整张透明图矩形强判。图形边框完整性以同尺寸组件裁图人工复核，几何通过不能替代视觉认可。不设置未经实测的像素相似率。

样式复现（后续owner执行，本轮没有新抓图）：先 `umask 077`，PATH使用现有Node24.15.0，TMPDIR显式新建 `/private/tmp/n01-style-*` 0700；`node probes/nsh-validation/verify-desktop-theme.mjs`无艺术检查；加 `--native --art-root [明确授权所选皮肤目录]`做原生输入；加 `--evidence --art-root [同目录]`产生新run。现capture只有7场景，需先扩展M02/M05/M06/M08，不能以旧命令成功声称矩阵全过。只读校验不符即失败，不自动下载/执行hooks/重写真实配置。

## 5. 本轮交付门禁与未解决项

本轮实际验收为：来源6文本+17素材hash核对、两张原始PNG尺寸/hash及人工打开旧图、源码行号/flat例外/协议/testID复核、保护字节对比、文档专项与全仓命令记录。测试和实际结果见operatelog；本评审中的所有修复/矩阵仍未验收，JSON acceptance 全false。

不改 apps/electron、共用 PI/services、正式程序、聊天/配置/凭据，不安装、退出或重启现用沐码，不部署，不跑性能专项；手机开发/构建/安装/联网与配对验收暂停。无CPU/内存/完整落盘数字或收益承诺。N01-D1/D2/D3及整体不勾。实际Electron同皮肤运行对照、用户视觉认可、IME/动态、干净集成与独立包、全业务资源对比仍是后续门禁。
