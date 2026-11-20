#!/bin/bash
# Local AppKit chat probe: pinned offline build, separate from the package size checker.
set -eu
probe=$(cd "$(dirname "$0")/.." && pwd -P)
upstream=$1
out=$2
cd "$upstream/source"
entry=crates/nsh-macos-app/src/main.rs
lock="$upstream/package-runner.lock"
mkdir "$lock"
[[ $(git hash-object "$entry") == 6ff10a0f8eacbd00c2bb13949155cacb07929e9b ]] || { rmdir "$lock"; exit 1; }
cp "$entry" "$lock/original.rs"
trap 'cp "$lock/original.rs" "$entry" && rm "$lock/original.rs" && rmdir "$lock"' EXIT
/usr/bin/patch -o "$out/package-main.rs" "$probe/appkit-hostcheck/main.rs" "$probe/appkit-hostcheck/package-main.patch"
/usr/bin/patch -o "$out/main.rs" "$out/package-main.rs" "$probe/appkit-hostcheck/chat-main.patch"
/usr/bin/sed 's/dev\.muma\.probe\.nsh\.appkit\.package\.check/dev.muma.probe.nsh.appkit.chat/' \
    "$probe/appkit-hostcheck/Package.swift" > "$out/ChatPackage.swift"
cat >> "$out/ChatPackage.swift" <<'SWIFT'

@_cdecl("n01_chat_is_check")
public func scriptedCheck() -> Bool {
    Bundle.main.object(forInfoDictionaryKey: "N01ScriptedCheck") as? Bool == true
}
SWIFT
/usr/bin/xcrun swiftc -swift-version 5 -Osize -D PI_PERSISTENT -parse-as-library -emit-library \
    -module-name N01AppKitPipe -framework AppKit -Xlinker -install_name -Xlinker @rpath/libN01AppKitPipe.dylib \
    "$probe/DesktopPipe.swift" "$probe/appkit-hostcheck/AppKitPipe.swift" "$out/ChatPackage.swift" \
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
