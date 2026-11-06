use moos_desktop::{
    host::{dev_paths, Host},
    keychain::Credentials,
    local_credentials::LocalCredentials,
    Agent,
};
use serde_json::json;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Instant, SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Default)]
struct MemoryCredentials(Arc<Mutex<HashMap<String, String>>>);
impl Credentials for MemoryCredentials {
    fn get(&self, id: &str) -> Result<Option<String>, String> {
        Ok(self.0.lock().unwrap().get(id).cloned())
    }
    fn set(&self, id: &str, key: &str) -> Result<(), String> {
        self.0.lock().unwrap().insert(id.into(), key.into());
        Ok(())
    }
    fn delete(&self, id: &str) -> Result<(), String> {
        self.0.lock().unwrap().remove(id);
        Ok(())
    }
}

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "moos-rust-{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&dir).unwrap();
        Self(dir)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn real_host_snapshots_and_key_boundary_and_shutdown() {
    let temp = Temp::new();
    let (node, entry, runtime) = dev_paths().unwrap();
    let host = Host::launch(&node, &entry, &runtime, &temp.0).unwrap();
    let keys = LocalCredentials::new(temp.0.join("private")).unwrap();
    let agent = Agent::new(
        host,
        Box::new(LocalCredentials::new(temp.0.join("private")).unwrap()),
    );
    assert!(agent.request("snapshot", json!({})).unwrap()["providers"].is_array());
    agent.request("save_provider", json!({"apiKey":"RUST_SECRET_TEST", "provider":{"id":"test", "model":"test", "api":"openai-completions", "baseUrl":"https://example.com/v1"}})).unwrap();
    assert_eq!(
        keys.get("test").unwrap().as_deref(),
        Some("RUST_SECRET_TEST")
    );
    assert!(!agent
        .request("snapshot", json!({}))
        .unwrap()
        .to_string()
        .contains("RUST_SECRET_TEST"));
    assert!(!std::fs::read_to_string(temp.0.join("providers.json"))
        .unwrap()
        .contains("RUST_SECRET_TEST"));
    assert!(agent
        .request(
            "save_provider",
            json!({"apiKey":"changed", "provider":{"id":"test", "baseUrl":"invalid"}})
        )
        .is_err());
    assert_eq!(
        keys.get("test").unwrap().as_deref(),
        Some("RUST_SECRET_TEST")
    );
    agent
        .request("remove_provider", json!({"providerId":"test"}))
        .unwrap();
    assert!(keys.get("test").unwrap().is_none());
    agent.shutdown();
    assert!(agent.request("snapshot", json!({})).is_err());
}

