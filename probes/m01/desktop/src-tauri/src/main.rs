#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use base64::Engine;
use std::{path::Path, process::{Child, Command, Stdio}, sync::{Arc, Mutex}, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
use tauri::Manager;

type Json = serde_json::Value;
#[derive(Default)]
struct BrowserJob { child: Option<Child>, running: bool, cancelled: bool }
#[derive(Default)]
struct BrowserControl(Mutex<BrowserJob>);
impl BrowserControl {
    fn reserve(&self) -> Result<(), String> {
        let mut job = self.0.lock().map_err(|_| "browser state unavailable")?;
        if job.running { return Err("浏览器验证已在运行".into()); }
        job.running = true; job.cancelled = false; Ok(())
    }
    fn cancel(&self) -> Result<bool, String> {
        let mut job = self.0.lock().map_err(|_| "browser state unavailable")?;
        if !job.running { return Ok(false); }
        job.cancelled = true;
        if let Some(child) = job.child.as_mut() { child.kill().map_err(|e| e.to_string())?; }
        Ok(true)
    }
}

// Only fixed local probe entry points are exposed, never arbitrary shell arguments.
fn run_fixed(binary: &Path, args: &[&str], envs: &[(&str, &Path)]) -> Result<Json, String> {
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
    if !result.status.success() { return Err("本地验证失败，请检查权限及验证条件".into()); }
    serde_json::from_slice(&result.stdout).map_err(|e| e.to_string())
}
fn native_path() -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(exe.parent().ok_or("missing binary directory")?.join("moos-native"))
}
fn probe(app: &tauri::AppHandle) -> Result<Json, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let bin = exe.parent().ok_or("missing binary directory")?;
    let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
    let node = bin.join("node");
    let cli = resources.join("runtime/node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
    let script = resources.join("probe/pi-probe.mjs");
    let native = run_fixed(&native_path()?, &["permissions"], &[])?;
    let pi = run_fixed(&node, &[script.to_str().ok_or("invalid path")?],
        &[("MOOS_PROBE_NODE", node.as_path()), ("MOOS_PROBE_PI_CLI", cli.as_path())])?;
    Ok(serde_json::json!({"pi": pi, "native": native, "packagedRuntime": true}))
}
fn browser_child(binary: &Path, args: &[&str], control: &BrowserControl) -> Result<Json, String> {
    {
        let mut job = control.0.lock().map_err(|_| "browser state unavailable")?;
        if job.cancelled { return Ok(serde_json::json!({"status":"cancelled"})); }
        job.child = Some(Command::new(binary).args(args).stdin(Stdio::null())
            .stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|e| e.to_string())?);
    }
    let started = Instant::now();
    loop {
        {
            let mut job = control.0.lock().map_err(|_| "browser state unavailable")?;
            let child = job.child.as_mut().ok_or("browser process unavailable")?;
            if child.try_wait().map_err(|e| e.to_string())?.is_some() {
                let child = job.child.take().unwrap();
                let cancelled = job.cancelled;
                drop(job);
                let output = child.wait_with_output().map_err(|e| e.to_string())?;
                if cancelled { return Ok(serde_json::json!({"status":"cancelled"})); }
                return serde_json::from_slice(&output.stdout).map_err(|_| "浏览器验证未返回有效结果".into());
            }
            if started.elapsed() >= Duration::from_secs(30) {
                let _ = child.kill(); let _ = child.wait(); job.child = None;
                return Ok(serde_json::json!({"status":"failed", "reason":"browser-process-timeout"}));
            }
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}
fn browser_probe(app: &tauri::AppHandle, control: &BrowserControl) -> Result<Json, String> {
    let id = format!("MOOS_M01_BROWSER_{}_{}", SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?.as_nanos(), std::process::id());
    let folder = app.path().app_data_dir().map_err(|e| e.to_string())?.join("browser-probes").join(&id);
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let fixture = folder.join("index.html");
    std::fs::write(&fixture, format!("<!doctype html><html><meta charset=utf-8><title>{id}</title><body style='font:24px system-ui;padding:48px;background:#f3f7ff;color:#16325c'><h1>Moos 浏览器验证成功</h1><p>这是本次操作专用的本地测试页面。</p><p>已通过键盘输入地址并访问页面。</p><small>{id}</small></body></html>"))
        .map_err(|e| e.to_string())?;
    let url = tauri::Url::from_file_path(&fixture).map_err(|_| "invalid fixture URL")?;
    let screenshot = folder.join("browser.png");
    let mut report = browser_child(&native_path()?, &["browser-probe", url.as_str(), &id,
        screenshot.to_str().ok_or("invalid screenshot path")?], control)?;
    report["launchContext"] = serde_json::json!("GUI application command");
    std::fs::write(folder.join("report.json"), serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if report["status"] == "passed" {
        let png = std::fs::read(&screenshot).map_err(|e| e.to_string())?;
        report["imageDataUrl"] = serde_json::json!(format!("data:image/png;base64,{}", base64::prelude::BASE64_STANDARD.encode(png)));
        report["screenshotPath"] = serde_json::json!(screenshot.to_string_lossy());
    }
    Ok(report)
}
#[tauri::command]
async fn run_probe(app: tauri::AppHandle) -> Result<Json, String> {
    tauri::async_runtime::spawn_blocking(move || probe(&app)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn desktop_permissions() -> Result<Json, String> {
    tauri::async_runtime::spawn_blocking(|| run_fixed(&native_path()?, &["permissions"], &[]))
        .await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn request_desktop_permission(kind: String) -> Result<Json, String> {
    let mode = match kind.as_str() { "screen" => "request-screen", "accessibility" => "request-accessibility", _ => return Err("unknown permission".into()) };
    tauri::async_runtime::spawn_blocking(move || run_fixed(&native_path()?, &[mode], &[]))
        .await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn run_browser_probe(app: tauri::AppHandle, state: tauri::State<'_, Arc<BrowserControl>>) -> Result<Json, String> {
    state.reserve()?;
    let control = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = browser_probe(&app, &control);
        if let Ok(mut job) = control.0.lock() {
            if let Some(mut child) = job.child.take() { let _ = child.kill(); let _ = child.wait(); }
            job.running = false;
        }
        result
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
fn stop_browser_probe(state: tauri::State<'_, Arc<BrowserControl>>) -> Result<bool, String> { state.cancel() }
fn main() {
    tauri::Builder::default().manage(Arc::new(BrowserControl::default()))
        .invoke_handler(tauri::generate_handler![run_probe, desktop_permissions, request_desktop_permission, run_browser_probe, stop_browser_probe])
        .setup(|app| {
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
        }).build(tauri::generate_context!()).expect("failed to launch M01 probe")
        .run(|handle, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit) {
                let control = handle.state::<Arc<BrowserControl>>();
                let _ = control.cancel();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn duplicate_browser_jobs_are_rejected_and_early_cancel_is_preserved() {
        let control = BrowserControl::default();
        control.reserve().unwrap();
        assert!(control.reserve().is_err());
        assert!(control.cancel().unwrap());
        let result = browser_child(Path::new("/does/not/exist"), &[], &control).unwrap();
        assert_eq!(result["status"], "cancelled");
    }
    #[test]
    fn cancellation_kills_only_the_owned_child() {
        let control = BrowserControl::default();
        control.reserve().unwrap();
        let mut other = Command::new("/bin/sleep").arg("0.1").spawn().unwrap();
        control.0.lock().unwrap().child = Some(Command::new("/bin/sleep").arg("20").spawn().unwrap());
        assert!(control.cancel().unwrap());
        let mut owned = control.0.lock().unwrap().child.take().unwrap();
        assert!(!owned.wait().unwrap().success());
        assert!(other.wait().unwrap().success());
    }
    #[test]
    fn idle_cancel_has_no_effect() { assert!(!BrowserControl::default().cancel().unwrap()); }
}
