#![cfg(target_os = "macos")]
use moos_desktop::pty::{TerminalManager, WorkspaceLocks};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    path::PathBuf,
    process::Command,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
struct Locks {
    root: PathBuf,
    leased: Mutex<HashSet<String>>,
}
impl WorkspaceLocks for Locks {
    fn acquire(&self, project: &str, id: &str) -> Result<PathBuf, String> {
        if !["a", "b"].contains(&project) {
            return Err("Unknown project".into());
        }
        self.leased.lock().unwrap().insert(id.into());
        Ok(self.root.clone())
    }
    fn release(&self, id: &str) {
        self.leased.lock().unwrap().remove(id);
    }
}
fn setup() -> (tempfile::TempDir, Arc<Locks>, TerminalManager) {
    let root = tempfile::tempdir().unwrap();
    let locks = Arc::new(Locks {
        root: root.path().canonicalize().unwrap(),
        leased: Mutex::new(HashSet::new()),
    });
    let manager = TerminalManager::new(
        locks.clone(),
        std::env::var_os("MOOS_PTY_GUARDIAN_TEST_BINARY")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::path::PathBuf::from(env!("CARGO_BIN_EXE_moos-desktop"))),
    );
    (root, locks, manager)
}
fn params(s: &Value) -> Value {
    json!({"projectId":s["projectId"],"sessionId":s["id"]})
}
fn write(m: &TerminalManager, s: &Value, data: &str) {
    let mut p = params(s);
    p["data"] = json!(data);
    m.request("write", p).unwrap();
}
fn wait_output(m: &TerminalManager, s: &Value, needle: &str) -> String {
    let until = Instant::now() + Duration::from_secs(5);
    let mut after = 0;
    let mut text = Vec::new();
    loop {
        let mut p = params(s);
        p["after"] = json!(after);
        let page = m.request("read", p).unwrap();
        after = page["nextAfter"].as_u64().unwrap();
        text.extend(
            page["data"]
                .as_array()
                .unwrap()
                .iter()
                .map(|b| b.as_u64().unwrap() as u8),
        );
        let view = String::from_utf8_lossy(&text);
        if view.contains(needle) {
            return view.into_owned();
        }
        assert!(Instant::now() < until, "expected terminal marker missing");
        thread::sleep(Duration::from_millis(20));
    }
}
fn alive(pid: u32) -> bool {
    unsafe { libc::kill(pid as i32, 0) == 0 }
}
#[test]
fn real_pty_supports_input_resize_utf8_exit_and_clean_environment() {
    let (_root, locks, m) = setup();
    std::env::set_var("MOOS_PTY_TEST_SECRET", "must-not-inherit");
    let s = m.request("open", json!({"projectId":"a"})).unwrap();
    std::env::remove_var("MOOS_PTY_TEST_SECRET");
    write(&m, &s, "stty -echo\r");
    thread::sleep(Duration::from_millis(100));
    let mut p = params(&s);
    p["rows"] = json!(33);
    p["cols"] = json!(92);
    m.request("resize", p).unwrap();
    write(&m,&s,"test -t 0 && printf '\\nREAL_TTY\\n'; pwd; stty size; print -r -- ${MOOS_PTY_TEST_SECRET-unset}; printf '中文完成\\n'; exit 7\r");
    let out = wait_output(&m, &s, "中文完成\r\n");
    assert!(out.contains("REAL_TTY\r\n"));
    assert!(out.contains(locks.root.to_str().unwrap()));
    assert!(out.contains("33 92"));
    assert!(out.contains("unset\r\n"));
    assert!(!out.contains("must-not-inherit"));
    let until = Instant::now() + Duration::from_secs(3);
    loop {
        let list = m.request("list", json!({"projectId":"a"})).unwrap();
        if list[0]["ended"] == true {
            assert_eq!(list[0]["exitCode"], 7);
            break;
        }
        assert!(Instant::now() < until);
        thread::sleep(Duration::from_millis(20));
    }
    assert!(locks.leased.lock().unwrap().is_empty());
}
#[test]
fn isolates_tabs_bounds_payloads_and_preserves_unrelated_processes() {
    let (_root, locks, m) = setup();
    let a = m.request("open", json!({"projectId":"a"})).unwrap();
    let b = m.request("open", json!({"projectId":"b"})).unwrap();
    let mut foreign = params(&a);
    foreign["projectId"] = json!("b");
    foreign["after"] = json!(0);
    assert!(m.request("read", foreign).is_err());
    let mut oversized = params(&a);
    oversized["data"] = json!("x".repeat(4097));
    assert!(m.request("write", oversized).is_err());
    for invalid in [json!(-1), json!(1.5), json!("80")] {
        let mut bad = params(&a);
        bad["cols"] = invalid;
        assert!(m.request("resize", bad).is_err());
    }
    let mut invalid = params(&a);
    invalid["cols"] = json!(501);
    assert!(m.request("resize", invalid).is_err());
    write(&m, &a, "stty -echo\r");
    thread::sleep(Duration::from_millis(100));
    write(&m, &a, "sleep 30\r");
    thread::sleep(Duration::from_millis(100));
    m.request("interrupt", params(&a)).unwrap();
    write(&m, &a, "printf '\\nINTERRUPT_OK\\n'\r");
    wait_output(&m, &a, "INTERRUPT_OK\r\n");
    let pid_file = locks.root.join("owned-child.pid");
    write(
        &m,
        &a,
        &format!(
            "sleep 30 & print -r -- $! > '{}'; wait\r",
            pid_file.display()
        ),
    );
    let until = Instant::now() + Duration::from_secs(2);
    while !pid_file.exists() {
        assert!(Instant::now() < until);
        thread::sleep(Duration::from_millis(20));
    }
    let descendant: u32 = std::fs::read_to_string(&pid_file)
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    let mut unrelated = Command::new("/bin/sleep").arg("30").spawn().unwrap();
    m.close_project(Some("a")).unwrap();
    assert!(!alive(a["pid"].as_u64().unwrap() as u32));
    assert!(alive(b["pid"].as_u64().unwrap() as u32));
    assert!(unrelated.try_wait().unwrap().is_none());
    let until = Instant::now() + Duration::from_secs(2);
    while alive(descendant) {
        assert!(Instant::now() < until, "owned descendant survived close");
        thread::sleep(Duration::from_millis(20));
    }
    m.shutdown();
    assert!(!alive(b["pid"].as_u64().unwrap() as u32));
    assert!(locks.leased.lock().unwrap().is_empty());
    assert!(m.request("open", json!({"projectId":"a"})).is_err());
    unrelated.kill().unwrap();
    unrelated.wait().unwrap();
}
#[test]
fn bounded_output_cursor_and_shutdown_release_native_shells() {
    let (_root, locks, m) = setup();
    let a = m.request("open", json!({"projectId":"a"})).unwrap();
    write(&m, &a, "stty -echo\r");
    thread::sleep(Duration::from_millis(100));
    write(
        &m,
        &a,
        "head -c 1200000 /dev/zero | tr '\\0' a; printf '\\nOUTPUT_DONE\\n'\r",
    );
    let until = Instant::now() + Duration::from_secs(5);
    loop {
        let mut p = params(&a);
        p["after"] = json!(0);
        let out = m.request("read", p).unwrap();
        assert!(out["data"].as_array().unwrap().len() <= 16384);
        if out["truncated"] == true {
            break;
        }
        assert!(
            Instant::now() < until,
            "ring did not fill; cursor={}, end={}",
            out["nextAfter"],
            out["availableUntil"]
        );
        thread::sleep(Duration::from_millis(30));
    }
    drop(m);
    assert!(!alive(a["pid"].as_u64().unwrap() as u32));
    assert!(locks.leased.lock().unwrap().is_empty());
}
#[test]
fn rejects_unknown_projects_and_limits_per_project_tabs() {
    let (_root, locks, m) = setup();
    assert!(m.request("open", json!({"projectId":"missing"})).is_err());
    for _ in 0..4 {
        m.request("open", json!({"projectId":"a"})).unwrap();
    }
    assert!(m.request("open", json!({"projectId":"a"})).is_err());
    m.close_project(None).unwrap();
    assert!(locks.leased.lock().unwrap().is_empty());
}

