# N01-D2/D3｜AppKit 同品牌完整验收包与体积对照

2026-11-20，macOS 27.0.1 arm64；锁定 NSH 0.5.0 `f4d68f7`、Rust 1.100.0、PI 1.5.0、Node 24.15.0。`.app` 显示名为「沐码」，图标和简繁/英语本地化沿用仓库素材，标识为 `dev.muma.probe.nsh.appkit.package.check`。这是搬移后自动运行的验收程序，不是供日常使用的沐码，不要装入 `/Applications`。

| 实测包 | 普通文件逻辑大小 | 完整落盘（`du -sk`） | ZIP（`ditto -c -k --keepParent`） | Node 落盘 | 依赖目录落盘 |
| --- | ---: | ---: | ---: | ---: | ---: |
| AppKit 完整依赖 | 267,692,827 B | 306,120 KiB / 298.95 MiB | 85,141,602 B / 81.20 MiB | 116,436 KiB | 156,036 KiB |
| AppKit 仅去调试映射 | 235,113,336 B | 263,484 KiB / 257.31 MiB | 76,893,077 B / 73.33 MiB | 116,436 KiB | 114,696 KiB |

- 两套使用同一 AppKit 编译产物，重签后主执行文件都为 28,277,824 B；资源封印不同，移除**两个独立副本**的签名后主程序字节一致。两包均内置 Node、PI/Host 和锁定生产依赖；构建用 `npm ci --offline --omit=dev --ignore-scripts`，不捆绑 npm/npx 命令。首次启动不下载运行时，不要求用户准备 Node。Node 的系统库链接检查和包内链接检查通过。安装/展开大小和 ZIP 下载量不是内存。
- 差异为 3,863 个具有 JavaScript/TypeScript 映射扩展名、有效 v3 JSON 结构的调试文件，逻辑 31,251,485 B、原文件分配 42,369,024 B。剩余 11,494 个依赖文件/链接逐项比较内容、文件权限或链接目标一致；没有删 SDK、运行模块、类型声明、许可证或平台资源。落盘差 42,636 KiB（含目录/签名变化），ZIP 差 8,248,525 B。源码映射不再可用于对应堆栈的映射诊断。安装后的实际分配依文件系统而定。
- 历史 Catalyst 包为约 343 MiB 落盘；这次 AppKit 去映射后比该历史值约小 86 MiB，但两代 UI/验收入口不同，不是等功能产品对照。上表两份 AppKit 才是同输入的对照。未改 Node、未替换依赖图、未做按覆盖率删除运行代码。
- 两个包分别从检出目录移动至新建 0700 的 `/private/tmp/n01-appkit-package-*`，不留原位置副本；空 `profile` 和 `storage` 在包外，数据根由 native 入口校验。搬移前、搬移后和实跑后均 `codesign --verify --deep --strict`。用清空环境和临时 cwd 直接运行包内执行文件：首启空历史、重启 Send 前拿回原会话两条文本，其他项目保持空；PI 续聊确认真实收到前轮上下文。然后活动 bash Stop，观察终态仍有积压，排尽后同会话 write/read 并核对工作区结果。每版两次进程退出 0、Host 未强停/诊断 0 字节、租约释放。只验证脚本和最小窗口，不是正式全界面或人工操作。
- 两版还用**包内 Node 和已签包内 Host 模块**，从临时目录运行已有双协议测试：默认 GLM Responses、显式中转 Completions、同会话切换、write、401、Stop/排空/再发，均为合成回环 HTTP；没有调用外部模型。签名 AppKit 的入口仍只启用独立合成历史，不读取任何模型配置，不把包内后端双协议证明写成 GUI 可选真实模型。未验证 Developer ID/公证、最小 macOS、跨机器、人工 Finder/Dock/Quit、异常中断、安全恢复或相同业务的全进程性能。没有读取/更新正式用户数据、构建/安装/退出正式沐码或恢复手机工作。

## 复跑（无新依赖下载）

从仓库根目录，使用已校验的 [锁定源码目录](DESKTOP-APPKIT.md)（原 NSH 入口 Git blob `6ff10a0f8eacbd00c2bb13949155cacb07929e9b`）、已安装 Node 24.15.0、缓存的 npm 依赖及 Xcode。每个包用新的独立 `artifacts/nsh-validation/appkit-package.*`；两个目录可复用**同一** runner 和 build 证明，不要重复使用已有 profile：

```bash
ROOT=$(pwd -P)
UPSTREAM=$(cat /private/tmp/n01-appkit-source-dir)
FULL=$(mktemp -d "$ROOT/artifacts/nsh-validation/appkit-package.XXXXXX")
SLIM=$(mktemp -d "$ROOT/artifacts/nsh-validation/appkit-package.XXXXXX")
NODE="$HOME/.nvm/versions/node/v24.15.0/bin/node"
/bin/bash probes/nsh-validation/appkit-hostcheck/build-package-runner.sh "$UPSTREAM" "$FULL" > "$FULL/native.log" 2>&1 &&
  echo 0 > "$FULL/native.status" &&
  cp "$FULL"/{AppKitPI,libN01AppKitPipe.dylib,main.rs,native.log,native.status} "$SLIM/" &&
  "$NODE" probes/nsh-validation/verify-desktop-appkit-package.mjs "$FULL" &&
  "$NODE" probes/nsh-validation/verify-desktop-appkit-package.mjs "$SLIM" --trim-maps
```

记录：`desktop-appkit-package-evidence.json` 及忽略目录 `appkit-package.HomMhA`（完整）/`appkit-package.77ftSB`（精简）内 `result.json`、原日志、ZIP 与 `relocation.txt`；初次包装汇总误读 Node 24 默认 reporter 的失败由 `appkit-package.mBZKPX` 保留。临时包的 ad-hoc 签名只供本机开发验收；本轮未生成分发包，也未推送或部署。下一步是在独立候选把 AppKit 完整交互和隔离双模型接齐后再谈真实上游与发行，不把合成验收当作切换依据。
