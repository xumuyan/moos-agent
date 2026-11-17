# N01-D3 / skin_source：当前正式 Electron 皮肤来源调查

## 状态与授权

本任务是**只读来源调查和静态测试**，不是视图移植、GUI 验收、运行时 computed-style 快照或资源收益证明。
2026-11-17 用户新授权：可窄范围读取当前正式皮肤选择元数据、皮肤组件及其素材；覆盖此前本任务“不读正式皮肤”的限制，
**不扩展到聊天、模型配置、凭据、数据库、浏览器私有存储或其他私有文件**。未执行 hooks、未联网、未上传素材，未改设置或正式应用。

开始 HEAD：`381868ba2bb1876fbdb55d3d605bdee9f4c6ade0`。现存未跟踪 UI/主题/接线文件均归他人，未改动。
逐文件初始 hash 记在忽略的 `artifacts/nsh-validation/skin-source/initial-worktree.json`。
本成员只新增本文、`skin-source.json`、`skin_source.py`、`skin_source_test.py`、`skin-source.test.mjs` 和 `skin-source-verification.json`；根 PLAN/operatelog/Git 收尾待集成任务串行办理，不能把本文当作已提交交付。

## 1. 已核实的身份，而不是历史截图推测

| 对象 | 当前本机文件证据 | 结论 |
| --- | --- | --- |
| 正式选择 | `$REAL_USER/Library/Application Support/dev.moos.agent.electron/dsh/skin-center-active.json`，只投影 active/initialized/background 是否存在 | `active=maid-atelier`、`initialized=true`、没有 background 覆盖键 |
| 皮肤 | 同根 `skins/maid-atelier/skin.json` | 深海女仆工坊 / Abyssal Maid Atelier，`0.3.2`，manifest v2，作者 Small-tailqwq |
| 皮肤中心 | 同根 `profiles/web/node_modules/@linxin666/dsh-client-ui-skin-center/package.json` | `0.4.16`，Apache-2.0 |
| DSH 默认主题 | `/Applications/沐码.app/Contents/Resources/host-runtime/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme` | `0.2.2-rc.1`，MIT |
| 前端壳基础 | 同 host-runtime 的 `@deepseek-ai/dsh-web-frontend` | `0.2.2-rc.1`，hash 在 JSON |
| Electron 自有覆盖 | DSH 根 `profiles/web/node_modules/moos-electron-shell/client.js` | `0.1.52`；**与工作区 plugin/client.js 全文件不相同**，只确认本文列出的覆盖规则一致，不拿仓库 hash 替代安装版本 |

皮肤核心 SHA-256：

- skin.json：`7596a704bce65006381d27417d4c12bb09d7e5ede038a6f486cfa58e62314aa5`
- skin.css：`df43829fd428e4c294c4ce24612bd2c1cea553501e323d7659973632a77a6dad`
- patches.css：`b18e8eb467493c7993a2ed45ba2acea7a76c9bfe365eb680dff12c7784469ed7`
- hooks.mjs：`1f2e0f12c19c8b07301d290dc8d8ca5428f0051fe9417b50c8951919f8136e74`

完整字节数、组件/素材 hash、原始规则行号、条件、精确声明见 `skin-source.json`。JSON 是可复核的静态事实清单，不是可直接替换 NSH 的主题。
保存的 active 证明当前**持久选择**，不证明活跃窗口没有临时试穿、其他背景插件接管或加载失败。
未读取实时 DOM 标记 `html[data-dsh-skin]`、`body[data-ds-dark-theme]`，明暗模式、hooks 是否成功均 **unknown**。
因此不能宣称已核实“此刻每个屏幕像素”的实际皮肤；这个缺口不能用 E139 或历史 maid 证据补齐。

## 2. 样式加载链与归属

仓库 `apps/electron/host.mjs:22–24` 只读核对：`DSH_HOME=home`，`DSH_SKINS_HOME/DSH_SKINS_DIR=home/skins`；
没有执行 Host。皮肤中心 `lib/index.js` 的 `defaultActiveStatePath/readActiveState` 静态证实选择文件位置和 active 解析。

皮肤中心 `lib/client.js`：

