#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use base64::Engine;
use std::{io::Read, path::Path, process::{Child, Command, Stdio}, sync::{Arc, Mutex}, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
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

#[derive(Default)]
struct RuntimeState { closing: bool, children: Vec<Arc<Mutex<Child>>> }
#[derive(Default)]
struct RuntimeControl(Mutex<RuntimeState>);
impl RuntimeControl {
    fn spawn(&self, command: &mut Command) -> Result<Arc<Mutex<Child>>, String> {
        let mut state = self.0.lock().map_err(|_| "runtime state unavailable")?;
        if state.closing { return Err("runtime is shutting down".into()); }
        let child = Arc::new(Mutex::new(command.spawn().map_err(|e| e.to_string())?));
        state.children.push(child.clone());
        Ok(child)
    }
    fn remove(&self, child: &Arc<Mutex<Child>>) {
        if let Ok(mut state) = self.0.lock() {
            state.children.retain(|registered| !Arc::ptr_eq(registered, child));
        }
    }
    fn shutdown(&self) {
        let children = {
            let mut state = self.0.lock().unwrap_or_else(|error| error.into_inner());
            state.closing = true;
            state.children.drain(..).collect::<Vec<_>>()
        };
        for child in children {
            let mut child = child.lock().unwrap_or_else(|error| error.into_inner());
            if matches!(child.try_wait(), Ok(Some(_))) { continue; }
            unsafe { libc::kill(child.id() as i32, libc::SIGTERM); }
            let started = Instant::now();
            loop {
                match child.try_wait() {
                    Ok(Some(_)) => { let _ = child.wait(); break; }
                    Ok(None) if started.elapsed() < Duration::from_secs(3) => {
                        std::thread::sleep(Duration::from_millis(25));
                    }
                    _ => { let _ = child.kill(); let _ = child.wait(); break; }
                }
            }
        }
    }
}

fn drain_pipe<T: Read + Send + 'static>(mut pipe: T) -> std::sync::mpsc::Receiver<Vec<u8>> {
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut output = Vec::new();
        let _ = pipe.read_to_end(&mut output);
        let _ = sender.send(output);
    });
    receiver
}

