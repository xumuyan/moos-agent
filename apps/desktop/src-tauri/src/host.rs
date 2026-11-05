use crate::protocol;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{self, SyncSender},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

const MAX_FRAME: u64 = 4 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

pub struct Host {
    child: Mutex<Child>,
    writes: Mutex<Option<SyncSender<Vec<u8>>>>,
    pending: Arc<Mutex<HashMap<u64, SyncSender<Result<String, String>>>>>,
    sequence: AtomicU64,
    stopped: AtomicBool,
}

impl Host {
    pub fn launch(node: &Path, entry: &Path, runtime: &Path, data: &Path) -> Result<Self, String> {
        if !node.is_absolute() || !entry.is_absolute() {
            return Err("Agent paths must be absolute".into());
        }
        let mut command = Command::new(node);
        command.arg(entry);
        command
            .current_dir(entry.parent().ok_or("Invalid agent path")?)
            .env("MOOS_DATA_DIR", data)
            .env("MOOS_RUNTIME_DIR", runtime)
            .env("MOOS_PARENT_PID", std::process::id().to_string())
            .env_remove("NODE_OPTIONS")
            .env_remove("NODE_PATH")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command
            .spawn()
            .map_err(|_| "Unable to start bundled agent runtime")?;
        let mut stdin = child.stdin.take().ok_or("Agent input unavailable")?;
        let stdout = child.stdout.take().ok_or("Agent output unavailable")?;
        let mut stderr = child.stderr.take().ok_or("Agent diagnostics unavailable")?;
        let (writes, pending) = mpsc::sync_channel::<Vec<u8>>(1);
        thread::spawn(move || {
            while let Ok(frame) = pending.recv() {
                if stdin.write_all(&frame).and_then(|_| stdin.flush()).is_err() {
                    break;
                }
            }
        });
        let pending: Arc<Mutex<HashMap<u64, SyncSender<Result<String, String>>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let dispatch = pending.clone();
        thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                let mut bytes = Vec::new();
                let result: Result<String, String> = match reader
                    .by_ref()
                    .take(MAX_FRAME + 1)
                    .read_until(b'\n', &mut bytes)
                {
                    Ok(0) => break,
                    Ok(_) if bytes.len() as u64 <= MAX_FRAME && bytes.last() == Some(&b'\n') => {
                        String::from_utf8(bytes).map_err(|_| "Invalid agent encoding".into())
                    }
                    _ => Err("Invalid or oversized agent frame".into()),
                };
                match result {
                    Ok(line) => {
                        let id = serde_json::from_str::<Value>(&line)
                            .ok()
                            .and_then(|value| value.get("id").and_then(Value::as_u64));
                        if let Some(sender) = id.and_then(|id| dispatch.lock().ok()?.remove(&id)) {
                            let _ = sender.send(Ok(line));
                        } else {
                            break;
                        }
                    }
                    Err(error) => {
                        if let Ok(mut map) = dispatch.lock() {
                            for (_, sender) in map.drain() {
                                let _ = sender.send(Err(error.clone()));
                            }
                        }
                        break;
                    }
                }
            }
            if let Ok(mut map) = dispatch.lock() {
                for (_, sender) in map.drain() {
                    let _ = sender.send(Err("Agent disconnected".into()));
                }
            }
        });
        // Drain in fixed chunks. Never retain or log raw diagnostics (they can contain keys).
        thread::spawn(move || {
            let mut buffer = [0u8; 4096];
            while matches!(stderr.read(&mut buffer), Ok(n) if n > 0) {}
        });
        Ok(Self {
            child: Mutex::new(child),
            writes: Mutex::new(Some(writes)),
            pending,
            sequence: AtomicU64::new(0),
            stopped: AtomicBool::new(false),
        })
    }

    pub fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        self.exchange(method, params, REQUEST_TIMEOUT)
    }

    fn exchange(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        if self.stopped.load(Ordering::Acquire) {
            return Err("Agent is stopped; restart the application".into());
        }
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed) + 1;
        let mut frame =
            serde_json::to_vec(&json!({"id": sequence, "method": method, "params": params}))
                .map_err(|_| "Invalid request")?;
        if frame.len() as u64 >= MAX_FRAME {
            return Err("Agent request too large".into());
        }
        frame.push(b'\n');
        let (send, reply) = mpsc::sync_channel(1);
        self.pending
            .lock()
            .map_err(|_| "Agent state unavailable")?
            .insert(sequence, send);
        let sent = self
            .writes
            .lock()
            .map_err(|_| "Agent state unavailable")?
            .as_ref()
            .ok_or("Agent stopped")?
            .try_send(frame);
        let result = if sent.is_err() {
            self.pending
                .lock()
                .ok()
                .and_then(|mut map| map.remove(&sequence));
            Err("Agent input unavailable".into())
        } else {
            match reply.recv_timeout(timeout) {
                Ok(Ok(line)) => protocol::response(&line, sequence),
                Ok(Err(error)) => Err(error),
                Err(_) => {
                    self.pending
                        .lock()
                        .ok()
                        .and_then(|mut map| map.remove(&sequence));
                    Err("Agent disconnected or timed out; restart the application".into())
                }
            }
        };
        // A host error is safe to report, but malformed/late replies must never be reused.
        if result.as_ref().is_err_and(|e| e != "Agent request failed") {
            self.terminate();
        }
        result
    }

    pub fn shutdown(&self) {
        if !self.stopped.load(Ordering::Acquire) {
            let _ = self.exchange("shutdown", json!({}), Duration::from_secs(2));
            self.writes.lock().ok().and_then(|mut writes| writes.take());
            let until = Instant::now() + Duration::from_secs(2);
            while Instant::now() < until {
                if matches!(
                    self.child
                        .lock()
                        .ok()
                        .and_then(|mut child| child.try_wait().ok())
                        .flatten(),
                    Some(_)
                ) {
                    self.stopped.store(true, Ordering::Release);
                    return;
                }
                thread::sleep(Duration::from_millis(20));
            }
            self.terminate();
        }
    }

    fn terminate(&self) {
        if self.stopped.swap(true, Ordering::AcqRel) {
            return;
        }
        self.writes.lock().ok().and_then(|mut writes| writes.take());
        if let Ok(mut map) = self.pending.lock() {
            for (_, sender) in map.drain() {
                let _ = sender.send(Err("Agent stopped".into()));
            }
        }
        // Only our exact owned child is terminated, never unrelated processes.
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
        let until = Instant::now() + Duration::from_secs(1);
        while Instant::now() < until {
            if matches!(
                self.child
                    .lock()
                    .ok()
                    .and_then(|mut child| child.try_wait().ok())
                    .flatten(),
                Some(_)
            ) {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        self.shutdown();
    }
}

pub fn dev_paths() -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .map_err(|_| "Repository unavailable")?;
    let runtime = root.join(".generated/runtime");
    let candidates = [
        runtime.join("node"),
        runtime.join("bin/node"),
        root.join("probes/m01/desktop/src-tauri/binaries/node-aarch64-apple-darwin"),
        PathBuf::from("/opt/homebrew/bin/node"),
        PathBuf::from("/usr/local/bin/node"),
    ];
    let node = candidates
        .into_iter()
        .find(|p| p.is_file())
        .ok_or("Node runtime missing; prepare the local runtime")?;
    Ok((node, root.join("services/agent/main.mjs"), runtime))
}
