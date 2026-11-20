# NSH 桌面候选：独立双模型（N01-D2）

- 使用正式沐码同一 PI SDK 执行入口。模型选择器默认 **GLM Coding Plan**，也可手动选择 **OpenAI 兼容中转**；每个任务固定一路，不同时请求两家、不自动切换或重放。改选模型后，同一会话的测试历史会作为上下文发往新选服务。这不是跨重启的历史恢复。
- 允许 `openai-responses` / `openai-completions`，基础 URL 必须为 HTTPS，不含账户信息、查询、片段或 API 方法后缀。GLM Responses 有独立的关／低／高／最高档，默认低；OpenAI 兼容中转不猜测模型的推理档位。图片输入、模型发现、套餐额度和外部工具兼容性不由协议名推断。
- 独立 bundle ID `dev.muma.probe.nsh.piui.live`；只使用临时测试项目、数据库和 PI 会话。关闭 Host 且收尾完成后清理临时数据。仍是开发检出＋本机 Node 的 ad-hoc 候选，不是签名分发包，也不是正式沐码整套数据迁移方案。
- 现有六方法不变。目录只返回展示名称、固定选择 ID 和已暴露推理选项；不返回 URL 或密钥，不支持前端写配置。Node 通过既有回环代理向选中的 HTTPS 服务发请求；PI 得到代理的临时令牌，不接收上游密钥，模型工具不继承密钥。错误只显示现有规范化码，不转发上游错误正文。原有工作区权限层生效，不承诺应用级沙箱；仅在测试项目中使用。

## 首次配置（本机操作）

本机已按用户要求做过一次只读复制：仅取正式版两家连接各自的首个模型和匹配端点的凭据，候选写入独立目录，正式文件保持原样。不需要在设置里再填；这不是自动导入或同步，正式版日后换密钥不会更新候选。以下是其他检出目录或需要手工重新配置时的步骤。

在开发仓库根目录下，新建 `artifacts/nsh-validation/private-models/`（`0700`）。将 [配置样例](desktop-live-providers.example.json) 复制为其中的 `providers.json`（`0600`），填入各自套餐允许的模型 ID、端点/协议、上下文和输出限制。样例中的 GLM `https://open.bigmodel.cn/api/v1` 搭配 Responses；样例限制仅用于配置起步，不是能力实测值。中转地址和模型必须替换为自己的，不要填写附带密钥的 URL。

在同目录使用本机编辑器创建 `credentials.json`（`0600`，例如先运行 `(umask 077; touch artifacts/nsh-validation/private-models/credentials.json)`），对象格式如下：

```json
{
  "glm-coding": "在本机填写 GLM Coding Plan 的密钥",
  "openai-relay": "在本机填写 OpenAI 兼容中转的密钥"
}
```

不要把真实密钥填在聊天、终端命令参数、Git、构建脚本或日志中。两个 JSON 都在 Git 忽略目录；候选 Host 运行时不访问正式配置或系统钥匙串，也不会自动复制正式凭据。文件必须属于本机用户，必须为普通单链接文件；不允许把配置目录或文件指向正式数据。配置缺失或权限不对时不会静默回退到夹具；改配置后要重启**候选**，不要重启正式沐码。

```sh
# 启动隔离候选，用本机 Node 24.15.0 和既有 NSH/Xcode 工具链
node probes/nsh-validation/verify-desktop-pi.mjs --interactive --live-models
# 无凭据、无网络请求、只构建并查验签名与产物：
node probes/nsh-validation/verify-desktop-pi.mjs --build-only --live-models
```

候选启动不探测外部模型。交互点击「发送」后，选中服务会收到测试提示和该会话上下文，可能产生费用。先用两家各一个独立测试会话，验证流式文本 → 读写测试文件 → 跑测试 → 停止活动请求 → 排空后再发。再做一轮明确允许传输的合成上下文跨模型切换。不要使用正式聊天或项目作首次验收。

## 证据边界

`node --test --test-concurrency=1 probes/nsh-validation/desktop-live-models.test.mjs` 用合成密钥和本地模拟服务验证真实 PI SDK、双协议、同会话换服务、文件写入、停止/再发、认证失败和密钥不出现在 RPC。`--build-only --live-models` 仅验证普通双模型候选能构建和本机签名；原脚本 UI 验收仍使用本地夹具。

2026-11-20 用户授权的[真实上游后端验收](desktop-real-models-evidence.json)直接启动固定 `desktop-live-stdio.mjs`。在两个隔离项目和会话里，GLM 用默认选择，中转显式选择；两家均取得预期文本、观察到成功的 `read` / `edit` / `bash` 公开事件且核对最终文件内容，在收到活动流文本后取消并排空，随后同会话再发成功。Host EOF 正常退出并清理临时状态。只保留脱敏指标，不记录回复正文、服务地址或密钥。

这是后端验收，不是候选窗口的模型菜单或停止按钮实测。没有验证真实服务间同会话切换、上游侧是否停算、跨重启恢复、正式历史/项目迁移或性能对比。没有正式数据访问或变更、安装、部署和手机工作。
