# N01-D3 / style_evidence 修复后独立复核

## 结论：已出新证据，视觉验收未通过，退回修复

本轮不改 `DesktopView.tsx`、theme/layers、控制器、传输、Swift 或协议；仅维护捕获入口、证据处理/测试和文档。历史审计及失败不覆盖。此记录是**证据检查点**，不是 N01 完成交付或用户视觉认可。

- 基准 HEAD：`4cb0f13c930de100b0cf7a06ab4a8611f30ec3bb`。捕获时仅 runner/capture 两个输入在该基准上修改；逐文件 bytes/SHA-256 见 `desktop-style-recheck-verification.json` 中 captureInputs，run 内原件 `capture-inputs.json`。该记录保留捕获时 git status，原有 7 份其他 owner 集成文件未跟踪且不收编；源码仍是混合工作区，不是干净检出验收。
- 开始北京时间 `2026-11-18T03:06:59.871693+08:00`，捕获输入时间 UTC `2026-11-17T19:08:07.592Z`（北京时间 03:08:07）；时间均来自实际文件，不猜测历史完成时间。
- macOS 27.0.1 / build 26A434 / arm64，Node v24.15.0，NSH 0.5.0 (f4d68f7)。独立 0700 `/private/tmp/n01-style-evidence-recheck.*`，实际路径保存在忽略目录 tmpdir.txt。
- 每张记录实际 scaleFactor=1；宽内容 1240×820，外窗 1240×848；窄内容 680×720，外窗 680×748。PNG只含 NSH native development test-host 内容，不含窗口外框，**不是系统录屏，也不是人工 GUI 验收**，更不证明真实 2× 显示效果。固定 zh-CN / reducedMotion；字体沿用系统默认，未确定逐字中文 fallback，不复制字体。
- 所有消息、工具错误和取消排空来自 `desktop-theme-fixture.ts` 的合成响应，**不执行 PI / 外部模型**。保留 cancelled/错误的真实夹具语义，不包装为实际任务成功。
- desktop_permissions 本轮查询显示录屏/辅助功能均未授权。没有请求绕过或取得正式 Electron 实时图；对照是旧 NSH run-JGWPko，不是当前 Electron 窗口。NSH 自身内容捕获不伪装为已取得系统录屏权限。
- 显式所选 Maid Atelier 0.3.2 六文本+17素材 realpath/bytes/hash 匹配。只读授权来源，hooks不执行、不联网下载；CC BY-NC-SA 4.0，保留上善 → zipzip → Small-tailqwq署名链。艺术仅在忽略目录，本地预览不代表发布/商用授权。

## 查看原图（普通文字路径，Finder 可用 ⌘⇧G）

新原图目录：

/Users/xuguopeng/Documents/徐郭鹏项目/徐-moos-agent/artifacts/nsh-validation/desktop-theme/run-tT4s6p/

常用三图：

/Users/xuguopeng/Documents/徐郭鹏项目/徐-moos-agent/artifacts/nsh-validation/desktop-theme/run-tT4s6p/light-chat.png

/Users/xuguopeng/Documents/徐郭鹏项目/徐-moos-agent/artifacts/nsh-validation/desktop-theme/run-tT4s6p/light-idle.png

/Users/xuguopeng/Documents/徐郭鹏项目/徐-moos-agent/artifacts/nsh-validation/desktop-theme/run-tT4s6p/dark-chat.png

并排对照和局部裁图目录：

/Users/xuguopeng/Documents/徐郭鹏项目/徐-moos-agent/artifacts/nsh-validation/style-evidence-recheck/review/

- `light-idle-old-new.png`、`light-chat-old-new.png`、`light-details-old-new.png`、`dark-chat-old-new.png`、`dark-details-old-new.png`：旧图左/新图右，原图1240×820不缩放，另加30px标签区，总2480×850；是标注的**派生审阅图**，不是一个应用窗口。
- `old-/new-light-idle/chat-top-title/composer-bottom/sidebar.png`：12张无损裁图，坐标固定，原始完整图保留；不是修饰、重绘或重新渲染。manifest记录每张来源与rect。
- `light-/dark-narrow-idle-sidebar-project-crop.png`：2张项目名局部，用于定位 SE01，不能裁掉冲突后报通过。
- 新 run 共19张 PNG：12张完整矩阵 + 7张 `legacy-` 前缀连续状态捕获；不再共用文件名相互覆盖。19张均已逐张通过图片读取工具打开，逐张窗口元数据、PNG magic/IHDR、原始尺寸、bytes、SHA-256与绝对路径见验证JSON。工具可能显示JPEG预览；以磁盘PNG原件为准。原图、对照和裁图均不入Git。
- 旧 run-JGWPko、前次 run-atqkxE 及所有失败日志保持不变。旧静态来源板脚本 `desktop-style-evidence.py` 仍对应历史7场景；新19帧复核使用 `desktop-style-recheck.py`，不拿旧7帧假设处理新run。

## 逐张观察（实际图像，不从测试绿灯推断）

