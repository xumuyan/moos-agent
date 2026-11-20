#!/bin/bash
# Reuse the verified, ignored upstream checkout and release cache. No downloads.
set -eu
probe=$(cd "$(dirname "$0")/.." && pwd -P)
upstream=$1
out=$2
cd "$upstream/source"
entry=crates/nsh-macos-app/src/main.rs
[[ $(git hash-object "$entry") == 6ff10a0f8eacbd00c2bb13949155cacb07929e9b ]]
lock="$upstream/package-runner.lock"
mkdir "$lock" # refuse another builder; retain lock if interrupted before restoration
trap 'cp "$lock/original.rs" "$entry" && rm "$lock/original.rs" && rmdir "$lock"' EXIT
cp "$entry" "$lock/original.rs"
/usr/bin/patch -o "$out/main.rs" "$probe/appkit-hostcheck/main.rs" "$probe/appkit-hostcheck/package-main.patch"
/usr/bin/xcrun swiftc -swift-version 5 -Osize -D PI_PERSISTENT -parse-as-library -emit-library \
    -module-name N01AppKitPipe -framework AppKit -Xlinker -install_name -Xlinker @rpath/libN01AppKitPipe.dylib \
    "$probe/DesktopPipe.swift" "$probe/appkit-hostcheck/AppKitPipe.swift" "$probe/appkit-hostcheck/Package.swift" \
    -o "$out/libN01AppKitPipe.dylib"
cp "$out/main.rs" "$entry"
export PATH="$HOME/.cargo/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export CARGO_TARGET_DIR="$upstream/target-stock"
export CARGO_NET_OFFLINE=true
cargo +1.100.0 --config 'source.crates-io.replace-with="n01-mirror"' \
    --config 'source.n01-mirror.registry="sparse+https://rsproxy.cn/index/"' \
    rustc --locked --offline --release --package nsh-macos-app --bin nsh-macos-app --no-default-features --features js \
    -- -L "native=$out" -l dylib=N01AppKitPipe -C 'link-arg=-Wl,-rpath,@executable_path'
cp "$CARGO_TARGET_DIR/release/nsh-macos-app" "$out/AppKitPI"
