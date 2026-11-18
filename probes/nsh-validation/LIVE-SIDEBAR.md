# N01-D3 live_sidebar：当前实窗对照第一步

基准：8d8e051730cde0905a8a6c92f7cfa7292d88c2d5。仅修侧栏透景与顶部品牌牌，不是整个样式完成。证据为提交前混合工作区，7份原owner业务文件未跟踪、原字节未变；未部署，不安装/替换/退出/重启正式应用，不改用户配置/聊天/凭据，手机暂停。

## 新参考与安全边界

用户确认前台后，绑定窗口截图仍未成功（此前 focus-unavailable 安全停止，本次要求指定当前前台目标）；未自动抢焦点或输入。之后通过事务外只读主显示器截图成功得到1920×1080、displayId2、scale1的当前页面。窗口列表此前观察沐码边界(0,30,1920,988)，本轮没有重读应用版本，不能由历史安装信息补造。此证据不是成功绑定的AX窗口截取，也不是 computed-style 导出。

侧栏只裁(0,30,280,988)，不将聊天正文导出/复制进合成夹具。完整系统截图保留工具原位置，裁图/并排板只在忽略目录，均不入Git。参考可见蓝灰透景侧栏、独立深蓝金边品牌牌；与固定静态CSS深蓝侧栏不同，不能改写此前来源事实。

## 本步实现与观察

- `desktop-live-sidebar.ts` 独立观察适配：明确加载本机授权艺术时采用有界半透明蓝灰层，暗色另设更深底；无艺术仍保留原静态深蓝fallback。
- 品牌牌高58、顶部margin44加父padding16，独立深蓝渐变/金边。并排图牌位接近，但没有像素一致性结论。
- `verify-desktop-theme.mjs --live-sidebar --art-root [授权艺术目录]` 使用原生development test host、合成六方法响应，执行发送/停止排空及宽窄截图，不执行Host/PI。候选内容1920×988、外框1920×1016、content origin(0,58)、scale1；参考列表窗口高988与候选content高988不是同一外框语义。680×720另补窄图。暗图只是候选扩展回归，无当前Electron暗图参考。
- 最终4图：`artifacts/nsh-validation/desktop-theme/run-mtTCNE`，实际路径同时记录于JSON candidate.run；首次run-LJCr09仍保留。派生并排 `artifacts/nsh-validation/live-style/sidebar-comparison.png` 左实窗裁图/右合成NSH裁图。首次与最终并排均已打开观察；最终输入只改测试描述文字，不把派生板当成新系统截图。

## 验证

显式Node22.22.0 PATH，独立0700 `/private/tmp/n01-*`；NSH0.5.0/macOS27.0.1 arm64。命令及hash见 `desktop-live-sidebar-verification.json`，日志在 `artifacts/nsh-validation/live-style/`。

- `node --test --test-concurrency=1 probes/m01/*.test.mjs probes/nsh-validation/*.test.mjs services/agent/*.test.mjs packages/pi-adapter/*.test.mjs packages/pi-runtime/*.test.mjs scripts/*.test.mjs`：358/358，228.640秒，含新增2项侧栏token/回退检查。
- `node probes/nsh-validation/verify-desktop-theme.mjs`：14/14；`--native --art-root [授权目录]`：9/9；`--rich`同目录：6/6；`--evidence`同目录：3/3；`--live-sidebar`同目录最终2/2，5.4秒。
- `npm run test:electron`：133通过、10跳过、0失败/取消，42.227秒；缺隔离DSH CLI，不称全部通过。
- `cargo +1.100.0 test --release --offline --manifest-path probes/m01/desktop/src-tauri/Cargo.toml`：exit101缺defmt，不下载补装。
- Python全部文档检查同步后执行，结果见operatelog。旧scroll/recheck输入hash冻结不改写，通过新manifest明确链接后续展示输入；不覆盖旧失败/图/测试结果。

## 仍待处理

新会话按钮比参考偏低；导航与项目树、会话缩进/时间/选中态不一致；小人物/设置框显示不同。顶部标题/聊天列/工具卡、输入框宽度、人物及底饰尚待下一步逐项对照。视觉认可仍未取得，侧栏整体未完成。IME/动画/真实2×/真实PI主题界面、干净集成、历史恢复、完整包及同业务全进程CPU/内存/落盘均未验，不报资源收益。N01-D1/D2/D3保持未勾。

许可沿用Maid Atelier0.3.2、CC BY-NC-SA4.0、上善→zipzip→Small-tailqwq；仅显式本机预览，不执行hooks/联网，不提交艺术/字体/截图。