1. `1293–1307` 创建 stylesheet link；`1484–1497` 先加载 stylesheet，再 patches（patch 失败会吞掉异常），再 installBackground、installHooks；最后设置 html 的 data-dsh-skin 标记。
2. patches 服务端会按皮肤 ID 作用域转换，不能将原文件选择器直接当作运行时最终 CSS；原文件顺序和 `!important` 需保留，最终优先级须浏览器验证。
3. `1144–1188` 提供 6 个公共装饰层；背景 z=-2，ambient=30，top/bottom/sidebar=40，foreground=41。
   **这些层不是 maid hooks 自建的同名装饰**，不要把其 z 值混用。
4. `1199–1231` 背景 img 固定填满、`object-fit:cover`，没有显式 object-position（CSS 初始值为 50% 50%）；scrim 是同层后置 sibling。
5. `1379–1405` 挂入背景层时令 body background-color=transparent、background-image=none；`1428–1460` 可选 hooks 失败仍保留静态皮肤。
6. `skin.css` 提供皮肤语义 tokens；`patches.css` 覆盖 DSH 组件；`hooks.mjs` 创建人物/蕾丝/侧栏装饰和动态状态，而非单纯 CSS 色板。
7. Electron shell 安装文件 `client.js:671–673` 隐藏皮肤 titlebar-brand、隐藏 darwin 侧栏切换控件内自有图标、将沐码侧栏名称设为 `#f3e3c0`；品牌名称由自有 slot 提供，不能照抄 hooks 的 DeepSeek 标题。

未知：运行时所有插件最终注入先后、用户字体覆盖、Wallpaper Engine 接管与后台模糊参数。没有为调查读取宽泛设置或浏览器存储。
选择文件不存在 background 键，不代表所有其他插件背景也都关闭。

## 3. 组件映射与精确样式

以下均为**源声明**，不是 NSH 像素测量；暗色、媒体查询与状态覆盖在 JSON 保留。所有 px 均是 CSS 逻辑像素，不能直接当 Catalyst 屏幕物理像素。

| NSH 待实现组件 | 当前真实来源 | 应交给视图 owner 的精确参数 |
| --- | --- | --- |
| 窗口画布 | skin.css :root / dark body | 浅底 `#dce6f5`、文字 `#172347`；暗底 `#080f27`、文字 `#e5eaf6`；gold `#c5a468`、soft gold `#e2cfaa`；不是现有 teal accent |
| 默认字族/排版 | DSH ui-theme lib/client.js | 默认文本 `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif`；存在用户字体变量覆盖。s-14=14px/22px、400；这是可用 token，不是证明每个控件均使用14px |
| 左栏底 | patches.css:370–394 | `#0a173b`；内容层 `radial-gradient(circle at 50% 14%, #5b77bc3b, #0000 31%), linear-gradient(#102456f7, #050e2bf5), repeating-linear-gradient(135deg, #ffffff07 0 1px, #0000 1px 7px)`；主字 `#f8f3e8`、次字 `#d7def0`；边影 `8px 0 34px #08113038, inset -1px 0 #fff5d7d1, inset -3px 0 #e2cfa6b8` |
| 左栏宽/收起 | hooks:390–448 | 初值280px，但依据 ResizeObserver 实测动态更新；宽≤120为rail、≤220为narrow，否则wide；≤104 compact；0宽是有效折叠值。不能改成小窗口固定184而称原样 |
| 新会话 | patches:556–575 | 素材 nine-slice，border `0 40px`、slice `0 210 fill`、stretch、min-height58、margin-block4px 8px；Georgia/Times New Roman/serif，16px，600，文字 `#152246`，不是普通白圆角按钮 |
| 项目/会话行 | patches 中 data-maid-workspace-row / session 状态 | 项目行高度54px、padding7px 10px 7px 7px、Georgia/Times New Roman/serif、`#f4ead5`；active 项目盾牌/丝带、会话首尾和运行追光按源状态匹配，不能仅填浅蓝选中底；完整对应规则见JSON |
| 右详情面板 | patches:481–487 | 浅 `#f2f6fdd1`、左边 `#c5a46885`；暗 `#0b1737e6`；未发现可据此确认固定260宽，宽度应属布局契约，不由皮肤色值推断 |
| 用户气泡 | patches:1964–1971 | 浅 `#e8edf9f2`、边1px `#c5a4687a`、影0 6px 20px `#1326571a`；暗 `#1e2f5af7` |
| 助手正文卡 | patches:1974–1989 | 浅 `#f8fafff0`，边1px `#c5a4686b`，radius18px 18px 18px 7px，max-width:min(680px,96%)，padding14px 18px，shadow0 4px 14px `#13265714`；暗 `#121f43f0`、边 `#d3b47766` |
| 输入卡 | patches:1516–1527 | `blur(8px) saturate(.88)`；背景 `linear-gradient(#1b2c54f0, #0a173ae6), #0d193bb8 !important`；radius clamp(26px,2vw,34px)、padding-top34、border0、overflow visible。暗规则无important，不能忽略前面important而擅自认定其胜出 |
| 输入装饰框 | patches:1634–1649 | before z1，border-width72px 54px 52px、slice170 120 115、border-image-width同、stretch、inset -20px -14px -18px、drop-shadow0 9px 18px `#050d2638`；原图1800×588，必须保留透明边缘和九宫格语义 |
| 输入文字/插入符 | patches:1696–1712等 | caret `#bcd2ff`、placeholder `#b6c2e0` opacity1；正文继承规则和后续覆盖须实现前再核对；不把“浅色输入卡”作为当前目标 |

