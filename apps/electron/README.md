# Moos Electron 本机开发版

以 Moos 的 Electron 主进程打开 DSH 的原版工作台。macOS 开发构建使用已安装的 DeepSeek Harness Desktop 0.2.2-rc.1 提供 Electron 44.7.0 二进制及 DSH Host。准备脚本将启动器、渲染框架和本机 profile 模板组装为 Moos 应用包。

```sh
npm --prefix apps/electron run prepare:local
```

如果固定版本的 DeepSeek Harness 不在「应用程序」中，可以用 `MOOS_ELECTRON_DSH_APP` 指向本机对应的 `.app` 路径。构建仍检查 DSH 和 Electron 版本。

在 Finder 打开命令输出的 `Moos.app`。默认数据目录为 `~/Library/Application Support/dev.moos.agent.electron`。它包含独立 DSH 数据和默认工作区。第一次运行从随包模板加载插件设置。验收可为 Moos 主程序设置绝对路径 `MOOS_ELECTRON_DATA`，使用全新临时目录。

```sh
npm --prefix apps/electron test
```

开发版从本机回环启动原版工作台。应用包使用本机临时签名，运行时依赖指定的上游 App。第三方代码许可及独立分发在打包阶段核验。

Moos 启动时在现有配置之后应用随包的 `execution.patch.yml`。它停用原版内置模型适配器、工具执行器和定时任务，清空四个内置预设的工具配置。会话仍使用原版的创建、恢复和显示协议。皮肤和普通界面插件仍通过原版宿主加载。其他执行类插件需要在 PI 接入后单独验收。

用以下方式启动内置 PI 调度验收。构建命令会输出验收版 `Moos.app` 的路径。运行命令中的路径替换为该应用包里的可执行文件。

```sh
MOOS_ELECTRON_INCLUDE_PI_FIXTURE=1 npm --prefix apps/electron run prepare:local
MOOS_ELECTRON_PI_FIXTURE=1 MOOS_ELECTRON_DATA="$(mktemp -d)" "/path/to/Moos.app/Contents/MacOS/Moos"
```

验收模式默认选中「Moos PI · 本地调度验收」。可在默认工作区发送 `MOOS_FIXTURE_WRITE sample`，检查 `result.txt` 和对话中的工具结果。只接受专用数据目录 `workspace` 下的项目和固定验收指令。PI 复用现有 Host 进程、SQLite 和 Moos 调度器。定时任务、真实项目权限策略及真实模型仍待接入。
