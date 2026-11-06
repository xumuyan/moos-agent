//! Headless native mode. Retains one master descriptor until its owner's pipe
//! closes, so terminal children cannot detach merely because the UI was killed.
use std::{
    io::{BufRead, Read, Write},
    path::Path,
    process::{Child, Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};
pub struct Guardian {
    child: Option<Child>,
}
impl Guardian {
    #[cfg(unix)]
    pub fn launch(program: &Path, fd: i32, pid: u32) -> Result<Self, String> {
        use std::os::{
            fd::{AsRawFd, FromRawFd, OwnedFd},
            unix::process::CommandExt,
        };
        let duplicated = unsafe { libc::fcntl(fd, libc::F_DUPFD_CLOEXEC, 3) };
        if duplicated < 0 {
            return Err("无法保护终端描述符".into());
        }
        let descriptor = unsafe { OwnedFd::from_raw_fd(duplicated) };
        let inherited = descriptor.as_raw_fd();
        let mut command = Command::new(program);
        command
            .args([
                "--moos-pty-guardian",
                &inherited.to_string(),
                &pid.to_string(),
                &std::process::id().to_string(),
            ])
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        // Clear CLOEXEC only in this child, not in the multithreaded app.
        unsafe {
            command.pre_exec(move || {
                if libc::fcntl(inherited, libc::F_SETFD, 0) < 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let mut child = command.spawn().map_err(|_| "无法启动终端守护")?;
        drop(descriptor);
        let output = child.stdout.take().ok_or("守护握手不可用")?;
        let (send, ready) = mpsc::channel();
        thread::spawn(move || {
            let mut line = String::new();
            let good =
                std::io::BufReader::new(output).read_line(&mut line).is_ok() && line == "READY\n";
            let _ = send.send(good);
        });
        if ready.recv_timeout(Duration::from_secs(2)) != Ok(true) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("终端守护未就绪，已取消创建".into());
        }
        Ok(Self { child: Some(child) })
    }
    pub fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            drop(child.stdin.take());
            let until = Instant::now() + Duration::from_secs(2);
            loop {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    break;
                }
                if Instant::now() >= until {
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
                thread::sleep(Duration::from_millis(10));
            }
        }
    }
}
impl Drop for Guardian {
    fn drop(&mut self) {
        self.stop();
    }
}
#[cfg(unix)]
fn fingerprint(pid: u32) -> Option<String> {
    let out = Command::new("/bin/ps")
        .args(["-p", &pid.to_string(), "-o", "lstart="])
        .env("LC_ALL", "C")
        .output()
        .ok()?;
    let text = String::from_utf8(out.stdout).ok()?.trim().to_owned();
    (!text.is_empty()).then_some(text)
}
#[cfg(unix)]
fn run(fd: i32, pid: u32, parent: u32) -> i32 {
    use std::os::fd::{FromRawFd, OwnedFd};
    if fd < 3
        || pid <= 1
        || parent <= 1
        || unsafe { libc::getppid() } as u32 != parent
        || unsafe { libc::getsid(pid as i32) } != pid as i32
    {
        return 2;
    }
    let _descriptor = unsafe { OwnedFd::from_raw_fd(fd) };
    if unsafe { libc::tcgetpgrp(fd) } <= 1 {
        return 2;
    }
    let Some(identity) = fingerprint(pid) else {
        return 2;
    };
    if writeln!(std::io::stdout(), "READY")
        .and_then(|_| std::io::stdout().flush())
        .is_err()
    {
        return 2;
    }
    let mut data = [0u8; 1];
    loop {
        match std::io::stdin().read(&mut data) {
            Ok(0) => break,
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(_) => break,
        }
    }
    // PID identity and session membership protect against PID reuse; only
    // attached descendants are covered. Deliberately separated daemons are not.
    if fingerprint(pid).as_deref() != Some(&identity)
        || unsafe { libc::getsid(pid as i32) } != pid as i32
    {
        return 0;
    }
    let children = crate::pty::descendants(pid);
    let group = unsafe { libc::tcgetpgrp(fd) };
    if group > 1 && unsafe { libc::getsid(group) } == pid as i32 {
        unsafe {
            libc::kill(-group, libc::SIGKILL);
        }
    }
    for child in children.into_iter().rev() {
        if unsafe { libc::getsid(child as i32) } == pid as i32 {
            unsafe {
                libc::kill(child as i32, libc::SIGKILL);
            }
        }
    }
    unsafe {
        libc::kill(pid as i32, libc::SIGKILL);
    }
    0
}
pub fn from_args(args: &[String]) -> Option<i32> {
    if args.get(1).map(String::as_str) != Some("--moos-pty-guardian") {
        return None;
    }
    #[cfg(unix)]
    {
        let parsed = (|| {
            Some((
                args.get(2)?.parse().ok()?,
                args.get(3)?.parse().ok()?,
                args.get(4)?.parse().ok()?,
            ))
        })();
        return Some(match parsed {
            Some((fd, pid, parent)) if args.len() == 5 => run(fd, pid, parent),
            _ => 2,
        });
    }
    #[cfg(not(unix))]
    Some(2)
}
