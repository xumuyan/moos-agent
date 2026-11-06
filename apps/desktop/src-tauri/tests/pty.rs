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
    let manager = TerminalManager::new(locks.clone());
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
