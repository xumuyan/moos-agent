#!/bin/bash
# P03.13 会话恢复子项收尾验收脚本：先跑源码级回归，再跑分支跨重启 GUI 隔离验收与文档检查。
# 用法：bash artifacts/fork-recovery-restart/validate.sh <isolated-build-name> [skip-core]
umask 022
export HOME=/Users/xuguopeng TMPDIR=/private/tmp
export PATH=/Users/xuguopeng/.nvm/versions/node/v24.15.0/bin:/Users/xuguopeng/.cargo/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
for key in $(env | cut -d= -f1); do case "$key" in MOOS_ELECTRON_*|DSH_*|ELECTRON_RUN_AS_NODE|NODE_OPTIONS|NODE_PATH) unset "$key";; esac; done
cd '/Users/xuguopeng/Documents/徐郭鹏项目/徐-moos-agent' || exit 1
build="${1:?usage: validate.sh <build-name> [skip-core]}"
v=artifacts/fork-recovery-restart/final
mkdir -p "$v"
run() { "$@" > "$v/$name.log" 2>&1; result=$?; printf '%s\n' "$result" > "$v/$name.exit"; echo "$name: $result"; tail -6 "$v/$name.log"; }
if [ "$2" != "skip-core" ]; then
  name=core; run npm test
fi
export MOOS_ELECTRON_TEST_DSH_CLI="$PWD/.generated/moos-electron/$build/沐码.app/Contents/Resources/host-runtime/bin/dsh"
export MOOS_ELECTRON_TEST_SKIN_CENTER="$HOME/Library/Application Support/dev.moos.agent.electron/dsh/profiles/web/node_modules/@linxin666/dsh-client-ui-skin-center"
export MOOS_ELECTRON_TEST_REVIEWED_MAID="$HOME/Library/Application Support/dev.moos.agent.electron/dsh/skins/maid-atelier"
name=electron; run npm run test:electron
export CARGO_HOME=/Users/xuguopeng/.cargo RUST_TEST_THREADS=1 CARGO_NET_OFFLINE=true
name=native; run npm run test:desktop-native
name=bridge; run node --test probes/dsh-electron-pi/index.test.mjs
name=skin; run python3 -m unittest discover -s probes/dsh-electron-skin -v
name=gui; run node artifacts/fork-recovery-restart/gui.mjs ".generated/moos-electron/$build/沐码.app" "$v/gui"
name=docs; run env PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v
python3 - <<'PY'
import json,pathlib
p=pathlib.Path('artifacts/fork-recovery-restart/final')
names=['core','electron','native','bridge','skin','gui','docs']
r={n:int((p/(n+'.exit')).read_text()) for n in names if (p/(n+'.exit')).exists()}
(p/'validation.json').write_text(json.dumps(r,indent=2)+'\n')
print(r)
raise SystemExit(any(r.values()))
PY
