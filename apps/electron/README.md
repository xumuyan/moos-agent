# Moos Electron 本机开发版

以 Moos 的 Electron 主进程打开 DSH 的原版工作台。macOS 开发构建使用已安装的 DeepSeek Harness Desktop 0.2.2-rc.1 提供 Electron 44.7.0 二进制及 DSH Host。准备脚本将启动器、渲染框架和本机 profile 模板组装为 Moos 应用包。

```sh
npm --prefix apps/electron run prepare:local
```

在 Finder 打开命令输出的 `Moos.app`。默认数据目录为 `~/Library/Application Support/dev.moos.agent.electron`。它包含独立 DSH 数据和默认工作区。第一次运行从随包模板加载插件设置。验收可为 Moos 主程序设置绝对路径 `MOOS_ELECTRON_DATA`，使用全新临时目录。

```sh
npm --prefix apps/electron test
```

开发版从本机回环启动原版工作台。应用包使用本机临时签名，运行时依赖指定的上游 App。全量 PI 路由和真实模型在后续阶段接入。当前可按 P03.12 的方式，在专用验收数据目录另装 Moos PI 验证插件，检查原版皮肤、Moos 品牌和实际工具结果。第三方代码许可及独立分发在打包阶段核验。
