use crate::protocol;
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::mpsc::{self, Receiver, SyncSender},
    thread,
    time::{Duration, Instant},
};

const MAX_FRAME: u64 = 4 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

pub struct Host {
    child: Child,
    writes: Option<SyncSender<Vec<u8>>>,
    replies: Receiver<Result<String, String>>,
    sequence: u64,
    stopped: bool,
}

impl Host {
    pub fn launch(node: &Path, entry: &Path, runtime: &Path, data: &Path) -> Result<Self, String> {
        Self::spawn(node, entry, runtime, data, false)
    }

    pub fn launch_diagnostics(
        node: &Path,
        entry: &Path,
        runtime: &Path,
        data: &Path,
    ) -> Result<Self, String> {
        Self::spawn(node, entry, runtime, data, true)
    }

    fn spawn(
        node: &Path,
        entry: &Path,
        runtime: &Path,
        data: &Path,
        diagnostics: bool,
    ) -> Result<Self, String> {
        if !node.is_absolute() || !entry.is_absolute() {
            return Err("Agent paths must be absolute".into());
        }
        let mut command = Command::new(node);
        command.arg(entry);
        if diagnostics {
            command.arg("--diagnostics");
        }
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
        let (send, replies) = mpsc::sync_channel(1);
        thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                let mut bytes = Vec::new();
                let result = match reader
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
                let failed = result.is_err();
                if send.send(result).is_err() || failed {
                    break;
                }
            }
        });
        // Drain in fixed chunks. Never retain or log raw diagnostics (they can contain keys).
        thread::spawn(move || {
            let mut buffer = [0u8; 4096];
            while matches!(stderr.read(&mut buffer), Ok(n) if n > 0) {}
        });
        Ok(Self {
            child,
            writes: Some(writes),
            replies,
            sequence: 0,
            stopped: false,
        })
    }

    pub fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.exchange(method, params, REQUEST_TIMEOUT)
    }

    fn exchange(
        &mut self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        if self.stopped {
            return Err("Agent is stopped; restart the application".into());
        }
        self.sequence += 1;
        let mut frame =
            serde_json::to_vec(&json!({"id": self.sequence, "method": method, "params": params}))
                .map_err(|_| "Invalid request")?;
        if frame.len() as u64 >= MAX_FRAME {
            return Err("Agent request too large".into());
        }
        frame.push(b'\n');
        let sent = self.writes.as_ref().ok_or("Agent stopped")?.try_send(frame);
        let result = if sent.is_err() {
            Err("Agent input unavailable".into())
        } else {
            match self.replies.recv_timeout(timeout) {
                Ok(Ok(line)) => protocol::response(&line, self.sequence),
                Ok(Err(error)) => Err(error),
                Err(_) => Err("Agent disconnected or timed out; restart the application".into()),
            }
        };
        // A host error is safe to report, but malformed/late replies must never be reused.
        if result.as_ref().is_err_and(|e| e != "Agent request failed") {
            self.terminate();
        }
        result
    }

    pub fn shutdown(&mut self) {
        if !self.stopped {
            let _ = self.exchange("shutdown", json!({}), Duration::from_secs(2));
            self.writes.take();
            let until = Instant::now() + Duration::from_secs(2);
            while Instant::now() < until {
                if matches!(self.child.try_wait(), Ok(Some(_))) {
                    self.stopped = true;
                    return;
                }
                thread::sleep(Duration::from_millis(20));
            }
            self.terminate();
        }
    }

    fn terminate(&mut self) {
        self.stopped = true;
        self.writes.take();
        // Only our exact owned child is terminated, never unrelated processes.
        let _ = self.child.kill();
        let until = Instant::now() + Duration::from_secs(1);
        while Instant::now() < until {
            if matches!(self.child.try_wait(), Ok(Some(_))) {
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
