fn main() {
    #[cfg(feature = "desktop")]
    {
        use std::{env, fs, path::PathBuf};
        let manifest = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap());
        let root = manifest.join("../../..");
        let target = env::var("TARGET").unwrap();
        let source = [
            root.join(".generated/runtime/node"),
            root.join(".generated/runtime/bin/node"),
            root.join(format!(
                "probes/m01/desktop/src-tauri/binaries/node-{target}"
            )),
            PathBuf::from("/opt/homebrew/bin/node"),
            PathBuf::from("/usr/local/bin/node"),
        ]
        .into_iter()
        .find(|path| path.is_file())
        .expect("Node missing: run the existing prepare-runtime script before building Moos");
        println!("cargo:rerun-if-changed={}", source.display());
        fs::create_dir_all(manifest.join("binaries")).expect("create local binaries directory");
        fs::copy(&source, manifest.join(format!("binaries/node-{target}")))
            .expect("copy bundled Node runtime");
        tauri_build::build();
    }
}