#[test]
fn native_owner_death_cleans_attached_pty_shell_and_foreground_command() {
    const CHILD_REPORT: &str = "MOOS_PTY_OWNER_CHILD_REPORT";
    if let Some(path) = std::env::var_os(CHILD_REPORT) {
        let (_root, locks, manager) = setup();
        let session = manager.request("open", json!({"projectId":"a"})).unwrap();
        let pid_file = locks.root.join("foreground.pid");
        write(
            &manager,
            &session,
            &format!(
                "sleep 120 & print -r -- $! > '{}'; wait\r",
                pid_file.display()
            ),
        );
        let until = Instant::now() + Duration::from_secs(3);
        while !pid_file.exists() {
            assert!(Instant::now() < until);
            thread::sleep(Duration::from_millis(20));
        }
        let command: u32 = std::fs::read_to_string(pid_file)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        std::fs::write(
            path,
            json!({"shell":session["pid"],"command":command}).to_string(),
        )
        .unwrap();
        loop {
            thread::park();
        }
    }
    let root = tempfile::tempdir().unwrap();
    let report_path = root.path().join("owned.json");
    let mut owner = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "native_owner_death_cleans_attached_pty_shell_and_foreground_command",
            "--nocapture",
        ])
        .env(CHILD_REPORT, &report_path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let until = Instant::now() + Duration::from_secs(5);
    while !report_path.exists() {
        if Instant::now() >= until {
            let _ = owner.kill();
            let _ = owner.wait();
            panic!("PTY owner did not start");
        }
        thread::sleep(Duration::from_millis(20));
    }
    let report: Value = serde_json::from_slice(&std::fs::read(report_path).unwrap()).unwrap();
    let shell = report["shell"].as_u64().unwrap() as u32;
    let command = report["command"].as_u64().unwrap() as u32;
    assert!(alive(shell) && alive(command));
    owner.kill().unwrap();
    owner.wait().unwrap();
    let until = Instant::now() + Duration::from_secs(5);
    while (alive(shell) || alive(command)) && Instant::now() < until {
        thread::sleep(Duration::from_millis(20));
    }
    let gone = !alive(shell) && !alive(command);
    // Failed acceptance still cleans only the exact fixture-owned processes.
    if !gone {
        unsafe {
            libc::kill(command as i32, libc::SIGKILL);
            libc::kill(shell as i32, libc::SIGKILL);
        }
    }
    assert!(gone, "PTY processes survived abrupt owner death");
}

#[test]
fn guardian_startup_failure_releases_lease_and_invalid_mode_cannot_target_processes() {
    let root = tempfile::tempdir().unwrap();
    let locks = Arc::new(Locks {
        root: root.path().canonicalize().unwrap(),
        leased: Mutex::new(HashSet::new()),
    });
    let manager = TerminalManager::new(locks.clone(), root.path().join("missing-guardian"));
    assert!(manager.request("open", json!({"projectId":"a"})).is_err());
    assert!(locks.leased.lock().unwrap().is_empty());
    let mut unrelated = Command::new("/bin/sleep").arg("30").spawn().unwrap();
    let status = Command::new(env!("CARGO_BIN_EXE_moos-desktop"))
        .args(["--moos-pty-guardian", "0", "1", "1"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .unwrap();
    assert_eq!(status.code(), Some(2));
    assert!(unrelated.try_wait().unwrap().is_none());
    unrelated.kill().unwrap();
    unrelated.wait().unwrap();
}
