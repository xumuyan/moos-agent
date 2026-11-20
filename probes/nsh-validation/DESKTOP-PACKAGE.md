# NSH 本机候选包：沐码

这是 N01 桌面试验，不是正式 Electron 更新。`.app` 和默认显示名均为「沐码」，读取仓库正式品牌资源 `apps/electron/assets/moos.icns` 并核对 SHA-256，不重绘图标；本地化名称同正式构建规则（简体「沐码」、繁体「沐碼」）。应用标识为 `dev.muma.probe.nsh.package`，计划使用独立的 `~/Library/Application Support/dev.muma.probe.nsh.package`；不会读取正式沐码的数据目录。包名相同，**不要放入 `/Applications` 覆盖现有沐码**。

```sh
# macOS arm64，使用现有 Node 24.15.0、锁定的 npm 离线缓存及 NSH/Xcode 工具链。
node probes/nsh-validation/verify-desktop-pi.mjs --package --build-only
# 独立 .check 标识；移动到 /private/tmp 后脚本验收两次启动。
node probes/nsh-validation/verify-desktop-pi.mjs --package
```

- 实际试用包在 `artifacts/nsh-validation/pi-ui/run-fr0Prc/沐码.app`，约 343 MiB（`du -sk`，不含用户数据）；未打开或安装该包。它含 NSH、Node、白名单 Host 文件及锁定依赖。缓存安装禁用联网、安装脚本和用户 npm 配置；包内不引用检出目录运行时，不捆绑正式或候选模型密钥、历史或本机主题。Node 子进程使用固定的包内路径和私有 stdio。只有本机合成回环模型，不支持外部 GLM/中转服务；外部模型仍是先前独立试验入口，不和此模式混用。
- 独立 `.check` 验收包用同一套打包运行时，启用脚本入口并用临时兄弟目录保存数据。签名后移出源码目录再重开，3 项首启、7 项重开通过；恢复同一会话的文本和真实 PI 续聊，Host 两次正常退出并释放锁。不能据此声称试用包的每用户路径、人工 GUI、Finder/Dock 实际渲染、异常终止或真实上游通过。
- 两种包仅 ad-hoc 签名，通过 `codesign --verify --deep --strict`。未做 Developer ID、公证、跨机器或干净检出验收；构建仍使用既有未跟踪的 owner 控制器与传输，仅在本机使用，原文件不改、不纳管。记录和输入哈希见 `desktop-package-evidence.json`。
- 下一步为独立试用包人工验收及合成迁移演练，正式数据还不读、不备份、不导入；不退出正式沐码，不恢复手机。
