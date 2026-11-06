//! Trusted built-in integration only. No generic shell command or environment API.
use crate::pty_guardian::Guardian;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    io::{ErrorKind, Read, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

const BUFFER: usize = 1024 * 1024;
const PAGE: usize = 16384;
pub trait WorkspaceLocks: Send + Sync {
    fn acquire(&self, project: &str, session: &str) -> Result<PathBuf, String>;
    fn release(&self, session: &str);
}
struct Output {
    bytes: VecDeque<u8>,
    start: u64,
    ended: bool,
    eof: bool,
    code: Option<u32>,
}
struct Session {
    id: String,
    project: String,
    path: PathBuf,
    pid: u32,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    output: Mutex<Output>,
    closed: AtomicBool,
    released: AtomicBool,
    locks: Arc<dyn WorkspaceLocks>,
    _rc: tempfile::TempDir,
    guardian: Mutex<Guardian>,
}
impl Session {
    fn release(&self) {
        if !self.released.swap(true, Ordering::AcqRel) {
            self.locks.release(&self.id);
        }
    }
    fn info(&self) -> Value {
        let out = self.output.lock().unwrap();
        json!({"id":self.id,"projectId":self.project,"cwd":self.path,"pid":self.pid,"ended":out.ended,"exitCode":out.code})
    }
    fn stop(&self) -> Result<(), String> {
        self.input(&[3])
    }
    fn input(&self, bytes: &[u8]) -> Result<(), String> {
        if bytes.len() > 4096
            || self.closed.load(Ordering::Acquire)
            || self.output.lock().unwrap().ended
        {
            return Err("终端已退出或输入过大".into());
        }
        let mut writer = self.writer.lock().unwrap();
        let until = Instant::now() + Duration::from_millis(250);
        let mut offset = 0;
        while offset < bytes.len() {
            match writer.write(&bytes[offset..]) {
                Ok(0) => return Err("终端输入已关闭".into()),
                Ok(n) => offset += n,
                Err(error) if error.kind() == ErrorKind::WouldBlock && Instant::now() < until => {
                    thread::sleep(Duration::from_millis(5))
                }
                Err(error) if error.kind() == ErrorKind::Interrupted => {}
                Err(_) => {
                    return Err("终端输入未完整发送，请关闭该标签后重开；不要重复提交命令".into())
                }
            }
        }
        Ok(())
    }
    fn close(&self) -> Result<(), String> {
        self.closed.store(true, Ordering::Release);
        let mut child = self.child.lock().unwrap();
        if child.try_wait().map_err(|_| "无法查询终端状态")?.is_none() {
            // Snapshot descendants while our unreaped shell still owns the PID.
            // Signals target only this owned shell/foreground group and its descendants.
            #[cfg(unix)]
            {
                let descendants = descendants(self.pid);
                if let Some(group) = self.master.lock().unwrap().process_group_leader() {
                    if group > 1 {
                        unsafe {
                            libc::kill(-group, libc::SIGKILL);
                        }
                    }
                }
                for pid in descendants.into_iter().rev() {
                    unsafe {
                        libc::kill(pid as i32, libc::SIGKILL);
                    }
                }
            }
            let _ = child.kill();
            let until = Instant::now() + Duration::from_secs(1);
            loop {
                if child.try_wait().map_err(|_| "无法确认终端退出")?.is_some() {
                    break;
                }
                if Instant::now() >= until {
                    return Err("终端尚未退出，目录锁保持，请重试关闭".into());
                }
                thread::sleep(Duration::from_millis(10));
            }
        }
        self.output.lock().unwrap().ended = true;
        self.guardian.lock().unwrap().stop();
        self.release();
        Ok(())
    }
}
#[cfg(unix)]
pub(crate) fn descendants(root: u32) -> Vec<u32> {
    let output = std::process::Command::new("/bin/ps")
        .args(["-axo", "pid=,ppid="])
        .output();
    let pairs: Vec<(u32, u32)> = output
        .ok()
        .map(|out| {
            String::from_utf8_lossy(&out.stdout)
                .lines()
                .filter_map(|line| {
                    let mut parts = line.split_whitespace();
                    Some((parts.next()?.parse().ok()?, parts.next()?.parse().ok()?))
                })
                .collect()
        })
        .unwrap_or_default();
    let mut owned = vec![root];
    let mut index = 0;
    while index < owned.len() && owned.len() < 4096 {
        let parent = owned[index];
        for &(pid, ppid) in &pairs {
            if ppid == parent && pid > 1 && !owned.contains(&pid) {
                owned.push(pid);
            }
        }
        index += 1;
    }
    owned.into_iter().skip(1).collect()
}

pub struct TerminalManager {
    guardian_program: PathBuf,
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    sequence: AtomicU64,
    locks: Arc<dyn WorkspaceLocks>,
    shutting_down: AtomicBool,
}
impl TerminalManager {
    pub fn new(locks: Arc<dyn WorkspaceLocks>, guardian_program: PathBuf) -> Self {
        Self {
            guardian_program,
            sessions: Mutex::new(HashMap::new()),
            sequence: AtomicU64::new(0),
            locks,
            shutting_down: AtomicBool::new(false),
        }
    }
    fn open(&self, project: &str, rows: u16, cols: u16) -> Result<Value, String> {
        if !cfg!(target_os = "macos") {
            return Err("当前仅验证 Mac 终端".into());
        }
        let mut sessions = self.sessions.lock().unwrap();
        if self.shutting_down.load(Ordering::Acquire)
            || sessions.len() >= 8
            || sessions.values().filter(|s| s.project == project).count() >= 4
        {
            return Err("终端不可用或已达到标签上限（每项目4个，共8个）".into());
        }
        let id = format!(
            "pty_{}_{}",
            std::process::id(),
            self.sequence.fetch_add(1, Ordering::Relaxed)
        );
        let path = self.locks.acquire(project, &id)?;
        let result = (|| {
            if !path.is_absolute()
                || !path.is_dir()
                || std::fs::canonicalize(&path).map_err(|_| "项目目录不可用")? != path
            {
                return Err("项目目录已变化，请重新添加项目".into());
            }
            let pair = native_pty_system()
                .openpty(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|_| "无法创建原生终端")?;
            #[cfg(unix)]
            if let Some(fd) = pair.master.as_raw_fd() {
                let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
                if flags < 0
                    || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0
                {
                    return Err("无法设置终端读写边界".into());
                }
            }
            let mut reader = pair
                .master
                .try_clone_reader()
                .map_err(|_| "终端输出不可用")?;
            #[cfg(unix)]
            let read_fd = pair.master.as_raw_fd();
            let writer = pair.master.take_writer().map_err(|_| "终端输入不可用")?;
            let rc = tempfile::tempdir().map_err(|_| "终端环境不可用")?;
            let mut cmd = CommandBuilder::new("/bin/zsh");
            cmd.arg("-f");
            cmd.cwd(&path);
            cmd.env_clear();
            for (name, value) in [
                (
                    "PATH",
                    "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
                ),
                ("TERM", "xterm-256color"),
                ("LANG", "en_US.UTF-8"),
                ("PROMPT", "Moos %~ %# "),
            ] {
                cmd.env(name, value);
            }
            if let Some(home) = std::env::var_os("HOME") {
                cmd.env("HOME", home);
            }
            cmd.env("ZDOTDIR", rc.path());
            let mut child = pair
                .slave
                .spawn_command(cmd)
                .map_err(|_| "无法启动项目 shell")?;
            let pid = child.process_id().ok_or("终端未返回进程标识")?;
            #[cfg(unix)]
            let guardian = match Guardian::launch(
                &self.guardian_program,
                read_fd.ok_or("终端描述符不可用")?,
                pid,
            ) {
                Ok(guardian) => guardian,
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(error);
                }
            };
            #[cfg(not(unix))]
            let guardian: Guardian = return Err("当前仅验证Mac守护".into());
            drop(pair.slave);
            let session = Arc::new(Session {
                id: id.clone(),
                project: project.into(),
                path,
                pid,
                master: Mutex::new(pair.master),
                writer: Mutex::new(writer),
                child: Mutex::new(child),
                output: Mutex::new(Output {
                    bytes: VecDeque::new(),
                    start: 0,
                    ended: false,
                    eof: false,
                    code: None,
                }),
                closed: AtomicBool::new(false),
                released: AtomicBool::new(false),
                locks: self.locks.clone(),
                _rc: rc,
                guardian: Mutex::new(guardian),
            });
            let stream = session.clone();
            thread::spawn(move || {
                let mut data = [0u8; 8192];
                loop {
                    match reader.read(&mut data) {
                        Ok(0) => break,
                        Ok(n) => {
                            let mut out = stream.output.lock().unwrap();
                            out.bytes.extend(&data[..n]);
                            while out.bytes.len() > BUFFER {
                                out.bytes.pop_front();
                                out.start += 1;
                            }
                        }
                        Err(e) if e.kind() == ErrorKind::WouldBlock => {
                            if stream.closed.load(Ordering::Acquire) {
                                break;
                            }
                            #[cfg(unix)]
                            if let Some(fd) = read_fd {
                                let mut pending = libc::pollfd {
                                    fd,
                                    events: libc::POLLIN,
                                    revents: 0,
                                };
                                unsafe {
                                    libc::poll(&mut pending, 1, 100);
                                }
                            } else {
                                thread::sleep(Duration::from_millis(1));
                            }
                            #[cfg(not(unix))]
                            thread::sleep(Duration::from_millis(5));
                        }
                        Err(e) if e.kind() == ErrorKind::Interrupted => {}
                        Err(_) => break,
                    }
                }
                stream.output.lock().unwrap().eof = true;
            });
            let waiter = session.clone();
            thread::spawn(move || loop {
                if waiter.closed.load(Ordering::Acquire) {
                    break;
                }
                let waited = waiter.child.lock().unwrap().try_wait();
                match waited {
                    Ok(Some(status)) => {
                        let mut out = waiter.output.lock().unwrap();
                        out.ended = true;
                        out.code = Some(status.exit_code());
                        drop(out);
                        waiter.closed.store(true, Ordering::Release);
                        waiter.guardian.lock().unwrap().stop();
                        waiter.release();
                        break;
                    }
                    Err(_) => {
                        let _ = waiter.close();
                        break;
                    }
                    _ => {}
                }
                thread::sleep(Duration::from_millis(50));
            });
            Ok(session)
        })();
        match result {
            Ok(session) => {
                let info = session.info();
                sessions.insert(id, session);
                Ok(info)
            }
            Err(e) => {
                self.locks.release(&id);
                Err(e)
            }
        }
    }
    pub fn close_project(&self, project: Option<&str>) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let ids: Vec<_> = sessions
            .values()
            .filter(|s| project.is_none_or(|p| s.project == p))
            .map(|s| s.id.clone())
            .collect();
        for id in ids {
            if let Some(session) = sessions.get(&id) {
                session.close()?;
            }
            sessions.remove(&id);
        }
        Ok(())
    }
    pub fn shutdown(&self) {
        self.shutting_down.store(true, Ordering::Release);
        let _ = self.close_project(None);
    }
    pub fn request(&self, action: &str, params: Value) -> Result<Value, String> {
        if action == "close_all" {
            self.close_project(None)?;
            return Ok(json!({"ok":true}));
        }
        let project = params
            .get("projectId")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty() && s.len() <= 128)
            .ok_or("项目标识无效")?;
        if action == "list" {
            return Ok(Value::Array(
                self.sessions
                    .lock()
                    .unwrap()
                    .values()
                    .filter(|s| s.project == project)
                    .map(|s| s.info())
                    .collect(),
            ));
        }
        let dimension = |key: &str, default: u16| -> Result<u16, String> {
            let n = match params.get(key) {
                None => default as u64,
                Some(value) => value.as_u64().ok_or("终端尺寸无效")?,
            };
            if !(2..=500).contains(&n) {
                return Err("终端尺寸无效".into());
            }
            Ok(n as u16)
        };
        if action == "open" {
            return self.open(project, dimension("rows", 24)?, dimension("cols", 80)?);
        }
        let id = params
            .get("sessionId")
            .and_then(Value::as_str)
            .ok_or("终端标识无效")?;
        let session = self
            .sessions
            .lock()
            .unwrap()
            .get(id)
            .filter(|s| s.project == project)
            .cloned()
            .ok_or("终端不属于当前项目或已关闭")?;
        match action {
            "write" => {
                let data = params
                    .get("data")
                    .and_then(Value::as_str)
                    .ok_or("终端输入无效")?;
                session.input(data.as_bytes())?;
                Ok(json!({"ok":true}))
            }
            "interrupt" => {
                session.stop()?;
                Ok(json!({"ok":true}))
            }
            "resize" => {
                session
                    .master
                    .lock()
                    .unwrap()
                    .resize(PtySize {
                        rows: dimension("rows", 24)?,
                        cols: dimension("cols", 80)?,
                        pixel_width: 0,
                        pixel_height: 0,
                    })
                    .map_err(|_| "无法调整终端尺寸")?;
                Ok(json!({"ok":true}))
            }
            "read" => {
                let cursor = params
                    .get("after")
                    .and_then(Value::as_u64)
                    .ok_or("终端游标无效")?;
                let out = session.output.lock().unwrap();
                let end = out.start + out.bytes.len() as u64;
                if cursor > end {
                    return Err("终端游标超出范围".into());
                }
                let start = cursor.max(out.start);
                let offset = (start - out.start) as usize;
                let bytes: Vec<_> = out.bytes.iter().skip(offset).take(PAGE).copied().collect();
                let next = start + bytes.len() as u64;
                Ok(
                    json!({"data":bytes,"nextAfter":next,"availableUntil":end,"truncated":cursor<out.start,"ended":out.ended && out.eof,"exitCode":out.code,"hasMore":next<end}),
                )
            }
            "close" => {
                session.close()?;
                self.sessions.lock().unwrap().remove(id);
                Ok(json!({"ok":true}))
            }
            _ => Err("不支持的终端操作".into()),
        }
    }
}
impl Drop for TerminalManager {
    fn drop(&mut self) {
        self.shutdown();
    }
}
