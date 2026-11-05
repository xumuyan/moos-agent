use moos_desktop::{
    host::{dev_paths, Host},
    keychain::Credentials,
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
    let keys = MemoryCredentials::default();
    let mut agent = Agent::new(host, Box::new(keys.clone()));
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
fn uncooperative_child_shutdown_is_bounded_and_rejects_new_work() {
    let temp = Temp::new();
    let entry = temp.0.join("stall.mjs");
    std::fs::write(
        &entry,
        "process.stdin.resume(); setInterval(() => {}, 1000);",
    )
    .unwrap();
    let (node, _, runtime) = dev_paths().unwrap();
    let mut host = Host::launch(&node, &entry, &runtime, &temp.0).unwrap();
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
    let mut host = Host::launch(&node, &entry, &runtime, &temp.0).unwrap();
    assert!(host.request("snapshot", json!({})).is_err());
    assert!(host
        .request("snapshot", json!({}))
        .unwrap_err()
        .contains("stopped"));
}