| 新原图 | 实际观察 | 结论边界 |
|---|---|---|
| light-idle | 标题位于蕾丝下独立深蓝带；蝴蝶结居中，输入框、独立预览说明、底部crest分开 | 原叠边在该图未见；非用户认可 |
| dark-idle | 同上，明字深底，人物和宫殿仍在 | 暗idle已补，不证明全部暗态 |
| light-chat | 短助手/工具卡收缩，用户右对齐，错误工具卡文字可见；输入/说明分离 | 合成短文，非真实PI/长文 |
| dark-chat | 短卡同上，文字可辨，暗背景与人物保留 | 不证明所有文字对比度 |
| light-details | 右栏详情可见，聊天与输入未挤出，短卡/错误可辨 | 详情宽窗限定 |
| dark-details | 右栏暗底明字，输入与说明未挤出 | 非完整业务等价 |
| light-narrow-idle-sidebar | 标题/输入/说明分离，但项目名A末端与丝带内折线/尖端过近 | **SE01未通过，退回修复** |
| dark-narrow-idle-sidebar | 同一项目名/丝带安全距问题，暗idle主体可见 | **SE01未通过** |
| light-narrow-idle | 隐藏导航后标题与输入/说明分离 | 不等于IME/交互通过 |
| dark-narrow-idle | 隐藏导航，暗idle文字可辨，主体保留 | 不等于动画/真实scale通过 |
| light-narrow-chat | tool_start可见；末条tool_end错误卡未完整进入可视区，底部仅部分边缘 | **SE02未通过，不能证明内容可达** |
| dark-narrow-chat | 同样未完整显示末条工具错误卡 | **SE02未通过** |

另外打开7张legacy原图：宽idle/chat/details与暗chat/details的相同安全区改善可见；两张窄chat同样只显示部分工具卡，不能补成通过。顶部/输入/侧栏全部新旧局部均已打开；重点旧新idle/chat并排图已打开。其他3张并排图由同尺寸原图生成并校验，不冒称人工完整业务验收。

**旧新差异**：旧 idle 蕾丝穿过标题，现在在下方独立带；旧 composer 贴底crest、chat预览说明压在框边，现在卡抬高、说明在独立背景内；旧侧栏缺四角，现在四角/连线与设置分开；旧短助手/工具外卡占满宽度，现在随短文收缩。艺术人物/蕾丝/宫殿/底饰没有删除。chat两轮合成用户文案略有不同，不能当作逐像素diff基准。

**不能接受的余项**：SE01须由native_style_fix核实丝带文字内域并补长短项目名；SE02须由滚动owner定位并补短/长文滚动到末条工具卡的截图及实际验证。当前截图不能区分被裁是正常滚动位置还是高度/滚动缺陷，不能宣称事件丢失，也不能据收到事件宣称可达。历史 `--rich` 长Markdown/路径诊断失败仍open，本轮未复跑或修复，不放宽断言追绿。只有这些复核、用户视觉认可及完整门禁补齐后才能考虑关闭相应项。

## 复现与本轮验证

```sh
export PATH=/Users/xuguopeng/.nvm/versions/node/v24.15.0/bin:$PATH
export TMPDIR=$(mktemp -d /private/tmp/n01-style-evidence-recheck.XXXXXX)
chmod 700 "$TMPDIR"
node probes/nsh-validation/verify-desktop-theme.mjs --evidence \
  --art-root '/Users/xuguopeng/Library/Application Support/dev.moos.agent.electron/dsh/skins/maid-atelier'
# 将打印的新run替换进 --run；--out必须不存在，不覆盖历史：
/opt/homebrew/bin/python3 probes/nsh-validation/desktop-style-recheck.py \
  --run artifacts/nsh-validation/desktop-theme/run-tT4s6p \
  --old artifacts/nsh-validation/desktop-theme/run-JGWPko \
  --out artifacts/nsh-validation/style-evidence-recheck/review-NEW
node --test probes/nsh-validation/desktop-style-evidence.test.mjs
```

- capture 3/3，17.3s，exit0；逐张实际size/scale检查，不把截图成功当视觉通过。
- 新证据helper成功：19原图、5并排、14裁图；验证输入捕获后未变化，拒绝重复名/缺帧/scale或尺寸不符/源码变化/越界输入路径/覆盖旧产物。专项Node3/3内含Python旧3项+新4项，无需私有艺术即可跑。
- headless14/14，11.1s；native安全区9/9，43.6s。只证明原有安全区与动作，不覆盖SE01/SE02。
- 完整核心初次354/354（316.373s）；更新专项后完整串行再跑354/354（206.244s），0失败/取消/跳过。命令：`node --test --test-concurrency=1 probes/m01/*.test.mjs probes/nsh-validation/*.test.mjs services/agent/*.test.mjs packages/pi-adapter/*.test.mjs packages/pi-runtime/*.test.mjs scripts/*.test.mjs`。
- `npm run test:electron`：133通过/10跳过/0失败（53.258s），缺隔离 `MOOS_ELECTRON_TEST_DSH_CLI`，不能称143全过。
- `cargo +1.100.0 test --release --offline --manifest-path probes/m01/desktop/src-tauri/Cargo.toml`（实际绝对cargo路径）：exit101，缺defmt，未联网补依赖。
- Python根文档检查在本轮日志/计划同步后执行，结果另记。日志均在 `artifacts/nsh-validation/style-evidence-recheck/`；本次无新capture失败，历史rich失败不覆盖。
- 初始探针文件除capture/runner/专项测试3个授权输入外，119份输入原字节一致，含视图/主题/层、7份他人业务文件、桥与协议。无正式构建/安装/替换/退出/重启，不改真实聊天/凭据/配置/皮肤，不做性能或手机操作，未部署。没有完整包/同业务全进程资源收益结论。
