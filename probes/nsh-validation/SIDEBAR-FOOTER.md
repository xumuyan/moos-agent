# N01-D3 sidebar_footer｜当前页面第三步（未整体验收）

接续 f75ce67 / SIDEBAR-TREE.md，复用已有授权侧栏裁图；不是新截图正式窗口或 computed-style。独立 NSH0.5.0 development test host、合成六方法响应，不执行 Host/PI，未部署、不改真实聊天/配置或手机。

## 修改与来源

- 静态 Maid Atelier0.3.2 `patches.css:473` 明确 `:has([role="tree"]) [data-skin-chrome="sidebar-mascot"] { display: none }`。原生视图已是项目树，改为显式 treeMode 隐藏小人物；不是为缩减资源删除装饰。flat-mode仍保留图和布局函数，只有单元测试，没有flat-mode原生页面验收。
- 底部蕾丝高度 clamp(sidebarWidth×.2575,54,94)，footer=swag+82；底部抵到侧栏边缘，取消重复16pt外层padding。设置高36、局部top=swag+2、left/right18、文字前padding18，透明背景、齿轮＋设置；这是当前截图观察适配，不等同静态CSS的50高border-image按钮。图标是文本字形近似，功能未接入且按钮保持disabled。
- 移除额外开发版本行和截图参考中不存在的设置深蓝外框；合成/非正式身份仍在测试窗口标题及聊天预览说明明示，不冒充正式产品。设置素材本身保留在资产表；未删除美术或改变艺术检查。
- 保持36px名称安全域、稳定消息快照、输入框/消息滚动、会话选择/新建/切项目和停止排空，不改7个原owner未跟踪业务文件。

## 实际验证

macOS27.0.1 arm64、Node22.22.0、NSH0.5.0、scale1，0700 `/private/tmp/n01-*`。源hash、保护hash、旧tree→本轮输入过渡、PNG/hash和日志见 `desktop-sidebar-footer-verification.json`；原始日志 `artifacts/nsh-validation/sidebar-footer`，本次为提交前混合工作区而非干净检出交付。

- helper首1过1败：72.10000000000001严格等于72.1失败；改精度比较后完整核心首361过1败，另一44.000000000000014严格相等仍失败。改该处到1e-9误差比较，不改变尺寸或删断言；完整核心最终362/362、121697.146625ms、无取消/跳过。前轮Scheduler两项本轮通过，不宣称已定位/修复历史失败。
- `node --test --test-concurrency=1 probes/m01/*.test.mjs probes/nsh-validation/*.test.mjs services/agent/*.test.mjs packages/pi-adapter/*.test.mjs packages/pi-runtime/*.test.mjs scripts/*.test.mjs` 为完整核心命令。
- `node probes/nsh-validation/verify-desktop-theme.mjs` 无艺术fallback headless14/14（8.2s）；首误给headless加--art-root，fallback-only断言失败13过1败，日志保留，不修改fallback断言掩盖误调用。
- 同runner `--native --art-root [授权目录]`9/9（26.3s）、`--rich`6/6（63s）、`--evidence`3/3（12s）、`--live-sidebar`3/3（17.5s）。最终run-xCpSgb八张原PNG，宽1920×988、窄680×720；宽外框1920×1016/content origin(0,58)，参考crop y30非像素注册。实际原生验证footer贴底/设置留白/树中人物不显示/禁用设置/去开发行，以及密集16会话8项目滚动、会话新建切换和停止；rich保留长文两端/末卡/跨poll/resize，不能以文本存在代替可达。
- `npm run test:electron`133通过10跳过（14.230s，缺隔离DSH CLI）；`cargo +1.100.0 test --release --offline --manifest-path probes/m01/desktop/src-tauri/Cargo.toml`exit101缺defmt，不下载，不能称全部测试通过。`python3 -m unittest discover -s tests -v`195项194通过1失败（1.581s）：既有ForkRestartRecoveryTests找不到E124忽略产物 `artifacts/fork-recovery-restart/final/gui/recovery-gDj96a/report.json`。未修改旧断言、生成替代报告/截图或冒称全绿；需恢复可核实的历史证据后解除。

已打开初稿及最终560×988对比板、最终明暗680窄窗原图。设置位置和人物状态更接近参考；蕾丝/蝴蝶结光学位置、图标/字体仍有差异，不称像素一致或整个侧栏完成。下一步仍有顶部/标题、消息工具卡/输入框/人物背景/底饰，用户视觉认可、人工GUI、IME/动画/真实2×、干净真实PI集成/独立历史配置/完整包和同业务全进程资源测量待做。

艺术仅本机授权只读预览，CC BY-NC-SA 4.0，上善 → zipzip → Small-tailqwq；不执行hooks/联网，不提交素材/字体/截图。七文件hash一致、未收编，N01-D1/D2/D3继续未勾，整体验收标志全false。源码提交推送与正式安装/部署分别报告。
