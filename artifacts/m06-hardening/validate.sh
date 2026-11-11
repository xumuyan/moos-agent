#!/bin/bash
umask 022
export HOME=/Users/xuguopeng TMPDIR=/private/tmp
export PATH=/Users/xuguopeng/.rustup/toolchains/stable-aarch64-apple-darwin/bin:/Users/xuguopeng/.nvm/versions/node/v24.15.0/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
for key in $(env | cut -d= -f1); do case "$key" in MOOS_ELECTRON_*|DSH_*|ELECTRON_RUN_AS_NODE|NODE_OPTIONS|NODE_PATH) unset "$key";; esac; done
cd '/Users/xuguopeng/Documents/徐郭鹏项目/徐-moos-agent' || exit 1
v=artifacts/m06-hardening/final
mkdir -p "$v"
run() { "$@" > "$v/$name.log" 2>&1; result=$?; printf '%s\n' "$result" > "$v/$name.exit"; echo "$name: $result"; tail -9 "$v/$name.log"; }
name=core; run npm test
export MOOS_ELECTRON_TEST_DSH_CLI="$PWD/.generated/moos-electron/build-2RiRgR/沐码.app/Contents/Resources/host-runtime/bin/dsh"
export MOOS_ELECTRON_TEST_SKIN_CENTER="$HOME/Library/Application Support/dev.moos.agent.electron/dsh/profiles/web/node_modules/@linxin666/dsh-client-ui-skin-center"
export MOOS_ELECTRON_TEST_REVIEWED_MAID="$HOME/Library/Application Support/dev.moos.agent.electron/dsh/skins/maid-atelier"
name=electron; run npm run test:electron
export CARGO_HOME=/Users/xuguopeng/.cargo RUST_TEST_THREADS=1 CARGO_NET_OFFLINE=true
name=native; run npm run test:desktop-native
name=bridge; run node --test probes/dsh-electron-pi/index.test.mjs
name=skin; run python3 -m unittest discover -s probes/dsh-electron-skin -v
name=gui; run node scripts/verify-electron-brand.mjs '.generated/moos-electron/build-2RiRgR/沐码.app' "$v/gui"
python3 - <<'PY'
import json,pathlib
p=pathlib.Path('artifacts/m06-hardening/final')
r={n:int((p/(n+'.exit')).read_text()) for n in ['core','electron','native','bridge','skin','gui']}
(p/'validation.json').write_text(json.dumps(r,indent=2)+'\n')
print(r)
raise SystemExit(any(r.values()))
PY
