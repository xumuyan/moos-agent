# DSH Electron 皮肤独立验证

用已经安装的 **DeepSeek Harness Desktop 0.2.2-rc.1** 运行原版 Electron、DSH 前端与 Host，通过 DSH 自己的插件命令安装 **皮肤中心 0.4.5**。正式 Moos 的 Tauri 应用、插件目录和 PI 不参与这次验证。此探针没有另行打包 Electron。

1. 准备[固定上游源码里的深海女仆工坊 0.3.2](https://github.com/yudukongchen/dsh-client-ui-skin-center/tree/85047d9cacb375f20bc8fabee4b3829fdfe47128/skins/maid-atelier)的原目录 ZIP。可以从现有的上游 Git 副本导出；既支持 ZIP 根目录是皮肤内容，也支持带一层 `maid-atelier/`。25 个文件必须与固定版本字节一致，不需要转换：

   ```sh
   git -C /path/to/dsh-client-ui-skin-center archive --format=zip \
     --output=/tmp/maid-atelier-original.zip \
     85047d9cacb375f20bc8fabee4b3829fdfe47128:skins/maid-atelier
   ```

2. 从 Moos 仓库根目录初始化。等原版窗口打开后按 `⌘Q`，让 DSH 完成退出并释放插件目录锁：

   ```sh
   python3 probes/dsh-electron-skin/probe.py init
   ```

3. 安装并打开。已有已初始化的独立配置可直接用最后一条命令打开：

   ```sh
   python3 probes/dsh-electron-skin/probe.py install /tmp/maid-atelier-original.zip
   python3 probes/dsh-electron-skin/probe.py open
   ```

4. 若原版 DSH 显示首次启动引导，按原版流程进入工作区。进入 **账号菜单 → 设置 → 皮肤 → Abyssal Maid Atelier**，选择「试穿」或「应用」。应用后退出重开可复查持久化。

独立配置位于 Git 忽略的 `.generated/dsh-electron-skin/`，含 DSH_HOME、Electron userData 和本次启动目录。它是应用配置隔离，不是操作系统沙箱；此探针只用于观察皮肤，不需要提交对话任务。DSH Host 仍以后台子进程运行。版本匹配时，皮肤中心使用[上游的脚本信任校验](https://github.com/yudukongchen/dsh-client-ui-skin-center/blob/85047d9cacb375f20bc8fabee4b3829fdfe47128/contracts/README.md)。本验证版不添加信任项、不修改原包，亦不分发带第三方美术资源的安装包。素材许可见原包 LICENSE、NOTICE。
