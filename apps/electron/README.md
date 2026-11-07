# Moos Electron 本机开发版

以 Moos 的 Electron 主进程打开 DSH 的原版工作台。macOS 构建阶段从 DeepSeek Harness Desktop 0.2.2-rc.1 取得 Electron 44.7.0 和工作台 Host，组装为内置 PI、Host 与插件安装器的 Moos 应用包。

```sh
npm --prefix apps/electron run prepare:local
```

如果固定版本的 DeepSeek Harness 不在「应用程序」中，可以用 `MOOS_ELECTRON_DSH_APP` 指向本机对应的 `.app` 路径。构建仍检查 DSH 和 Electron 版本。

在 Finder 打开命令输出的 `Moos.app`。默认数据目录为 `~/Library/Application Support/dev.moos.agent.electron`。它包含独立 DSH 数据和默认工作区。第一次运行从随包模板加载插件设置。验收可为 Moos 主程序设置绝对路径 `MOOS_ELECTRON_DATA`，使用全新临时目录。

```sh
npm --prefix apps/electron test
```

开发版通过本机回环提供工作台。Host 和插件安装器使用应用包内的 Moos 可执行文件，不需要另外安装 DSH、Node.js 或 pnpm。应用包使用本机临时签名，面向其他用户的分发和签名另行验收。

Moos 启动时在现有配置之后应用随包的 `execution.patch.yml`。它停用原版内置模型适配器、工具执行器和定时任务，清空四个内置预设的工具配置。会话仍使用原版的创建、恢复和显示协议。皮肤和普通界面插件仍通过原版宿主加载。其他执行类插件需要在 PI 接入后单独验收。

在 macOS 菜单「Moos → 模型服务…」中填写模型 ID、服务地址、协议、API 密钥和推理档位。保存后在会话输入区切换模型。选用「Moos PI · 自动选择」时，已有 GLM 配置优先，否则使用首个已配置服务。切换到其他服务或推理档位时，可在会话中选用对应配置。外部服务地址须使用 HTTPS。

默认启动的 Moos 已内置 PI SDK，由本机 Host 与 Moos 调度器执行普通文本会话。服务信息存于数据目录的 `providers.json`。API 密钥保存在本机 `private/credentials.json`，目录权限 0700，文件权限 0600。更改服务地址时需重新填写密钥。

自动模式每个任务最多切换一次。首选模型在回复或调用工具前遇到额度、限流或连接错误时，切换至已配置的备用模型。常规验证命令在两轮文件修复后仍返回相同失败时，优先使用配置为 High 或 XHigh 的 OpenAI 中转模型接手，同一 PI 会话保留此前的工具结果。切换原因记录在「执行过程」。手动选定模型时按该模型运行。

「设置 → Token 用量」汇总本机 PI 请求的服务返回值。会话输入框下方显示当前会话最近一次有记录请求的缓存命中率，以及该请求的输入 Token 和当时配置的上下文窗口。旧记录缺失的窗口和服务未返回的字段显示为「—」。

会话中的「执行过程」可展开查看 PI 实际执行的动作和状态。正文保留回复与改动摘要，省略代码块和工具原始输出。Git 工作区在任务前后核对 Git 可见文件的新增、修改和删除，能识别命令产生的变化。没有可用 Git 快照时，文件清单显示已成功的 PI 写入与编辑操作。

会话最近一次 PI 任务失败、停止或中断后，输入框上方会显示「继续上次任务」。重新打开原会话也能继续。点击后按当前模型和权限提交一轮 PI 任务，使用该会话已保存的工具结果，原任务记录仍保留。

macOS 的受限命令可使用本机配套的 Node/npm 和 Git。保留已有 PATH，缺少 Node 和 npm 时查找常见 Homebrew 或 nvm 安装位置。Git 使用 PATH 上的 Homebrew Git，或直接调用 Apple 当前开发工具中的 Git。工具运行文件只读，命令仍受工作区和网络权限限制。

回复下方的「在新对话中分支」从选中的轮次继续。新会话有独立的 PI 历史，与原会话使用同一个工作区。选中的轮次有 PI 检查点时，分支继承该位置的工具结果。旧记录按已有对话文字恢复。

默认安装的用户扩展只有皮肤中心。构建会裁剪上游可选扩展、原执行器和附属的 Office、语音运行时。工作台保留项目、会话、文件树和插件安装器。需要扩展时，在侧栏「插件 → 添加插件」输入受信任的包名、GitHub 地址或本地路径。公开源安装已验证「自定义插件索引」，其他扩展的兼容性按插件验证。

侧栏「后台任务」显示当前所有工作区正在执行和排队的 PI 任务。点击条目回到对应会话，可用输入框旁的停止按钮结束该轮。添加工作区会在应用内打开目录选择器。

用以下方式启动内置 PI 调度验收。构建命令会输出验收版 `Moos.app` 的路径。运行命令中的路径替换为该应用包里的可执行文件。

```sh
MOOS_ELECTRON_INCLUDE_PI_FIXTURE=1 npm --prefix apps/electron run prepare:local
MOOS_ELECTRON_PI_FIXTURE=1 MOOS_ELECTRON_DATA="$(mktemp -d)" "/path/to/Moos.app/Contents/MacOS/Moos"
```

验收模式默认选中「Moos PI · 本地调度验收」。可在默认工作区发送 `MOOS_FIXTURE_WRITE sample`，检查 `result.txt` 和对话中的工具结果。该模式只接受专用数据目录 `workspace` 下的项目和固定验收指令。PI 复用现有 Host 进程、SQLite 和 Moos 调度器。

PI 读取会话当前的「仅可查看」「工作区内修改」「完全权限」。在临时项目中发送 `MOOS_FIXTURE_POLICY` 可检查项目内写入及 Bash 越界行为。发送 `MOOS_FIXTURE_APPROVAL` 可在受限模式下测试一次性命令审批。受限命令由 macOS 沙箱执行，搜索通过受限 Bash 调用系统工具。
