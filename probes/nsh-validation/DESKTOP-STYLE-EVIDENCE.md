# N01-D3 style_evidence：原生内容图与静态来源对照

本轮只交付可复现的样式证据，不新增业务。基于 fa37db417f438a8b80b1c01a314e889642a65272 的混合工作区，7 份其他成员未跟踪 Host/UI/控制器文件未编辑、未暂存；10 份保护输入 SHA-256 原字节一致。默认入口在隔离 source 生成，截图不复制他人 DesktopApp/Swift/业务验收入口；仍需已有 controller/transport 提供视图接口，因此不代表干净检出业务集成通过。

2026-11-17 本轮只读复核正式持久选择及六份皮肤文件 hash 与 skin-source.json 一致：maid-atelier 0.3.2，CC BY-NC-SA 4.0，署名 上善 → zipzip → Small-tailqwq。未执行 hooks、未读取聊天/凭据、未修改正式设置。持久选择仍不能证明运行时试穿、明暗及 computed-style。desktop_permissions 显示录屏、辅助功能均未授权，故没有安全取得当前 Electron 实图，也未尝试绕过。E139 浅蓝历史图不充当同皮肤参考。

图像来自 **NSH 0.5.0 (f4d68f7) macOS development test host 的原生内容捕获**，不是实时系统截图、人工 GUI 或正式独立包验收。六方法是合成响应，用户输入写有“【合成样式证据】”，公开文本写有“测试夹具/不是实际任务”；任务停止后真实夹具显示 cancelled/已排空及 tool_end 错误，不伪造成功，不执行 PI 或外部模型。

环境为 macOS 27.0.1 arm64、Node 24.15.0。固定 locale=zh-CN、reducedMotion=true，先 light 后 dark；测试断言 scale=1、内容1240×820或680×720，窗口状态实测外框1240×848或680×748（顶部装饰28点），PNG不含外框。主屏1920×1080/1×，副屏1710×1107/2×；不是任意显示器结果。系统字体实际探针为 .AppleSystemUIFont，装饰 Georgia；中文 fallback 与 NSH 最终字形未逐字核实，不能称字形像素一致。并排板使用单独指定 Arial Unicode.ttf，hash见JSON，板中文字不作为NSH字体证据。

## 文件、尺寸与来源

以下路径均相对仓库根；机器清单 `desktop-style-verification.json` 记录每张原图/裁图/板图的真实绝对路径、bytes、SHA-256、原PNG magic/IHDR、裁剪矩形和窗口状态。图只在忽略目录，不把第三方艺术提交Git。

- 原图目录：`artifacts/nsh-validation/desktop-theme/run-JGWPko/`。`light-idle.png`、`light-chat.png`、`light-details.png`、`dark-details.png`、`dark-chat.png`均1240×820；`narrow-sidebar.png`、`narrow-chat.png`均680×720。
- 并排及裁图目录：`artifacts/nsh-validation/style-evidence/review-final/`。5组 `background`、`sidebar`、`messages-tools`、`composer`、`details` 的 `*-native.png` 与 `*-comparison.jpg`；`states.jpg`为详情/窄窗状态并排，1240×900。对照板1280×900。
- 对照右侧来自已核实 `skin-source.json` 的原 CSS 规则、文件行号及独立 Pillow alpha 合成色块，左侧是NSH裁图。**它不是CSS渲染器、Electron截图或完整DOM合成参考**，只支持来源事实与可见候选人工核对，不计算虚假像素相似度。背景板选择body:before人物规则，宫殿/暗色完整规则仍以来源清单为准；消息板选择用户气泡规则，不把它当作全部工具样式。
- 7张原图+5张PNG裁图+6张JPEG复核板总计10,429,040字节（约9.95MiB），小于16MiB图像预算；不包含工具链/隔离JS构建及前次失败保留run。release JS build通过，只是28.6KB JS/34.4KB bytecode/18素材的局部编译，不是签名.app或完整安装体积。
- 已实际打开 states、5类组件板、light-idle、light-details、dark-chat复核。工具显示的JPEG转码预览不能作为原图编码证据；程序检查原始PNG。

## 差异表