Hex 8位 alpha 必须按尾两位/255解释，例如 `#f8faffad` alpha=173/255，`#f8fafff0`=240/255；不得从截图重新猜透明度。
默认圆角 token 为4/8/12/16/20/28，但皮肤局部可覆盖；不能给所有 native View 统一12再称一致。
模糊是 backdrop sample，不是将组件自身内容一起高斯模糊；NSH 是否等价实现尚未验证。

## 4. 壁纸、独立人物与装饰图层

### 背景

- day/night 宫殿均1586×992（hash和字节数见JSON），**没有人物合并在宫殿图的推断**；人物另有两份透明素材。
- 按皮肤中心：全窗口 fixed image、cover、中心裁切；不是 stretch，不是截图裁图。
- 浅 scrim：`linear-gradient(rgba(248,250,255,.12) 0%, rgba(235,240,250,.18) 55%, rgba(220,230,245,.25) 100%)`；暗 `.15/.25/.35` 的完整色值见JSON manifest字段。
- background z=-2；patches body isolation:isolate 避免负层被画布盖住。native 移植需自己构建等价合成顺序，不照搬 Web z-index。

### 人物和状态

- hooks:327–351 在 body 最前挂 character-stage（fixed inset0、z0、overflow hidden、pointer-events none）；每个人物absolute、z1、contain、center bottom、drop-shadow0 20px 24px `#1b2c5b24`。
- 左图1122×2019；left0、translateX=`sidebarWidth+clamp(8px,1.3vw,24px)`、height clamp(560px,96vh,1180px)、bottom clamp(-34px,-2.4vh,-12px)。
- 右图1394×2649；right0、translateX clamp(-8px,-.2vw,0px)、height clamp(540px,92vh,1120px)、bottom clamp(-26px,-1.8vh,-8px)。
- 活跃聊天：两者opacity .9；左高clamp(420px,64vh,760px)、右clamp(420px,62vh,730px)，bottom均clamp(-24px,-1.5vh,-8px)。
- 右面板打开：右人物translateX clamp(-460px,-24vw,-320px)；活跃聊天时opacity .86、高clamp(360px,56vh,680px)；≤700px右图隐藏。
- ≤1080px人物opacity .74（位移另有无聊天条件），≤700px活跃人物高另降至46vh/44vh；暗色brightness .84、saturate .92。
- hooks 不可用时 body:before/:after 为后备人物层（z=-1），stage存在则后备display none。**不能把后备和stage同时绘制。**

### 饰边