#[test]
fn diagnostics_use_draft_or_saved_credentials_without_saving() {
    let temp = Temp::new();
    let entry = temp.0.join("diagnostics.mjs");
    std::fs::write(&entry, r#"import {createInterface} from 'node:readline';
createInterface({input:process.stdin}).on('line', line => {
 const r=JSON.parse(line); if(r.method==='shutdown') process.exit(0);
 const key=r.params.apiKey;
 console.log(JSON.stringify({id:r.id,result:{ok:true,draft:key==='draft-key',saved:key==='saved-key',method:r.method}}));
});"#).unwrap();
    let (node, _, runtime) = dev_paths().unwrap();
    let host = Host::launch(&node, &entry, &runtime, &temp.0).unwrap();
    let keys = MemoryCredentials::default();
    keys.set("saved", "saved-key").unwrap();
    let agent = Agent::new(host, Box::new(keys.clone()));
    let draft = agent
        .request(
            "list_models",
            json!({"provider":{"id":"saved"},"apiKey":"draft-key"}),
        )
        .unwrap();
    assert_eq!(draft["draft"], true);
    assert_eq!(keys.get("saved").unwrap().as_deref(), Some("saved-key"));
    let saved = agent
        .request("test_provider", json!({"provider":{"id":"saved"}}))
        .unwrap();
    assert_eq!(saved["saved"], true);
    let missing = agent
        .request("test_provider", json!({"provider":{}}))
        .unwrap();
    assert_eq!(missing["code"], "missing_key");
    let missing_saved = agent
        .request("list_models", json!({"provider":{"id":"unknown"}}))
        .unwrap();
    assert_eq!(missing_saved["code"], "missing_key");
    assert!(keys.get("unknown").unwrap().is_none());
    agent.shutdown();
}

#[test]
fn unified_entry_serves_tasks_and_diagnostics() {
    let temp = Temp::new();
    let (node, entry, runtime) = dev_paths().unwrap();
    let host = Host::launch(&node, &entry, &runtime, &temp.0).unwrap();
    assert!(host.request("snapshot", json!({})).unwrap()["projects"].is_array());
    let diagnostic = host.request("list_models", json!({"provider":{}})).unwrap();
    assert_eq!(diagnostic["code"], "invalid_config");
    host.shutdown();
}

#[test]
fn delayed_diagnostics_leave_regular_snapshot_and_cancel_responsive() {
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::mpsc,
        thread,
        time::Duration,
    };
    let temp = Temp::new();
    let (node, entry, runtime) = dev_paths().unwrap();
    let keys = MemoryCredentials::default();
    keys.set("fixture", "saved-fixture-key").unwrap();
    let regular = Arc::new(Agent::new(
        Host::launch(&node, &entry, &runtime, &temp.0).unwrap(),
        Box::new(keys.clone()),
    ));
    let project = regular
        .request("add_project", json!({"path": temp.0}))
        .unwrap();
    let conversation = regular
        .request("create_conversation", json!({"projectId": project["id"]}))
        .unwrap();
    // Keep the task's upstream pending too, so cancel targets live work, not a failed task.
    let task_listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let task_url = format!("http://{}/v1", task_listener.local_addr().unwrap());
    regular
        .request(
            "save_provider",
            json!({"provider": {"id":"fixture", "model":"fixture",
        "api":"openai-completions", "baseUrl":task_url}}),
        )
        .unwrap();
    let task = regular
        .request(
            "submit",
            json!({"conversationId":conversation["id"],
        "providerId":"fixture", "message":"Wait for cancellation"}),
        )
        .unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    let (started, waiting) = mpsc::channel();
    let (release, held) = mpsc::channel();
    let server = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut request = Vec::new();
        while !request.ends_with(b"\r\n\r\n") {
            let mut byte = [0];
            socket.read_exact(&mut byte).unwrap();
            request.push(byte[0]);
        }
        started.send(String::from_utf8(request).unwrap()).unwrap();
        held.recv_timeout(Duration::from_secs(5)).unwrap();
        let body = r#"{"data":[{"id":"fixture-model"}]}"#;
        write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
    });
    let diagnostic = regular.clone();
    let (done, result) = mpsc::channel();
    let worker = thread::spawn(move || {
        let reply = diagnostic.request(
            "list_models",
            json!({"provider": {"id":"fixture",
            "baseUrl":url, "api":"openai-completions"}}),
        );
        done.send(reply).unwrap();
        let test = diagnostic
            .request(
                "test_provider",
                json!({"provider": {"id":"fixture",
            "baseUrl":"invalid", "api":"openai-completions", "model":"fixture"}}),
            )
            .unwrap();
        assert_eq!(test["code"], "invalid_config");
        assert!(diagnostic.request("snapshot", json!({})).is_ok());
    });
    let request = waiting.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(request.starts_with("GET /v1/models HTTP/1.1"));
    assert!(request
        .to_lowercase()
        .contains("authorization: bearer saved-fixture-key"));
    let start = Instant::now();
    assert!(regular.request("snapshot", json!({})).unwrap()["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .any(|item| item["id"] == task["id"] && item["status"] == "running"));
    assert_eq!(
        regular
            .request("cancel", json!({"taskId":task["id"]}))
            .unwrap()["id"],
        task["id"]
    );
    assert!(
        start.elapsed() < Duration::from_secs(1),
        "control lane blocked on diagnostics"
    );
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        let snapshot = regular.request("snapshot", json!({})).unwrap();
        if snapshot["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["id"] == task["id"] && item["status"] == "cancelled")
        {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "task cancellation did not finish"
        );
        thread::yield_now();
    }
    assert!(
        matches!(result.try_recv(), Err(mpsc::TryRecvError::Empty)),
        "fixture must still be delayed"
    );
    release.send(()).unwrap();
    let reply = result
        .recv_timeout(Duration::from_secs(5))
        .unwrap()
        .unwrap();
    assert_eq!(reply["models"], json!(["fixture-model"]));
    worker.join().unwrap();
    server.join().unwrap();
    regular.shutdown();
}

#[test]
fn uncooperative_child_shutdown_is_bounded_and_rejects_new_work() {
    let temp = Temp::new();
    let entry = temp.0.join("stall.mjs");
    std::fs::write(
        &entry,
        "process.stdin.resume(); setInterval(() => {}, 1000);",
    )
    .unwrap();
    let (node, _, runtime) = dev_paths().unwrap();
    let host = Host::launch(&node, &entry, &runtime, &temp.0).unwrap();
    let start = Instant::now();
    host.shutdown();
    assert!(start.elapsed().as_secs() < 5);
    assert!(host.request("snapshot", json!({})).is_err());
}

#[test]
fn malformed_host_reply_invalidates_connection() {
    let temp = Temp::new();
    let entry = temp.0.join("invalid.mjs");
    std::fs::write(
        &entry,
        "process.stdin.on('data', () => process.stdout.write('{\"id\":999,\"result\":true}\\n')); ",
    )
    .unwrap();
    let (node, _, runtime) = dev_paths().unwrap();
    let host = Host::launch(&node, &entry, &runtime, &temp.0).unwrap();
    assert!(host.request("snapshot", json!({})).is_err());
    assert!(host
        .request("snapshot", json!({}))
        .unwrap_err()
        .contains("stopped"));
}