| 区域 | 已有证据 | 差异/尚未验收 |
| --- | --- | --- |
| 背景 | day/night宫殿、独立人物，idle/chat/detail状态，原图hash | 动画与CSS整体合成未等效测量；不证明正式运行态相同 |
| 顶栏 | 内容origin0、高75、金边装饰 | idle蕾丝与标题基线仍相交，可读性未通过 |
| 侧栏 | 主画布280宽，窄窗184，深蓝/金色选中、新会话/项目装饰 | 列表树线/时间、corner镜像裁切未完整还原；窄导航是原生适配 |
| 消息/工具 | 合成用户/公开文本/tool_start/tool_end错误，浅暗主题 | 原生卡片和公开事件投影；字体/透明/blur无生产像素或computed-style度量 |
| 输入框 | 深蓝渐变、九宫格蕾丝、空输入禁发，原生实际截图 | 底部预览说明仍贴边或叠边；边框与backdrop无浏览器等效度量 |
| 详情 | 收起与展开260宽，暗色，窄窗自动隐藏 | 内容为夹具状态；不是正式右栏逐项功能或视觉认可 |
| 输入与资源 | 捕获文字有合成标识、尺寸/scale断言通过 | 中文IME/快捷键/正式GUI未验；无同业务全进程CPU/内存/完整落盘收益结论 |

## 复现

先显式创建独立0700目录，不继承正式应用的TMPDIR。本机本轮为 `/private/tmp/n01-style-evidence.6hvw9L`；只读所选素材需用户授权，文件数/路径/hash/字节全部核实后才复制到忽略run。缺失或不符失败，不自动下载、生成或用模板替换。

```sh
umask 077
export PATH=/Users/xuguopeng/.nvm/versions/node/v24.15.0/bin:$PATH
export TMPDIR=$(mktemp -d /private/tmp/n01-style-evidence.XXXXXX)
node probes/nsh-validation/verify-desktop-theme.mjs --evidence \
  --art-root '/Users/xuguopeng/Library/Application Support/dev.moos.agent.electron/dsh/skins/maid-atelier'
# 以上打印新的run绝对路径；用该路径替换下列--run，--out必须是不存在的新目录。
/opt/homebrew/bin/python3 probes/nsh-validation/desktop-style-evidence.py \
  --run artifacts/nsh-validation/desktop-theme/run-JGWPko \
  --out artifacts/nsh-validation/style-evidence/reproduce-new
artifacts/nsh-validation/toolchain/nsh/bin/nsh build \
  artifacts/nsh-validation/desktop-theme/run-JGWPko/source/ThemeNative.tsx \
  --release --out artifacts/nsh-validation/style-evidence/reproduce-build-new
node --test probes/nsh-validation/desktop-style-evidence.test.mjs
node probes/nsh-validation/verify-desktop-theme.mjs
node probes/nsh-validation/verify-desktop-theme.mjs --native \
  --art-root '/Users/xuguopeng/Library/Application Support/dev.moos.agent.electron/dsh/skins/maid-atelier'
```

Pillow为本机已有依赖（/opt/homebrew/bin/python3），脚本不安装包。复现时不同显示器scale将明确断言失败；不偷偷缩放伪造1×。runner默认无--art-root不读正式目录，可验证无艺术fallback。固定入口只带视图/主题/fixture/controller/transport/contract与自有品牌资产，显式本机艺术另外校验；不扩展nsh.json statusBar能力。

本轮保留首次出图run-N8M9hu：NSH将测试输出写stderr，旧runner test.log为空导致板生成拒绝；已同时保存stdout/stderr后重新捕获run-JGWPko。首轮专项2/3、核心353/354因中文URL.pathname未解码失败，改fileURLToPath后专项3/3（含3项Python helper）、完整核心354/354。headless9/9、原生4/4、capture1/1共7场景、release build通过；默认Electron133通过/10跳过（缺隔离DSH CLI），Rust离线缺defmt exit101。所有日志在 `artifacts/nsh-validation/style-evidence/`，文档检查最终结果见PLAN/日志与验证JSON。不以本轮通过覆盖历史scheduler间歇失败。

没有安装、替换、退出、重启正式Moos，没有LAN或手机构建/安装/配对。未结束任何正式/其他成员进程；按本轮run路径检查未见残留测试进程，未删除既有run或临时目录。权利/用户视觉认可/完整GUI/干净业务集成/资源验收仍缺，N01-D1/D2/D3均保持未完成。

提交关联：`test(N01-D3): add reproducible native style evidence and source boards`；查询 `git log --all --oneline --grep='reproducible native style evidence and source boards'`。源码提交、GitHub推送与应用部署分别核实。
