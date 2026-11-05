pub mod host;
pub mod keychain;
pub mod protocol;

use host::Host;
use keychain::Credentials;
use serde_json::Value;

pub struct Agent {
    host: Host,
    credentials: Box<dyn Credentials>,
}

impl Agent {
    pub fn new(host: Host, credentials: Box<dyn Credentials>) -> Self {
        Self { host, credentials }
    }

    pub fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
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
                                return Err("Provider save failed; credential rollback needs Keychain access".into());
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
                                serde_json::json!({"ok":false,"code":"keychain","message":"无法读取钥匙串，请解锁或在 macOS 中授权后重试","elapsedMs":0}),
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

    pub fn shutdown(&mut self) {
        self.host.shutdown();
    }
}
