const SERVICE: &str = "dev.moos.agent";

pub trait Credentials: Send {
    fn get(&self, id: &str) -> Result<Option<String>, String>;
    fn set(&self, id: &str, key: &str) -> Result<(), String>;
    fn delete(&self, id: &str) -> Result<(), String>;
}

pub struct NativeKeychain;

#[cfg(target_os = "macos")]
impl Credentials for NativeKeychain {
    fn get(&self, id: &str) -> Result<Option<String>, String> {
        match security_framework::passwords::get_generic_password(SERVICE, id) {
            Ok(bytes) => String::from_utf8(bytes)
                .map(Some)
                .map_err(|_| "Credential unavailable".into()),
            Err(e) if e.code() == -25300 => Ok(None),
            Err(_) => Err("Keychain access failed; unlock or authorize access in macOS".into()),
        }
    }
    fn set(&self, id: &str, key: &str) -> Result<(), String> {
        security_framework::passwords::set_generic_password(SERVICE, id, key.as_bytes())
            .map_err(|_| "Keychain save failed; unlock or authorize access in macOS".into())
    }
    fn delete(&self, id: &str) -> Result<(), String> {
        match security_framework::passwords::delete_generic_password(SERVICE, id) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == -25300 => Ok(()),
            Err(_) => Err("Provider removed, but Keychain cleanup failed; retry removal after unlocking Keychain".into()),
        }
    }
}

#[cfg(not(target_os = "macos"))]
impl Credentials for NativeKeychain {
    fn get(&self, _: &str) -> Result<Option<String>, String> {
        Err("Native credentials require macOS".into())
    }
    fn set(&self, _: &str, _: &str) -> Result<(), String> {
        Err("Native credentials require macOS".into())
    }
    fn delete(&self, _: &str) -> Result<(), String> {
        Err("Native credentials require macOS".into())
    }
}
