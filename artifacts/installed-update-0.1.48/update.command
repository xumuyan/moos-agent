#!/bin/bash
# 独立更新启动器：由 Terminal 执行；更新脚本以 nohup 后台进程运行，
# 终端窗口可关闭，脚本不依赖任何 Moos/Host 进程（祖先链脱离沐码）。
LOG=/Applications/.moos-update-0.1.48/update.log
NODE=/Users/xuguopeng/.nvm/versions/node/v24.15.0/bin/node
cd /Applications/.moos-update-0.1.48 || exit 1
nohup "$NODE" update.mjs >> "$LOG" 2>&1 &
PID=$!
disown
echo "update started pid=$PID log=$LOG"
