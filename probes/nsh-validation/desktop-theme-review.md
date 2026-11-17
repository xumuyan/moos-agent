# N01-D3 native_style 检查点（非完整交付）

## 范围与来源

以 `SKIN-SOURCE.md` / `skin-source.json` 中正式持久选择的 maid-atelier 0.3.2 为静态基准，不再用 E139 浅蓝样板当作当前皮肤。持久选择不证明运行窗口 hooks、临时试穿、明暗模式或最终 computed-style。本轮仅展示层、主题、装饰、隔离测试；没有改控制器、六方法协议、共用 PI/services、正式 Electron 或真实聊天/配置/密钥。未执行第三方 hooks、未联网下载素材。

接管前22文件及旧视图/主题保存在忽略目录 `artifacts/nsh-validation/native-style/initial-worktree.json` 和 `original/`。已有视图、主题、夹具和runner不是本轮从零新增。最终开始文件中仅 DesktopView.tsx、desktop-theme.ts、desktop-theme.test.tsx、desktop-theme-native-check.tsx、desktop-theme-capture.tsx、verify-desktop-theme.mjs 六份被有界修改；控制器、传输、Swift及集成runner等保持原字节。新增图层/默认无艺术模块/显式艺术导入器及专项测试。

## 实现与差异

| 项目 | 已实现 | 仍有差异/边界 |
| --- | --- | --- |
| 主题 | 深蓝/金色、精确8位透明色、系统字体栈、Georgia装饰字；跟随系统明暗 | 正式运行窗口明暗未知；字体回退/栅格化非像素一致性验收 |
| 壁纸 | 原生日/夜宫殿 cover、scrim、独立左右人物及透明边、聊天/详情/窄窗几何 | 未移植hooks；人物无入场/缩放动画；无低电量/实时resize状态机 |
| 侧栏 | 280宽/184窄适配、品牌、新会话、workspace丝带/盾牌、flat会话选中、chibi、swag、设置框 | 窄导航是主动适配；sidebar-corner镜像裁切、树状会话线/时间/动画未实现；搜索/设置显式禁用 |
| 聊天 | 真实公开消息、工具开始/结束/错误、停止/排空、14/22字、18/7角、边框/阴影/透明度、列表虚拟化 | 角色标签/工具卡是NSH探针结构，不是完整DSH DOM等效；公开工具内容不等于完整产品工具展示 |
| 输入框 | 深蓝渐变、backdrop blur/saturate、clamp圆角、准确文字/caret/placeholder；9裁切原生图重建边框 | backdrop与CSS原生等效性未做像素测量；输入法组合态未人工验收 |
| 顶/底饰 | landing/workspace尺寸、平铺、底crest，聊天底饰隐藏 | 原生标题栏不重复网页32px inset；顶栏文字为原生适配，落点与原网页不同；无过渡动画 |

全部装饰默认 `pointerEvents: none`；nine-slice跳过零面积源片，并按小目标缩减对边，避免除零及重叠。没有用WebView/Electron渲染主题。

## 本机艺术与许可

源码 `desktop-theme-art.ts` 默认空。无艺术明确显示“纯样式回归，不是完整皮肤预览”。只有隔离 runner 的显式 `--art-root` 才只读选择的17张原图；按已知路径而非JSON顺序映射，realpath拒绝越界，逐项字节数/SHA-256全部通过后才写入忽略run目录；运行视图不读取正式目录。原图/字体/完整hooks不入Git。CC BY-NC-SA 4.0及上善→zipzip→Small-tailqwq来源链必须保留；“本机授权素材预览”只描述本轮用户授权的本机读取，不是已获得发布/商用权。随包和商业分发仍须独立权利审查。

## 验证与实际观察

macOS27.0.1 arm64，Node24.15.0，NSH0.5.0(f4d68f7)。本任务从一开始显式 TMPDIR 指向 `/private/tmp/n01-native-style.*`、0700。命令与数值见 `desktop-theme-verification.json`。真实原生开发host测试与NSH→Swift→Host→PI的Mac Catalyst链不是同一种验收；本主题夹具为合成六方法响应，不执行PI任务，不冒充外部真实模型、正式安装或人工GUI验收。

初始类型错误（inset、字符串圆角、TextView样式及Bounds类型）已修正；新增测试第一次7通过2失败，实际是错误会话标题预期和颜色规范化8位hex预期，已修正测试，不改业务行为。初图新会话不居中、顶饰盖住标题；修正对齐、层级和艺术下backdrop后重抓。早期失败日志保留。statusBar能力警告未擅自放宽。

已读取原生保存截图，非实时系统录屏：1240×820收起/展开、680×720窄窗、1240×820暗色idle/chat。图片在忽略run目录，原始magic已核实为PNG（工具JPEG预览编码不作为原始编码证据）。看到原图已加载、九宫格角/边及人物分层呈现，但没有正式窗口同尺寸对照、用户视觉认可或像素级结论。暗色图曾暴露角色标签过暗，随后调整为浅色并重跑；顶栏文字仍为主动原生适配，不能宣称严格还原。

## 集成交接与未完成

集成所有者须在 `verify-desktop-ui.mjs` 的源复制清单添加 `desktop-theme.ts`、`desktop-theme-layers.tsx`、`desktop-theme-art.ts` 及 `assets/desktop`；当前原清单缺这些依赖，本任务不越权改其runner。`DesktopApp.tsx`、controller/transport、Swift UI host、acceptance及集成runner等开始时已存在但仍未跟踪，未批量纳入本检查点。当前全量结果对应混合工作区，不证明干净检出主题/业务集成已交付；需各owner串行提交后完整重跑。

N01-D1/D2/D3不勾选。完整模型配置/历史持久化/重启恢复、中文组合输入、快捷键/前后台、动画、正式独立包GUI、用户视觉认可、等价业务全进程CPU/footprint和完整落盘仍未验收。Electron默认10项跳过、M01 Rust离线缺defmt，不称全部测试通过。没有安装、替换、退出或重启正式沐码，没有部署；Git推送也不等于部署。

### 最终保存图复核补记

最终run-TuMwh2中暗色角色标签与窄窗导航图标对比已改善，4项原生测试及2项capture重跑通过；移除了nine-slice内误留的无用暗色filter闭包。**idle顶饰蕾丝仍与会话标题基线相交**，底部预览说明可与边框相叠，不能说顶栏全部遮挡问题已彻底解决；需后续同尺寸来源对照后继续修正，不据自动化通过勾视觉完成。

收尾完整核心曾350通过/1失败：scheduler排队预算用例没有等到failed终态，未改此内核且原因未定；单独12/12、同状态整套351/351重跑通过仅是再次执行结果，未证明稳定性/根因修复。Electron仍133通过/10跳过，新增文档检查后170/170。