- top-trim：z1、高76，absolute，left sidebarWidth/right0；后续patches:2430将top改为动态titlebarHeight（hooks测量列顶或桌面回退32px），不是固定top0；landing瓦片按auto51px、left -2px repeat-x；workspace按auto149px、left -4px，层高76。切换translateY，.52s cubic-bezier(.4,0,.2,1)。蝴蝶结80×42、top -1、中心带8px光学校正。
- bottom-trim：fixed底、z19、高60、auto30px repeat-x；会话活跃时translateY100%，.52s cubic-bezier(.22,.78,.2,1)；底徽94×54。
- 侧栏corners：四角62×62显示窗，原图按130×130裁切并镜像；边框独立线层，不可将整张1254×1254图简单拉满。
- mascot：图620×553，width随侧栏×.82且≤320；left52%、translateX-50%、opacity .22、max-height38%；底部位置=swagHeight+94；rail或树视图隐藏。
- swag：1200×303，宽100%高100% stretch；高度 clamp(sidebarWidth×.2575,54,94)，并非按原图等比自动高度。

## 5. hooks / 动画交接（静态阅读，不执行）

`hooks.mjs:100–116` 将真实 DOM 状态投影为 activeChat/activeConversation/betterSidebarOpen/cordisPanelOpen/settingsOpen/workspace。
native 不运行第三方 hooks；从自有控制器真实状态映射等价视觉状态，不能为动画伪造推理或任务成功。
`603–616` hero→active 为dock，反向rise，标记保留560ms；patches 动画关键帧、transition和prefers-reduced-motion条件保存在JSON animationFacts（源文件行号可定位）。
人物位移.62s cubic-bezier(.22,.78,.2,1)，opacity .42s；resize时关filter/transition；低功耗关filter仅保留opacity .18s。
源含session jewel chase、workspace header/ribbon enter、composer dock/rise、reasoning sweep；动画绑定的实际工具/加载/公开输出状态应逐项核实，未实现的不假装可用。
hooks 还会改网页标题、favicon、系统chrome、搜索焦点等，这些**不是本轮NSH需要自动照搬的皮肤纯视觉**，尤其不能覆盖沐码品牌或抢回焦点。

## 6. 素材来源与许可边界

来源声明：<https://github.com/Small-tailqwq/dsh-deep-whale/tree/main/maid-atelier>；本轮未访问网络，URL是manifest内声明，不是远程内容已核实。
本机17份WebP的路径/尺寸/字节/SHA-256全在JSON；可在原安装仍存在时按对应hash复核，无素材复制。
LICENSE hash `1349a4b6148492b44f629e64eed676612e234fe9a839e4f3b277c1482c8849f1`；NOTICE hash `ca42fd8e4b877137d965afa51ee108d833fa0d6b8f5c7397d7dfcebdddcf5ef6`。

NOTICE 声明完整署名链：**上善**（角色原设计，pixiv 62155430）→ **zipzip**（DeepSeek元素女仆再设计，声明由GPT Image 2生成，pixiv 18604994）→ **Small-tailqwq**（本皮肤再设计）。这是来源方声明，不是本任务独立版权调查结论。
许可 **CC BY-NC-SA 4.0**：须保留署名链、非商业、衍生同方式共享；不能因为皮肤中心Apache或DSH MIT就把美术视为MIT。
本任务不授权公开提交/商业分发/随包再分发；没有复制原艺术文件、字体、完整hooks到仓库，也没有从截图裁壁纸。
本清单仅记录必要样式事实和少量规则摘录。视图owner如需本机独立试验，先确认授权范围，在忽略目录存放并核对hash，不可静默纳入包/公开Git；需发布时另行确认权利、附LICENSE/NOTICE并明确改动。
Git检出本身**不能复现完整美术效果**，因为素材未随交付；原文件变更或缺失则停止，不下载未知替代品或生成近似图充数。

## 7. 对现有 NSH 与基线的明确差异（交接，不改视图）

本次检查版本hash：

- DesktopView.tsx：`8aeb4d53d6c0cc302cc75c85d2dcadae900dac31a16092f1c2930e76e8519280`
- desktop-theme.ts：`d27a9ed5ec8dd6ddfa8fd107168baf8e414ad5ac21603905840505e2b9c71f98`
- DESKTOP-BASELINE.md：`353864653c27edb57922cc73cf05322f3848a9721a1a22018473e29d5355e804`

