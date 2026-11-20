# N01-D3 · 顶部标题与字体（源码检查点）

本步只改独立 NSH 候选。图片来自 macOS NSH 0.5.0 development test host 与合成六方法响应，不执行 Host/PI，不采集真实聊天，不部署，也不触碰正式 Electron 和用户配置。

## 霞鹜文楷（2026-11-20，接续 `2256da1`）

- 候选界面统一优先使用 macOS 本机已有的 `LXGW WenKai`，覆盖侧栏及工作区／会话标签、标题、设置、对话正文、输入框、模型选单、任务详情和队列。不可用时走 `system-ui`／`PingFang SC`／`Hiragino Sans GB`／`sans-serif`。代码仍用 Menlo 优先的原等宽字族栈；不改正文 14pt／22pt 或标题尺寸。不注册、安装、下载或随包分发字体。
- 本机 AppKit 查询 `NSFont(name: "LXGW WenKai", size: 14)` 得到 `LXGWWenKai-Regular`，本机也能查询到 Bold 与 Menlo。`--typography` 在合成 `ThemeFontSamples.tsx` 中将候选栈、仅指定 WenKai、不可用字体＋回退、仅回退并排渲染。执行 `python3 probes/nsh-validation/check-wenkai-pixels.py <run>/type-font-samples.png`（要求 Pillow、1× 和本机安装文楷）：在常规／600 字重 Text、原生 Input、Markdown TextView 四行，候选栈与仅指定 WenKai 的图像均完全相同，和仅回退均不同；不可用字体＋回退与仅回退完全相同。600 字重比较验证的是字族，不判断具体采用哪一个 weight face；不宣称逐字覆盖或在未安装字体的 Mac 上实机复验。
- 授权素材 `run-jAhMrV`、色彩回退 `run-8rxpXB` 各 3/3、11 帧（1×）：各有两套浅深 1240×820、680×720 对话与长标题，和两张宽窗设置图以及一张字体对照。窄窗标题盒 368×24，副标题在 64pt 顶栏内。已查阅浅色窄窗对话与深色宽窗设置图。证据为提交前工作区，见 `desktop-wenkai-verification.json` 及 `artifacts/nsh-validation/wenkai/`；不更改下方历史回执。
- 只验证隔离 AppKit 合成场景，不等于用户视觉签收、人工 IME／2× 或真实 PI＋GUI。正式沐码未改动；签名整包、同负载测量、owner 装箱审批，以及其他仓库门禁仍未完成。

## 原规则与候选取舍（历史检查点）

- `SKIN-SOURCE.md` 记录 DSH 默认字族与 14px/22px 正文 token；未读取用户字体覆盖，也未测正式窗口的 computed style。候选以 macOS `system-ui` 为首选，显式列出 `PingFang SC`、`Hiragino Sans GB` 作为正文/输入的中文回退，保留正文字号与行高。
- 已授权静态 `patches.css` 在 572–574、929–937、1055、1092–1094、1306–1324 行分别给出新会话、工作区、项目、欢迎标题的 Georgia/Times 系列及相应尺寸或字重。候选给装饰字增加 `Songti SC` 显式回退，工作区/项目使用 15pt/500，项目行高 20pt，保留丝带文字安全区。欢迎标题使用 27pt/600（窄窗 20pt），不是复刻原 hero 排版。顶部会话标题使用 18pt/600（窄窗 16pt）、24pt 行高和单行省略，这是候选适配，并非从正式顶部标题读出的字号；不复用源皮肤中被 Electron 壳隐藏的 titlebar-brand。
- Markdown 行内代码和围栏代码分别设置 `code`/`codeBlockCode`，优先 Menlo、缺字回退 PingFang SC，再到 `monospace`。这不是原皮肤指定的等宽家族，不保证 CJK 与 ASCII 等列或逐字 glyph 一致。没有安装、下载或随包分发字体；艺术仍仅用明确授权的本机 CC BY-NC-SA 4.0 素材，不提交图片/素材，不执行 hooks。

## 复现与证据

用 Node 22.22.0、独立 0700 `/private/tmp/n01-*` 作为 `TMPDIR`，然后运行：

```sh
node probes/nsh-validation/verify-desktop-theme.mjs --typography --art-root '/本机授权的/maid-atelier'
```

测试使用原生输入框输入混排样本，提交后验证 Markdown 行内文件名、围栏代码、真实滚动回归之外的短工具事件与停止排空；宽 1240×820、窄 680×720，明暗各四图。长标题样本受现有桥 100 字符限制：首轮超长被正确拒绝（`invalid_response`），修夹具不改协议；最终两套标题盒均 332×24、项目副标题位于 64pt 顶栏内。CoreText 枚举核实本机 PingFang SC、Songti SC、Georgia、Menlo 存在且覆盖各自抽样字符，不等于 NSH 逐 glyph 字体观测。

本地证据在 `artifacts/nsh-validation/desktop-typography/`：`header-before-after.png` 是相同合成窗口的前后裁图（非正式窗口）；`typography-light-dark.png` 和 `narrow-title-light-dark.png` 是新一轮两种主题对照。8 张原图在 `artifacts/nsh-validation/desktop-theme/run-fqMOtc/`。Vision OCR 读取图中的混排标题、正文/代码和窄标题省略；OCR 首次 30 秒超时、完整复跑成功。附件在本次工具会话仅回尺寸、没有返回可目视像素，OCR/几何不冒充人工逐图签收，不判断像素一致。

`desktop-typography-verification.json` 记录提交前混合工作区输入、历史 hash 过渡、图/日志摘要、失败与边界。七份旧有未跟踪业务输入原字节保护；完整资源比较、真实 PI 主题集成、用户视觉认可、真实 GUI/IME/2×、字体覆盖、顶部装饰/消息卡/输入框外观仍待逐项验收。N01-D1/D2/D3 不勾。