// Only fixed local probe entry points are exposed, never arbitrary shell arguments.
fn run_fixed(binary: &Path, args: &[&str], envs: &[(&str, &Path)], runtime: &RuntimeControl) -> Result<Json, String> {
    let mut command = Command::new(binary);
    command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    for (key, value) in envs { command.env(key, value); }
    let child = runtime.spawn(&mut command)?;
    let (stdout, stderr) = {
        let mut guard = child.lock().map_err(|_| "runtime child unavailable")?;
        (guard.stdout.take().ok_or("missing probe stdout")?, guard.stderr.take().ok_or("missing probe stderr")?)
    };
    let stdout = drain_pipe(stdout);
    let _stderr = drain_pipe(stderr);
    let started = Instant::now();
    let status = loop {
        let result = child.lock().map_err(|_| "runtime child unavailable")?.try_wait();
        match result {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < Duration::from_secs(45) => std::thread::sleep(Duration::from_millis(25)),
            Ok(None) => {
                let mut guard = child.lock().map_err(|_| "runtime child unavailable")?;
                let _ = guard.kill(); let _ = guard.wait();
                drop(guard);
                runtime.remove(&child);
                return Err("probe timeout".into());
            }
            Err(e) => {
                let mut guard = child.lock().map_err(|_| "runtime child unavailable")?;
                let _ = guard.kill(); let _ = guard.wait();
                drop(guard);
                runtime.remove(&child);
                return Err(e.to_string());
            }
        }
    };
    runtime.remove(&child);
    if !status.success() { return Err("本地验证失败，请检查权限及验证条件".into()); }
    let output = stdout.recv_timeout(Duration::from_secs(1)).map_err(|_| "probe output timeout")?;
    serde_json::from_slice(&output).map_err(|e| e.to_string())
}
fn native_path() -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(exe.parent().ok_or("missing binary directory")?.join("moos-native"))
}
fn probe(app: &tauri::AppHandle, runtime: &RuntimeControl) -> Result<Json, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let bin = exe.parent().ok_or("missing binary directory")?;
    let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
    let node = bin.join("node");
    let cli = resources.join("runtime/node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
    let script = resources.join("probe/pi-probe.mjs");
    let native = run_fixed(&native_path()?, &["permissions"], &[], runtime)?;
    let hold = std::env::args().find_map(|arg| arg.strip_prefix("--probe-hold-file=").map(std::path::PathBuf::from));
    let mut envs = vec![("MOOS_PROBE_NODE", node.as_path()), ("MOOS_PROBE_PI_CLI", cli.as_path())];
    if let Some(path) = hold.as_deref() { envs.push(("MOOS_PROBE_HOLD_FILE", path)); }
    let pi = run_fixed(&node, &[script.to_str().ok_or("invalid path")?], &envs, runtime)?;
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
async fn run_probe(app: tauri::AppHandle, runtime: tauri::State<'_, Arc<RuntimeControl>>) -> Result<Json, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || probe(&app, &runtime)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn desktop_permissions(runtime: tauri::State<'_, Arc<RuntimeControl>>) -> Result<Json, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || run_fixed(&native_path()?, &["permissions"], &[], &runtime))
        .await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn request_desktop_permission(kind: String, runtime: tauri::State<'_, Arc<RuntimeControl>>) -> Result<Json, String> {
    let mode = match kind.as_str() { "screen" => "request-screen", "accessibility" => "request-accessibility", _ => return Err("unknown permission".into()) };
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || run_fixed(&native_path()?, &[mode], &[], &runtime))
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
        .manage(Arc::new(RuntimeControl::default()))
        .invoke_handler(tauri::generate_handler![run_probe, desktop_permissions, request_desktop_permission, run_browser_probe, stop_browser_probe])
        .setup(|app| {
            let hold = std::env::args().find_map(|arg| arg.strip_prefix("--probe-hold-file=").map(String::from));
            let exit_after_hold = std::env::args().any(|arg| arg == "--probe-exit-after-hold");
            if exit_after_hold {
                if let Some(hold) = hold {
                    let handle = app.handle().clone();
                    std::thread::spawn(move || {
                        for _ in 0..600 {
                            if std::path::Path::new(&hold).exists() { handle.exit(0); return; }
                            std::thread::sleep(Duration::from_millis(25));
                        }
                        handle.exit(1);
                    });
                }
            }
            if let Some(output) = std::env::args().find_map(|arg| arg.strip_prefix("--probe-output=").map(String::from)) {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let runtime = handle.state::<Arc<RuntimeControl>>().inner().clone();
                    let result = probe(&handle, &runtime);
                    let status = if result.is_ok() { 0 } else { 1 };
                    let value = match result { Ok(value) => value, Err(error) => serde_json::json!({"error": error}) };
                    if std::fs::write(output, serde_json::to_vec_pretty(&value).unwrap()).is_err() { handle.exit(2); return; }
                    if !exit_after_hold { handle.exit(status); }
                });
            }
            Ok(())
        }).build(tauri::generate_context!()).expect("failed to launch M01 probe")
        .run(|handle, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit) {
                handle.state::<Arc<RuntimeControl>>().shutdown();
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
    #[test]
    fn runtime_shutdown_terminates_a_registered_child_with_sigterm() {
        use std::os::unix::process::ExitStatusExt;
        let runtime = RuntimeControl::default();
        let child = runtime.spawn(Command::new("/bin/sleep").arg("20")).unwrap();
        runtime.shutdown();
        let status = child.lock().unwrap().try_wait().unwrap().expect("registered child must be reaped");
        assert_eq!(status.signal(), Some(15));
    }
    #[test]
    fn runtime_shutdown_rejects_new_children() {
        let runtime = RuntimeControl::default();
        runtime.shutdown();
        let result = runtime.spawn(Command::new("/bin/sleep").arg("20"));
        assert!(result.is_err());
    }
    #[test]
    fn runtime_shutdown_interrupts_a_running_fixed_process() {
        let runtime = Arc::new(RuntimeControl::default());
        let worker = std::thread::spawn({
            let runtime = runtime.clone();
            move || run_fixed(Path::new("/bin/sleep"), &["20"], &[], &runtime)
        });
        let registered = (0..100).any(|_| {
            if !runtime.0.lock().unwrap().children.is_empty() { return true; }
            std::thread::sleep(Duration::from_millis(10));
            false
        });
        assert!(registered, "fixed process must be registered before shutdown");
        runtime.shutdown();
        assert!(worker.join().unwrap().is_err());
    }
    #[test]
    fn completed_fixed_process_is_unregistered() {
        let runtime = RuntimeControl::default();
        let result = run_fixed(Path::new("/usr/bin/printf"), &["{}"], &[], &runtime).unwrap();
        assert_eq!(result, serde_json::json!({}));
        assert!(runtime.0.lock().unwrap().children.is_empty());
    }
    #[test]
    fn runtime_shutdown_escalates_a_sigterm_ignoring_child() {
        use std::{io::BufRead, os::unix::process::ExitStatusExt};
        let runtime = RuntimeControl::default();
        let child = runtime.spawn(Command::new("/bin/sh").arg("-c")
            .arg("trap '' TERM; printf 'ready\\n'; while :; do :; done")
            .stdout(Stdio::piped())).unwrap();
        let stdout = child.lock().unwrap().stdout.take().unwrap();
        let mut ready = String::new();
        std::io::BufReader::new(stdout).read_line(&mut ready).unwrap();
        assert_eq!(ready, "ready\n");
        runtime.shutdown();
        let status = child.lock().unwrap().try_wait().unwrap().expect("stubborn child must be reaped");
        assert_eq!(status.signal(), Some(9));
    }
    #[test]
    fn fixed_process_drains_large_stderr_before_exit() {
        let runtime = RuntimeControl::default();
        let result = run_fixed(Path::new("/usr/bin/python3"), &["-c",
            "import os; [os.write(2, b'x' * 4096) for _ in range(32)]; print('{}', flush=True)"],
            &[], &runtime).unwrap();
        assert_eq!(result, serde_json::json!({}));
    }
    #[test]
    fn fixed_process_rejects_output_held_open_by_a_descendant() {
        let runtime = RuntimeControl::default();
        let started = Instant::now();
        let result = run_fixed(Path::new("/bin/sh"), &["-c", "sleep 2 & printf '{}'; exit 0"],
            &[], &runtime);
        assert!(result.is_err());
        assert!(started.elapsed() < Duration::from_secs(3));
    }
    #[test]
    fn runtime_shutdown_preserves_an_unrelated_process() {
        let runtime = RuntimeControl::default();
        let child = runtime.spawn(Command::new("/bin/sleep").arg("20")).unwrap();
        let mut unrelated = Command::new("/bin/sleep").arg("20").spawn().unwrap();
        runtime.shutdown();
        let managed_status = child.lock().unwrap().try_wait().unwrap();
        let unrelated_status = unrelated.try_wait().unwrap();
        let _ = unrelated.kill(); let _ = unrelated.wait();
        assert!(managed_status.is_some());
        assert!(unrelated_status.is_none());
    }
}
