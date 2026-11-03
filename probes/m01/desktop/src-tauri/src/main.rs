#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{path::Path, process::{Command, Stdio}, time::{Duration, Instant}};
use tauri::Manager;

// This M01 binary exposes only fixed offline probes, never arbitrary shell arguments.
fn run_fixed(binary: &Path, args: &[&str], envs: &[(&str, &Path)]) -> Result<serde_json::Value, String> {
    let mut command = Command::new(binary);
    command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    for (key, value) in envs { command.env(key, value); }
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < Duration::from_secs(45) => std::thread::sleep(Duration::from_millis(25)),
            Ok(None) => { let _ = child.kill(); let _ = child.wait(); return Err("probe timeout".into()); }
            Err(e) => { let _ = child.kill(); let _ = child.wait(); return Err(e.to_string()); }
        }
    }
    let result = child.wait_with_output().map_err(|e| e.to_string())?;
    if !result.status.success() { return Err(String::from_utf8_lossy(&result.stderr).trim().to_string()); }
    serde_json::from_slice(&result.stdout).map_err(|e| e.to_string())
}

fn probe(app: &tauri::AppHandle) -> Result<serde_json::Value, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let bin = exe.parent().ok_or("missing binary directory")?;
    let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
    let node = bin.join("node");
    let cli = resources.join("runtime/node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
    let script = resources.join("probe/pi-probe.mjs");
    let native = run_fixed(&bin.join("moos-native"), &["permissions"], &[])?;
    let pi = run_fixed(&node, &[script.to_str().ok_or("invalid path")?],
        &[("MOOS_PROBE_NODE", node.as_path()), ("MOOS_PROBE_PI_CLI", cli.as_path())])?;
    Ok(serde_json::json!({"pi": pi, "native": native, "packagedRuntime": true}))
}

#[tauri::command]
async fn run_probe(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || probe(&app)).await.map_err(|e| e.to_string())?
}

fn main() {
    tauri::Builder::default().invoke_handler(tauri::generate_handler![run_probe])
        .setup(|app| {
            // A deterministic entry point for verifying the actual .app distribution.
            if let Some(output) = std::env::args().find_map(|arg| arg.strip_prefix("--probe-output=").map(String::from)) {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let result = probe(&handle);
                    let status = if result.is_ok() { 0 } else { 1 };
                    let value = match result { Ok(value) => value, Err(error) => serde_json::json!({"error": error}) };
                    if std::fs::write(output, serde_json::to_vec_pretty(&value).unwrap()).is_err() { handle.exit(2); return; }
                    handle.exit(status);
                });
            }
            Ok(())
        }).run(tauri::generate_context!()).expect("failed to launch M01 probe");
}
