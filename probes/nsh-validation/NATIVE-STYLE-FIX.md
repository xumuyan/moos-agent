# N01-D3 / native_style_fix：安全区修复检查点

本轮从 `73b8e28488d5a371440cc7404e0b861f912f9a19` 进入实际修复，不再只是 style_audit。历史审计 JSON/旧图及 open/pending 记录保留原样；本轮结果以 `desktop-style-fix-verification.json` 为准。测试对应提交前混合工作区，7份原有未跟踪业务文件仍属原 owner，不代表干净检出集成或完整产品验收。

## 修改及来源

- **SA01**：保留48/76高顶饰；聊天内容内另留8px间隔，再放64高原生标题承载层。蝴蝶结相对聊天列50%居中。不是额外添加Web titlebar的32px偏移，不删标题/蕾丝。来源 patches.css:193–232、258–271、2430–2432，hooks:275–353。
- **SA02 / SA07**：输入卡158高、顶部54、水平32、底部28；外围上下24安全区容纳frame外扩20/18。预览说明保留36高独立承载层，idle再留60底饰、active留8。保留1800×588源、170/120/115 cuts及72/54/52边、明暗深蓝渐变。来源 patches:274–305、1516–1542、1634–1648、1696–1712。原生安全区不是来源像素一致声明。
- **SA03**：四角用62×62容器裁130×130右上源，镜像容器，补1px落点及连线；不把整图缩62、不冒充nine-slice。来源 patches:411–451。所有装饰pointerEvents:none；艺术缺失时角饰为空。
- **SA04**：保留54项目/36 flat会话及选中金条、丝带和盾牌，未增加树模式/伪时间。侧栏底部补6px内容间距。长名称/完整树状态仍待验。
- **SA05 / SA08**：标题承载层、窄窗导航/详情保留，状态/错误/stopping/cancelled/排空语义及处理器不改。右栏260、窄侧栏184是原生适配，不是来源固定尺寸。
- **SA06**：消息改fit-content及min(680,可用宽96%)上限；短助手实际onLayout收缩，暗助手边框/阴影调整。用户右对齐、助手左对齐保留。将同一外卡规则应用工具/用户是探针适配，不宣称完整DSH消息渲染等价。
- **SA09**：新增动态断点几何验证，但字体fallback、动画、中文IME、真实1×/2×仍未验。不执行hooks或伪造动画。

## 实际检查与失败保留

新增可选 `onGeometry` 只读布局诊断；runner在忽略目录生成ThemeGeometry，通过隐藏且不接收点击的Text读取真实NSH onLayout。**onLayout为父容器局部坐标**，首次误当全局导致`4 >= 120`失败；随后测量chat-body/actions并按父子层换算，没有降低安全边界断言。旧testID和六方法不变，控制器/传输/Swift/业务入口不改。

最终：无艺术headless14/14；显式校验艺术native安全区9/9；原生capture3/3。覆盖明暗1240×820/680×720、idle/chat、窄导航开关、短助手、发送/busy禁发、工具错误、停止cancelled排空、切项目、宽详情；动态699/700/701、759/760/761、1099/1100/1101、1199/1200/1201的idle安全区和详情显隐。既有1000行虚拟化/停止仍通过。

**新增长Markdown/长路径诊断未通过**：前两轮11项分别9过2失败、10过1失败；后续逐页滚动一轮超时。长卡后工具错误卡在native滚动后未稳定进入可见范围，不能据事件已收到声称内容都可达。根因未定（虚拟高度/滚动/测试目标均需定位），未越权改业务。隔离为 `desktop-theme-rich-check.tsx`，以 `node probes/nsh-validation/verify-desktop-theme.mjs --rich --art-root [所选皮肤目录]` 复现；不是默认安全区9项的一部分，**没有因此将M11或全部测试标通过**。超时只SIGTERM精确核对的本轮孤儿test host PID78680，不触碰正式Moos或其他进程。初始contact图排版重叠，仅用于预览，改生成contact-full后复核，不把拼图错误当应用错误。

日志在 `artifacts/nsh-validation/native-style-fix/`：native-first、native-final、native-recheck、native-final2保留失败；最终headless-final、native-safe-final、capture-final、core、electron、rust。完整命令和统计见根operatelog。Electron10跳过与Rust离线缺defmt仍阻塞全部回归门禁。

## 新截图与观察

最终run：`artifacts/nsh-validation/desktop-theme/run-atqkxE/`。12图为light/dark各idle、narrow-idle-sidebar、narrow-idle、narrow-chat、chat、details。JSON保存原PNG magic/IHDR、bytes/hash；在本机原生development host生成，内容捕获不是系统实时录屏、Electron实窗或人工GUI。场景为合成响应，未执行真实PI任务。

实际打开完整12图缩略板contact-full，并单独打开light-narrow-chat、dark-details原尺寸图：
- 明暗idle标题在蕾丝下方独立深蓝带，蝴蝶结居中；说明不再落在底crest上。
- 明暗窄窗导航显隐时，输入/发送/停止和独立预览说明未被框饰遮盖；边框完整。窄chat列表视口较短，截图仅显示部分工具卡，**不是事件丢失证据也不是全内容可达证明**。
- 明暗宽chat短助手收缩，用户右对齐，暗色文字可辨；宽详情未挤掉输入区域。四角/连线与底部设置分开，装饰未挡新增会话和输入动作。
- 人物/宫殿保留独立层；高对比深蓝标题与较大的输入框/安全留白是当前原生适配。并非像素一致，也没有用户视觉认可。

## 矩阵状态（不覆盖历史）

M01–M08：本轮合成明暗宽窄idle/chat均有新图及几何/动作检查，限定为安全区已验证，不等于真实业务/用户视觉认可。
M09：四角实现及窄导航图已补；长项目名、完整树/rail待验。
M10：保留原错误/停止/取消/排空/禁用回归；长错误与stopping长驻几何未专门测量。
M11：短文与既有1000行通过；长Markdown/路径诊断失败，保持open。
M12：宽详情与12个动态断点idle通过；active全过程resize/真实1×/2×/动画/IME未验。

## 保护与边界

重新只读匹配maid-atelier0.3.2六文本和17素材bytes/SHA-256；不执行hooks、不联网。CC BY-NC-SA 4.0，署名上善→zipzip→Small-tailqwq，原图/字体/完整hooks不入Git；本机预览不是发布或商业授权。默认艺术为空，仅runner显式--art-root启用，视图不读正式目录。

初始目录所有文件保存hash；除7份授权实现/runner文件及本轮评审增量外，其余原输入原字节一致，特别是7份他人业务文件及contract/Swift。历史审计测试只对明确授权修复的6份旧展示输入豁免旧hash，保留非owned hash和原testID/六方法检查；新增文档测试锁定本轮边界及失败状态。

不安装、部署、替换、退出或重启现用Electron；不改用户聊天/配置/凭据/皮肤。手机继续暂停。不跑性能专项；没有完整包/全进程同业务资源测量，**无体积/CPU/内存收益结论**。N01-D1/D2/D3及整体保持未完成，下一步先定位长消息诊断，再由原owner做干净检出真实PI集成，视觉认可另请用户确认。
