pub mod host;
pub mod keychain;
pub mod local_credentials;
pub mod plugins;
pub mod protocol;
pub mod pty;

use host::Host;
use keychain::Credentials;
use serde_json::Value;

pub struct Agent {
    host: Host,
    credentials: Box<dyn Credentials>,
    terminal_coordination: std::sync::Mutex<()>,
}

impl pty::WorkspaceLocks for Agent {
    fn acquire(&self, project: &str, session: &str) -> Result<std::path::PathBuf, String> {
        let _serial = self
            .terminal_coordination
            .lock()
            .map_err(|_| "终端协调不可用")?;
        let result = self.host.request(
            "terminal_acquire",
            serde_json::json!({"projectId":project,"sessionId":session}),
        )?;
        if result["ok"] != true {
            return Err("项目正被任务占用或终端额度已满，请等待任务完成或先停止任务".into());
        }
        result["path"]
            .as_str()
            .map(std::path::PathBuf::from)
            .ok_or("项目目录不可用".into())
    }
    fn release(&self, session: &str) {
        let Ok(_serial) = self.terminal_coordination.lock() else {
            return;
        };
        let _ = self
            .host
            .request("terminal_release", serde_json::json!({"sessionId":session}));
    }
}

impl Agent {
    pub fn new(host: Host, credentials: Box<dyn Credentials>) -> Self {
        Self {
            host,
            credentials,
            terminal_coordination: std::sync::Mutex::new(()),
        }
    }

    pub fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let (mut params, key) = protocol::public_params(method, params)?;
        match method {
            "save_provider" => {
                let id = protocol::provider_id(&params, "/provider/id")?.to_owned();
                // Store before publishing metadata. Roll back on host rejection.
                let old = self.credentials.get(&id)?;
                if let Some(ref key) = key {
                    self.credentials.set(&id, key)?;
                }
                match self.host.request(method, params) {
                    Ok(result) => Ok(result),
                    Err(error) => {
                        if key.is_some() {
                            let rollback = match old {
                                Some(old) => self.credentials.set(&id, &old),
                                None => self.credentials.delete(&id),
                            };
                            if rollback.is_err() {
                                return Err(
                                    "Provider save failed; local credential rollback failed".into(),
                                );
                            }
                        }
                        Err(error)
                    }
                }
            }
            "list_models" | "test_provider" => {
                let credential = if key.is_some() {
                    key
                } else if params.pointer("/provider/id").is_some() {
                    let id = protocol::provider_id(&params, "/provider/id")?;
                    match self.credentials.get(id) {
                        Ok(key) => key,
                        Err(_) => {
                            return Ok(
                                serde_json::json!({"ok":false,"code":"credentials","message":"无法读取本地密钥文件，请检查文件权限或重新保存服务","elapsedMs":0}),
                            )
                        }
                    }
                } else {
                    None
                };
                let Some(key) = credential else {
                    return Ok(
                        serde_json::json!({"ok":false,"code":"missing_key","message":"请填写 API 密钥，或编辑已保存密钥的服务","elapsedMs":0}),
                    );
                };
                params["apiKey"] = Value::String(key);
                self.host.request(method, params)
            }
            "submit" => {
                let id = protocol::provider_id(&params, "/providerId")?;
                let key = self
                    .credentials
                    .get(id)?
                    .ok_or("Provider has no API key; save its credential first")?;
                params["apiKey"] = Value::String(key);
                self.host.request(method, params)
            }
            "remove_provider" => {
                let id = protocol::provider_id(&params, "/providerId")?.to_owned();
                let result = self.host.request(method, params)?;
                self.credentials.delete(&id)?;
                Ok(result)
            }
            _ => self.host.request(method, params),
        }
    }

    pub fn shutdown(&self) {
        self.host.shutdown();
    }
}
