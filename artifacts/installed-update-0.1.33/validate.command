#!/bin/bash
umask 022
export HOME=/Users/xuguopeng
export TMPDIR=/private/tmp/
export npm_config_cache=/Users/xuguopeng/.npm
export PATH='/Users/xuguopeng/.rustup/toolchains/stable-aarch64-apple-darwin/bin:/Applications/Moos.app/Contents/Resources/host-runtime/dsh/node_modules/@vscode/ripgrep-darwin-arm64/bin:/Users/xuguopeng/.pi/agent/bin:/Users/xuguopeng/.nvm/versions/node/v24.15.0/bin:/usr/bin:/bin:/usr/sbin:/sbin'
export CARGO_HOME=/Users/xuguopeng/.cargo
cd '/Users/xuguopeng/Documents/徐郭鹏项目/徐-moos-agent' || exit 1
out=artifacts/installed-update-0.1.33/validation-final
npm test > "$out/core.log" 2>&1
core=$?
export MOOS_ELECTRON_TEST_DSH_CLI="$PWD/.generated/moos-electron/build-uy2KoB/Moos.app/Contents/Resources/host-runtime/bin/dsh"
export MOOS_ELECTRON_TEST_SKIN_CENTER=/private/tmp/moos-primary-migration.5a70IE/evidence/electron-data/dsh/profiles/web/node_modules/@linxin666/dsh-client-ui-skin-center
export MOOS_ELECTRON_TEST_REVIEWED_MAID=/private/tmp/moos-primary-migration.5a70IE/evidence/electron-data/dsh/skins/maid-atelier
npm run test:electron > "$out/electron.log" 2>&1
electron=$?
RUST_TEST_THREADS=1 npm run test:desktop-native > "$out/native.log" 2>&1
native=$?
node --test probes/dsh-electron-pi/index.test.mjs > "$out/bridge.log" 2>&1
bridge=$?
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s probes/dsh-electron-skin -v > "$out/skin.log" 2>&1
skin=$?
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v > "$out/docs.log" 2>&1
docs=$?
printf '{"core":%s,"electron":%s,"native":%s,"bridge":%s,"skin":%s,"docs":%s}\n' "$core" "$electron" "$native" "$bridge" "$skin" "$docs" > "$out/validation.json"
