# 0.1.48 安装检查点（最终状态，2026-11-13 09:05）

- 授权：用户在对话中明确说「安装吧」（本轮对话 f4fc7f43，徐-moos-agent 项目）。
- 结果：**安装成功（经复核脚本确认）**。/Applications/沐码.app = 0.1.48 (build-6C9P2R)，单实例运行，
  Host 子进程正常。23 项核对全部通过（result-verify.json, state=success）。
- 数据保全：providers.json/credentials.json 字节一致；784→789 消息、414→418 任务（旧行全部保留，
  新增为安装后的正常新消息）；pi/sessions 44 个历史文件纯追加；agent/models.json 为运行时模型缓存
  （本地中转站端口 60979→58123 刷新，模型定义一致，非聊天数据）；皮肤/工作区/插件依赖保留；6 模型凭证可读。
- 过程（三次脚本执行）：
  1. 第 1 次 stopped-for-review：0.1.47 遗留的 quit 前 activeTasks 防线拦截（安装器自身即运行中任务）。
     未换包，应用未动。
  2. 第 2 次 stopped-for-review（07:55）：换包完成、启动成功、全部真实断言为 True，但脚本最终 gate 的
     every 数组引用了改名前的字段 record.unchangedFilesMatchE126BaselineInInstalled（undefined）→ 误报
     "Data preservation verification did not fully pass"。包已是 0.1.48，应用运行中。
  3. 复核（verify-installed.mjs，只读）：重跑全部安装后断言 + 数据保全核对 → success。期间修复复核脚本
     自身两个 bug（ps ENOBUFS、mainPids 缺 split）。result-verify.json 为最终判定依据。
- 备份清理：data-before-install 与 previous/ 按规则于成功核对后删除（新版已确认聊天与配置可读，
  用户实际使用中：徐-moss-hotal / 沐-UI / codex-weixin-notifier 三项目任务并行正常）。
- 已知限制：
  - bfa1489f（codex-weixin-notifier, 08:45）internal 失败无底层异常持久化记录（host 日志不落盘，0.1.47
    同限制）；该会话升级前已有 internal/rate_limit 失败史，升级后同会话已有 2 个 succeeded 任务，
    判定与本次升级无关。底层失败原因持久化列为后续改进项。
  - P03.13.20 预压缩分类修复的真实上下文场景需待生产自然触发后确认；本轮确认修复代码已随 0.1.48
    安装生效（字节一致 + marker 核对）。
- 脚本修正已同步：update.mjs（数组变量名 + quit 防线两处）。
