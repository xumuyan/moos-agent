# N01-D3 / scroll_fix：原生长消息与窄窗修复检查点

基准 `de7107af7537c1ed79505222d3853334c5073fb0`；本轮仅修改独立主题展示与测试，不接管7份未跟踪的UI业务文件。证据见 `desktop-scroll-verification.json`。历史 `STYLE-EVIDENCE-RECHECK.md` / `desktop-style-recheck-verification.json`、旧失败日志与图片不改写。**整体视觉验收仍未通过**：未获用户视觉认可、未验中文IME/真实2×/动画，也不是干净检出集成或实际PI任务界面。

## 定位及修复

- 原消息List的 `each` 每次读取都 `rows.map(r => ({ ...r }))`。状态轮询即使没有新消息也会替换全部对象。在本机NSH0.5.0原生development host中，650px高的Markdown卡存在时，列表contentSize却回落到352px；窄窗最大offset81，末条工具错误卡不可达。
- 增加scope隔离的不可变展示快照：状态轮询保留数组及每条对象身份；原地追加的流式文本替换对应快照，保留其他行；项目/会话切换重建。控制器/协议不改。
- 同测试的旧视图加**相同只读测量回调**，4/4失败；只保留快照修复、移除贴底/底部padding的隔离变体4/4通过。最终候选长文回归4/4＋丝带回归2/2通过。这证明本次复现的对象身份/测量失效风险，不宣称修复NSH所有滚动问题。
- 最初旧版弱诊断加回调后曾2/2通过，不能用它确定根因。新测试要求实际原生offset到达末尾、内容高于视口、末条错误卡可见、等待900ms多轮轮询不回跳，宽窄互换后仍可达并停止排空。保留35次中文、30次路径段及代码块，不删装饰、不缩内容。
- List启用initialScrollAtEnd、48px贴底阈值、12px底部padding；用户上滚离开末尾时不靠定时强制跳底。1000行测试原来向下滚，启用初始贴底后报“已在末尾”，改成向上1200，仍检查虚拟化及停止，不放宽计数。
- SE01：项目按钮右padding从10改36，对应丝带末端35px＋1px间隔。Text minWidth0、单行省略；680宽侧栏内部152，实际项目文本right≤116。长名明确截断，不缩字体或删丝带。
- SE02：普通明暗窄聊天末条工具错误卡在新图中完整显示；长文的底部可达性由原生滚动回归单独验证。onLayout为父局部坐标，未把工具卡局部y0误作全局位置。

## 实际结果与证据边界

环境：macOS27.0.1 arm64、Node22.22.0、NSH0.5.0(f4d68f7)，独立0700 `/private/tmp/n01-*`。显式 `--art-root` 只读验证授权maid-atelier0.3.2素材，不执行hooks/不联网，CC BY-NC-SA4.0，署名上善→zipzip→Small-tailqwq；艺术、字体不入Git。

执行：

- `node --test probes/nsh-validation/desktop-message-rows.test.mjs`：2/2。
- `node probes/nsh-validation/verify-desktop-theme.mjs`：14/14。
- 同命令加 `--native --art-root [authorized selected skin root]`：9/9；加 `--rich --art-root [...]`：6/6；加 `--evidence --art-root [...]`：3/3。
- 完整核心 `node --test --test-concurrency=1 probes/m01/*.test.mjs probes/nsh-validation/*.test.mjs services/agent/*.test.mjs packages/pi-adapter/*.test.mjs packages/pi-runtime/*.test.mjs scripts/*.test.mjs`：356/356，220.037秒。
- `npm run test:electron`：133通过、10跳过，缺隔离DSH CLI，不称143全过。
- `cargo +1.100.0 test --release --offline --manifest-path probes/m01/desktop/src-tauri/Cargo.toml`：exit101缺defmt，不下载依赖。
- Python文档检查以manifest/operatelog收尾结果为准；文档测试不是应用实际验收。

原图目录（非实时系统录屏，均为NSH原生development test host＋合成响应，不执行PI）：

- 长文/长短项目名16图：`artifacts/nsh-validation/desktop-theme/run-ytILIW`。
- 明暗宽窄/idle/chat/details与legacy连续状态19图：`artifacts/nsh-validation/desktop-theme/run-dMA3g4`。
- 两组共35原始PNG，1240×820或680×720；普通矩阵STYLE_FRAME记录scale1，外框1240×848或680×748。rich组按viewport捕获内容，未单独记录每帧外框/scale，不能借矩阵证据补造其测量。
- 已查看35图的缩略contact与原尺寸 `light-680-rich-end`、`light-narrow-long-name`、`dark-narrow-chat`；其余图不是逐张原尺寸视觉签收。contact是派生索引，不当作原生原图。
- 日志与首败保留 `artifacts/nsh-validation/scroll-fix`。基线测试直接从仓库根运行曾写出4张top图，已移到忽略证据目录；cache-only首次相对工具路径错误exit127后修正重跑，未将未执行记为通过。

7份未跟踪集成输入前后SHA-256相同，不纳入提交。候选仍依赖这些未提交业务输入，**不是干净检出完整交付**。屏幕录制/辅助功能未授权，未做实时系统截图/真实输入；正式Electron、聊天、配置、凭据、皮肤、安装、进程均未改动。不部署、不构建/更新手机、不跑资源专项；没有CPU/内存/完整落盘节省结论。N01-D1/D2/D3保持未勾。
