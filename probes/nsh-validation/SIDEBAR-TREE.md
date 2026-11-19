# N01-D3 sidebar_tree｜当前页面第二步（未整体验收）

接续 `4cbd4f8` / LIVE-SIDEBAR.md。用户要求继续逐项对照；本次复用已获授权的当前页面侧栏裁图，没有新截正式应用、读取聊天或操作其窗口。参考为显示器截图，不是 AX 绑定窗口或 computed-style。候选是 NSH 0.5.0 development test host 的合成六方法响应，不执行 Host/PI、不是人工 GUI。

## 改动

- 新会话高48、品牌下8pt，导航三行各38，工作区38；替代原按钮偏低、搜索占位横条和独立会话面板。
- 项目列表变为可滚动的项目树：仅选中项目下展开真实桥返回的会话，缩进分支线、选中金边/圆点。另一项目的会话尚未请求，不伪造它的历史。项目名称仍右留36，窄窗长名称省略。
- 保留项目切换/选择会话/新建、消息稳定快照及滚动跟随；项目名称诊断移到聊天副标题。
- 插件、后台任务、更多、搜索、添加项目、工作区选项仍禁用，未宣称已实现。会话协议没有时间字段，不伪造“刚刚/几小时前”；图标暂为字形近似，不是像素一致。
- 单个 List 项是项目及其会话组，使用实际会话数量计算高度；不得把第17条新建会话裁掉。加载上限16是现有控制器约束，本轮不改业务文件。

## 实际检查

Node22.22.0，macOS27.0.1 arm64，独立0700 `/private/tmp/n01-*`。命令/原始日志位于 `artifacts/nsh-validation/sidebar-tree`，精确输入/hash/历史过渡见 desktop-sidebar-tree-verification.json。只读使用既有授权的 Maid Atelier0.3.2 素材，CC BY-NC-SA4.0，上善 → zipzip → Small-tailqwq；不执行hooks/联网，不提交艺术/字体/截图。

- `node --test probes/nsh-validation/desktop-sidebar-tree.test.mjs` 初2/2；最终逻辑由完整核心再覆盖，两项通过。
- `node probes/nsh-validation/verify-desktop-theme.mjs` headless14/14；`--native --art-root [授权目录]`9/9、`--rich`6/6、`--evidence`3/3。rich保留真实滚到长文两端、末条工具卡、跨poll/resize及36px名称安全域。
- `--live-sidebar --art-root [授权目录]` 首2/2、加入密集夹具3/3、最终3/3（18.0s）；补回selection诊断testID后再3/3（18.1s），最终 run-iz4JLc 八张原PNG：明暗1920×988、680×720、切项目B，加密集树第16会话/第8项目H。几何验证按钮/导航次序、会话嵌套、禁用入口；程序化实际原生滚动后点击，切项目不泄漏原消息；选择会话/新建/停止排空。
- 宽窗外框1920×1016、内容1920×988、全局内容原点(0,58)、scale1；参考裁图原点(0,30)，不称像素注册。
- 完整核心命令 `node --test --test-concurrency=1 probes/m01/*.test.mjs probes/nsh-validation/*.test.mjs services/agent/*.test.mjs packages/pi-adapter/*.test.mjs packages/pi-runtime/*.test.mjs scripts/*.test.mjs`：首360项357通过3失败，最终358通过2失败（83.188s）；均无取消/skip。失败在 scheduler.test.mjs heartbeat/state-wait，最终timeout两项仍失败；单独 `node --test services/agent/scheduler.test.mjs` 10过2败。没有改共用服务、延长断言或无限重试，根因未定。
- `npm run test:electron` 133过10跳过，缺隔离DSH CLI；Rust `cargo +1.100.0 test --release --offline --manifest-path probes/m01/desktop/src-tauri/Cargo.toml` exit101缺defmt，未下载。不能称全部测试通过。
- Python首次192项2失败（日志/计划未落盘、selection testID遗漏），精确edit补齐后192/192（0.601s）；失败日志保持。历史 live/scroll manifest 不改写，新 manifest 链接旧hash后锁定新输入。

已打开首版及最终并排、最终680原图和密集树原图观察：上部排列和项目会话结构更接近参考；参考原有项目很多，候选普通夹具只有两项目，数量不能当布局缺陷或复制真实内容填充。人物/设置区仍明显不同、图标不一致，时间尚无契约。顶部/消息卡/输入框/底饰继续待修。用户视觉认可、IME/动画/真实2×、干净检出真实PI主题集成、独立持久化和同业务全部进程资源比较仍缺。

七份原owner未跟踪业务文件初末hash不变，未收编。本轮仅源码检查点，N01-D1/D2/D3均不勾选；未部署、不安装/替换/退出/重启正式沐码、不改真实聊天/配置/凭据、不恢复手机。所有整体验收标志保持false。
