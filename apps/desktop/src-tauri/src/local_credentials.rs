use crate::keychain::Credentials;
use std::{collections::BTreeMap, fs, io::Write, path::PathBuf, sync::Mutex};

pub struct LocalCredentials {
    root: PathBuf,
    lock: Mutex<()>,
}

impl LocalCredentials {
    pub fn new(root: PathBuf) -> Result<Self, String> {
        if root.exists()
            && fs::symlink_metadata(&root)
                .map_err(|_| "Credential directory unavailable")?
                .file_type()
                .is_symlink()
        {
            return Err("Credential directory must not be a link".into());
        }
        fs::create_dir_all(&root).map_err(|_| "Credential directory unavailable")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&root, fs::Permissions::from_mode(0o700))
                .map_err(|_| "Unable to protect credential directory")?;
        }
        Ok(Self {
            root,
            lock: Mutex::new(()),
        })
    }
    fn read(&self) -> Result<BTreeMap<String, String>, String> {
        let path = self.root.join("credentials.json");
        match fs::symlink_metadata(&path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(BTreeMap::new())
            }
            Ok(meta)
                if meta.is_file()
                    && !meta.file_type().is_symlink()
                    && meta.len() <= 1024 * 1024 => {}
            _ => return Err("Invalid credential file".into()),
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
                .map_err(|_| "Unable to protect credentials")?;
        }
        serde_json::from_slice(&fs::read(path).map_err(|_| "Unable to read credentials")?)
            .map_err(|_| "Invalid credential file".into())
    }
    fn save(&self, values: &BTreeMap<String, String>) -> Result<(), String> {
        let bytes = serde_json::to_vec(values).map_err(|_| "Unable to encode credentials")?;
        if bytes.len() > 1024 * 1024 {
            return Err("Credential file limit reached".into());
        }
        let mut temp = tempfile::NamedTempFile::new_in(&self.root)
            .map_err(|_| "Unable to stage credentials")?;
        temp.write_all(&bytes)
            .and_then(|_| temp.as_file().sync_all())
            .map_err(|_| "Unable to save credentials")?;
        temp.persist(self.root.join("credentials.json"))
            .map_err(|_| "Unable to commit credentials")?;
        Ok(())
    }
}

impl Credentials for LocalCredentials {
    fn get(&self, id: &str) -> Result<Option<String>, String> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| "Credential store unavailable")?;
        Ok(self.read()?.get(id).cloned())
    }
    fn set(&self, id: &str, key: &str) -> Result<(), String> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| "Credential store unavailable")?;
        let mut values = self.read()?;
        values.insert(id.into(), key.into());
        self.save(&values)
    }
    fn delete(&self, id: &str) -> Result<(), String> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| "Credential store unavailable")?;
        let mut values = self.read()?;
        values.remove(id);
        self.save(&values)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[test]
    fn refuses_linked_credential_paths() {
        let root = tempfile::tempdir().unwrap();
        let other = root.path().join("other");
        fs::create_dir(&other).unwrap();
        std::os::unix::fs::symlink(&other, root.path().join("linked")).unwrap();
        assert!(LocalCredentials::new(root.path().join("linked")).is_err());
        let store = LocalCredentials::new(root.path().join("private")).unwrap();
        fs::write(other.join("data"), "{}").unwrap();
        std::os::unix::fs::symlink(
            other.join("data"),
            root.path().join("private/credentials.json"),
        )
        .unwrap();
        assert!(store.set("a", "fixture").is_err());
        assert_eq!(fs::read_to_string(other.join("data")).unwrap(), "{}");
    }
    #[test]
    fn local_credentials_persist_update_and_delete_without_keychain() {
        let root = tempfile::tempdir().unwrap();
        let store = LocalCredentials::new(root.path().join("private")).unwrap();
        assert!(store.get("a").unwrap().is_none());
        store.set("a", "fixture-one").unwrap();
        store.set("b", "fixture-two").unwrap();
        store.set("a", "fixture-updated").unwrap();
        let reopened = LocalCredentials::new(root.path().join("private")).unwrap();
        assert_eq!(
            reopened.get("a").unwrap().as_deref(),
            Some("fixture-updated")
        );
        reopened.delete("a").unwrap();
        assert!(reopened.get("a").unwrap().is_none());
        assert!(reopened.get("b").unwrap().is_some());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(root.path().join("private"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
            assert_eq!(
                fs::metadata(root.path().join("private/credentials.json"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
    }
    #[test]
    fn corrupt_file_is_not_silently_overwritten() {
        let root = tempfile::tempdir().unwrap();
        let store = LocalCredentials::new(root.path().join("private")).unwrap();
        fs::write(root.path().join("private/credentials.json"), "corrupt").unwrap();
        assert!(store.set("a", "fixture").is_err());
        assert_eq!(
            fs::read_to_string(root.path().join("private/credentials.json")).unwrap(),
            "corrupt"
        );
    }
}