现有 theme canvas `#dcecf5`、sidebar rgba(239,247,252,.90)、accent `#138e9b`，不能作为maid来源；View只有纯色半透明面板，没有宫殿、人物、蕾丝或nine-slice。
左栏统一padding16/gap14，标准白按钮；消息均radius12/padding12，输入height100/radius20/白底；右面板套sidebar色；均与本清单源声明不同。
保持原有controller、actions、testID、停止排空逻辑，本成员不修改任何这些文件。

**建议按依赖交给各owner：**

1. 集成/基线owner：追加更正而非覆盖历史。E139只保留历史几何参考；当前皮肤以本次选择与hash为准；本文授权仅对皮肤窄读有效。原“未找到素材”“不读皮肤”是当时状态，不应删除历史记录。
2. 主题owner：先实现不含艺术的精确tokens/暗浅变体/组件尺寸、border和padding，再实现等价的九宫格/渐变/backdrop层能力；不能仅替换两个蓝色。
3. 素材/许可owner：确认独立试验和未来分发权；有授权且hash匹配后才本机接入17图中的必要子集。尺寸/位置公式保持，不截图裁取。
4. 主题owner：实现人物/饰边/侧栏状态，resize、窄窗、右栏、低功耗/reduced-motion；不执行第三方hooks或重用其焦点恢复行为。
5. verifier：先核实实际窗口data-dsh-skin/明暗/预览状态（须单独授权只读方法），再用独立合成业务、同1240×820内容尺寸/scale/字体并排截图。未确认运行时身份和用户视觉认可前不勾主题还原。
6. 资源owner：完成等价业务与外观后再做全进程负载测量；本任务无CPU/内存/磁盘收益数据。

## 8. 复核、测试与最终收尾

离线测试（不读正式目录）：

```sh
PYTHONDONTWRITEBYTECODE=1 python3 probes/nsh-validation/skin_source_test.py
```

在用户授权仍有效且明确给出真实用户路径时才重取清单（先输出忽略目录，人工比较，不覆盖已记录证据）：

```sh
python3 probes/nsh-validation/skin_source.py \
  --dsh-home '/Users/xuguopeng/Library/Application Support/dev.moos.agent.electron/dsh' \
  --app '/Applications/沐码.app' \
  --output artifacts/nsh-validation/skin-source/recheck.json
```

解析器只处理本皮肤使用的静态CSS块/嵌套media/keyframes，并非浏览器cascade/computed-style引擎；不承诺任意CSS语法。
测试覆盖缺选择/非法ID/manifest不符、路径与软链越界、三类WebP尺寸、CSS注释/字符串/嵌套/截断、版本/hash结构、精确组件事实及许可/运行时未知边界。
本轮最终专项为11/11，Node wrapper 1/1已纳入npm核心测试清单；核心完整串行346/346，默认Electron133通过/10跳过（缺隔离DSH CLI，不能称143项全部通过），文档167/167。完整命令、机器/时间、已读文件保护结果与待串行收尾的信息见 `skin-source-verification.json`。本次Rust离线检查exit101，实际缺`defmt`（tauri→serde_with→jiff依赖），不是沿用历史缺tauri的原因；未联网补依赖。没有构建/安装或GUI验收。
专项通过不代表全仓或GUI验收通过；未改Electron、不构建安装或重启正式应用、不恢复手机路线。

### 2026-11-17 native_style 后续检查点（追加，不覆盖上文历史）

上文第7节是来源调查时的旧视图hash与浅蓝差异，不是后续版本现状。之后主题owner有界接管 DesktopView/desktop-theme 等，按持久选择实现深蓝金色、系统明暗、原生nine-slice、人物和装饰；显式 `--art-root` 全部17图校验后仅复制到忽略预览目录。来源调查“无素材复制”只适用于当时只读采集，本次预览有本机隔离复制、仍未把原图/字体/hooks提交Git或随正式包发布。原生图保存不证明正式运行皮肤/用户视觉认可/资源收益。后续差异及验收以 `desktop-theme-review.md`、`desktop-theme-verification.json` 为准；skin-source-verification.json 保留前序历史状态，所记未更新全局文档/未提交推送也是当时事实。
