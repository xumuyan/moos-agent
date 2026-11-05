use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::Mutex,
};

const MAX_FILES: usize = 256;
const MAX_TOTAL_BYTES: u64 = 5 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 1024 * 1024;
const MAX_ENTRY_BYTES: u64 = 512 * 1024;
const MAX_MANIFEST_BYTES: u64 = 256 * 1024;
const ALLOWED_PERMISSIONS: &[&str] = &[
    "ui:slots",
    "ui:notifications",
    "theme:read",
    "storage:private",
    "context:read",
];
const ALLOWED_SLOTS: &[&str] = &[
    "sidebar.primary",
    "sidebar.footer",
    "conversation.header",
    "conversation.message",
    "conversation.tool",
    "composer.leading",
    "composer.trailing",
    "rightPanel.tab",
    "settings.section",
    "usage.metric",
];

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPlugin {
    pub id: String,
    pub name: String,
    pub version: String,
    pub plugin_type: String,
    pub moos_version: String,
    pub entry: Option<String>,
    #[serde(default)]
    pub slots: Vec<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
    pub enabled: bool,
    pub manifest: Value,
}

#[derive(Default, Deserialize, Serialize)]
struct State {
    plugins: BTreeMap<String, LocalPlugin>,
    #[serde(default)]
    config: BTreeMap<String, Value>,
}

pub struct PluginManager {
    root: PathBuf,
    state: Mutex<State>,
}

impl PluginManager {
    pub fn new(root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(root.join("packages")).map_err(|_| "Unable to create plugin store")?;
        let state = match fs::read(root.join("state.json")) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "Invalid plugin state")?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => State::default(),
            Err(_) => return Err("Unable to read plugin state".into()),
        };
        Ok(Self {
            root,
            state: Mutex::new(state),
        })
    }

    pub fn list(&self) -> Result<Vec<LocalPlugin>, String> {
        Ok(self.lock()?.plugins.values().cloned().collect())
    }

    pub fn install(&self, source: &Path) -> Result<LocalPlugin, String> {
        let staging = tempfile::Builder::new()
            .prefix(".install-")
            .tempdir_in(&self.root)
            .map_err(|_| "Unable to create plugin staging directory")?;
        if source.is_dir() {
            copy_validated_directory(source, staging.path())?;
        } else if source
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("zip"))
        {
            extract_validated_zip(source, staging.path())?;
        } else {
            return Err("Plugin source must be a ZIP or directory".into());
        }
        let manifest = read_manifest(staging.path())?;
        let mut plugin = validate_manifest(manifest, staging.path())?;
        let target = self.root.join("packages").join(&plugin.id);
        let backup = self.root.join(format!(".backup-{}", plugin.id));
        if backup.exists() {
            fs::remove_dir_all(&backup).map_err(|_| "Unable to clear plugin backup")?;
        }
        if target.exists() {
            fs::rename(&target, &backup).map_err(|_| "Unable to prepare plugin upgrade")?;
        }
        let staged = staging.keep();
        if fs::rename(&staged, &target).is_err() {
            let _ = if backup.exists() {
                fs::rename(&backup, &target)
            } else {
                Ok(())
            };
            return Err("Unable to install plugin atomically".into());
        }
        let mut state = self.lock()?;
        plugin.enabled = state
            .plugins
            .get(&plugin.id)
            .map(|old| old.enabled)
            .unwrap_or(false);
        let previous = state.plugins.insert(plugin.id.clone(), plugin.clone());
        if let Err(error) = save_state(&self.root, &state) {
            if let Some(previous) = previous {
                state.plugins.insert(plugin.id.clone(), previous);
            } else {
                state.plugins.remove(&plugin.id);
            }
            let _ = fs::remove_dir_all(&target);
            let _ = if backup.exists() {
                fs::rename(&backup, &target)
            } else {
                Ok(())
            };
            return Err(error);
        }
        if backup.exists() {
            let _ = fs::remove_dir_all(backup);
        }
        Ok(plugin)
    }

    pub fn set_enabled(&self, id: &str, enabled: bool) -> Result<(), String> {
        validate_id(id)?;
        let mut state = self.lock()?;
        let plugin = state.plugins.get_mut(id).ok_or("Plugin not found")?;
        let previous = plugin.enabled;
        plugin.enabled = enabled;
        if let Err(error) = save_state(&self.root, &state) {
            state
                .plugins
                .get_mut(id)
                .expect("plugin remains present")
                .enabled = previous;
            return Err(error);
        }
        Ok(())
    }

    pub fn uninstall(&self, id: &str, clear_config: bool) -> Result<(), String> {
        validate_id(id)?;
        let target = self.root.join("packages").join(id);
        let trash = self.root.join(format!(".remove-{id}"));
        if trash.exists() {
            fs::remove_dir_all(&trash).map_err(|_| "Unable to clear plugin removal staging")?;
        }
        if target.exists() {
            fs::rename(&target, &trash).map_err(|_| "Unable to stage plugin removal")?;
        }
        let mut state = self.lock()?;
        let previous = state.plugins.remove(id).ok_or("Plugin not found")?;
        let old_config = if clear_config {
            state.config.remove(id)
        } else {
            None
        };
        if let Err(error) = save_state(&self.root, &state) {
            state.plugins.insert(id.to_owned(), previous);
            if let Some(config) = old_config {
                state.config.insert(id.to_owned(), config);
            }
            let _ = if trash.exists() {
                fs::rename(&trash, &target)
            } else {
                Ok(())
            };
            return Err(error);
        }
        if trash.exists() {
            fs::remove_dir_all(trash).map_err(|_| "Plugin removed but cleanup failed")?;
        }
        Ok(())
    }

    pub fn entry(&self, id: &str) -> Result<String, String> {
        validate_id(id)?;
        let state = self.lock()?;
        let plugin = state.plugins.get(id).ok_or("Plugin not found")?;
        if plugin.plugin_type != "ui" || !plugin.enabled {
            return Err("Plugin is not an enabled UI plugin".into());
        }
        let entry = plugin.entry.as_ref().ok_or("Plugin entry missing")?;
        let path = self.root.join("packages").join(id).join(entry);
        let bytes = fs::read(path).map_err(|_| "Unable to read plugin entry")?;
        if bytes.len() as u64 > MAX_ENTRY_BYTES {
            return Err("Plugin entry exceeds size limit".into());
        }
        String::from_utf8(bytes).map_err(|_| "Plugin entry must be UTF-8 JavaScript".into())
    }

    pub fn get_config(&self, id: &str) -> Result<Value, String> {
        validate_id(id)?;
        Ok(self
            .lock()?
            .config
            .get(id)
            .cloned()
            .unwrap_or_else(|| Value::Object(Default::default())))
    }

    pub fn set_config(&self, id: &str, value: Value) -> Result<(), String> {
        validate_id(id)?;
        let bytes = serde_json::to_vec(&value).map_err(|_| "Invalid plugin config")?;
        if bytes.len() > 32 * 1024 || !value.is_object() {
            return Err("Plugin config exceeds its private object limit".into());
        }
        let mut state = self.lock()?;
        if !state.plugins.contains_key(id) {
            return Err("Plugin not found".into());
        }
        let previous = state.config.insert(id.to_owned(), value);
        if let Err(error) = save_state(&self.root, &state) {
            if let Some(previous) = previous {
                state.config.insert(id.to_owned(), previous);
            } else {
                state.config.remove(id);
            }
            return Err(error);
        }
        Ok(())
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, State>, String> {
        self.state
            .lock()
            .map_err(|_| "Plugin store unavailable".into())
    }
}

fn save_state(root: &Path, state: &State) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(state).map_err(|_| "Unable to serialize plugin state")?;
    let temp = root.join("state.json.tmp");
    File::create(&temp)
        .and_then(|mut file| {
            file.write_all(&bytes)?;
            file.sync_all()
        })
        .map_err(|_| "Unable to persist plugin state")?;
    fs::rename(temp, root.join("state.json"))
        .map_err(|_| "Unable to commit plugin state".to_owned())
}

fn read_manifest(root: &Path) -> Result<Value, String> {
    let path = root.join("plugin.json");
    let metadata = fs::metadata(&path).map_err(|_| "plugin.json is required at package root")?;
    if metadata.len() > MAX_MANIFEST_BYTES {
        return Err("plugin.json exceeds size limit".into());
    }
    serde_json::from_slice(&fs::read(path).map_err(|_| "Unable to read plugin.json")?)
        .map_err(|_| "plugin.json must be valid JSON".into())
}

fn validate_manifest(manifest: Value, root: &Path) -> Result<LocalPlugin, String> {
    let object = manifest
        .as_object()
        .ok_or("plugin.json must be an object")?;
    let text = |key: &str| {
        object
            .get(key)
            .and_then(Value::as_str)
            .ok_or_else(|| format!("plugin.json requires {key}"))
    };
    let id = text("id")?.to_owned();
    validate_id(&id)?;
    let name = text("name")?.trim().to_owned();
    if name.is_empty() || name.len() > 100 {
        return Err("Invalid plugin name".into());
    }
    let version = text("version")?.to_owned();
    if !is_semver(&version) {
        return Err("Invalid plugin version".into());
    }
    let plugin_type = text("type")?.to_owned();
    if !matches!(plugin_type.as_str(), "ui" | "theme") {
        return Err("Invalid plugin type".into());
    }
    let moos_version = text("moosVersion")?.to_owned();
    if !matches!(moos_version.as_str(), "0.1.0" | "^0.1.0") {
        return Err("Plugin is not compatible with this Moos version".into());
    }
    let slots = strings(object.get("slots"), "slots")?;
    let permissions = strings(object.get("permissions"), "permissions")?;
    if slots
        .iter()
        .any(|slot| !ALLOWED_SLOTS.contains(&slot.as_str()))
    {
        return Err("Unknown plugin slot".into());
    }
    if permissions
        .iter()
        .any(|permission| !ALLOWED_PERMISSIONS.contains(&permission.as_str()))
    {
        return Err("Unknown plugin permission".into());
    }
    if slots.len() != unique_len(&slots) || permissions.len() != unique_len(&permissions) {
        return Err("Duplicate plugin declaration".into());
    }
    let entry = if plugin_type == "ui" {
        if slots.is_empty() || !permissions.iter().any(|value| value == "ui:slots") {
            return Err("UI plugin requires declared slots and ui:slots permission".into());
        }
        let entry = text("entry")?;
        let path = safe_relative(entry)?;
        if path.extension().and_then(|value| value.to_str()) != Some("js") {
            return Err("UI plugin entry must be JavaScript".into());
        }
        let metadata = fs::metadata(root.join(&path)).map_err(|_| "Plugin entry does not exist")?;
        if !metadata.is_file() || metadata.len() > MAX_ENTRY_BYTES {
            return Err("Invalid plugin entry size".into());
        }
        Some(path.to_string_lossy().into_owned())
    } else {
        if !slots.is_empty() || !permissions.is_empty() || object.get("entry").is_some() {
            return Err("Theme packages cannot execute code or declare permissions".into());
        }
        for key in ["tokens", "styles", "assets"] {
            if !object.get(key).is_some_and(Value::is_object) {
                return Err(format!("Theme requires {key}"));
            }
        }
        validate_theme(object)?;
        None
    };
    Ok(LocalPlugin {
        id,
        name,
        version,
        plugin_type,
        moos_version,
        entry,
        slots,
        permissions,
        enabled: false,
        manifest,
    })
}

fn validate_theme(object: &serde_json::Map<String, Value>) -> Result<(), String> {
    const TOKENS: &[&str] = &[
        "accent",
        "accentSoft",
        "border",
        "panel",
        "sidebar",
        "muted",
        "radius",
        "rightPanelWidth",
    ];
    const REGIONS: &[&str] = &["sidebar", "conversation", "composer", "rightPanel"];
    const PROPERTIES: &[&str] = &["backgroundColor", "color", "borderColor", "backgroundAsset"];
    let tokens = object["tokens"].as_object().ok_or("Invalid theme tokens")?;
    for (key, value) in tokens {
        let text = value.as_str().ok_or("Invalid theme token value")?;
        if !TOKENS.contains(&key.as_str())
            || text.len() > 64
            || text.bytes().any(|byte| matches!(byte, b';' | b'{' | b'}'))
        {
            return Err("Unsafe theme token".into());
        }
        if matches!(key.as_str(), "radius" | "rightPanelWidth") && !valid_px(text) {
            return Err("Invalid theme dimension".into());
        }
        if !matches!(key.as_str(), "radius" | "rightPanelWidth") && !valid_color(text) {
            return Err("Invalid theme color".into());
        }
    }
    let assets = object["assets"].as_object().ok_or("Invalid theme assets")?;
    for (key, value) in assets {
        let text = value.as_str().ok_or("Invalid theme asset")?;
        if key.is_empty()
            || key.len() > 40
            || !key
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
            || text.len() > 131_072
            || !(text.starts_with("data:image/png;base64,")
                || text.starts_with("data:image/jpeg;base64,")
                || text.starts_with("data:image/webp;base64,"))
            || !text.split_once(',').is_some_and(|(_, data)| {
                !data.is_empty()
                    && data.bytes().all(|byte| {
                        byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'=')
                    })
            })
        {
            return Err("Unsafe theme asset".into());
        }
    }
    let styles = object["styles"].as_object().ok_or("Invalid theme styles")?;
    for (region, value) in styles {
        if !REGIONS.contains(&region.as_str()) {
            return Err("Unknown theme region".into());
        }
        let style = value.as_object().ok_or("Invalid theme style")?;
        for (property, value) in style {
            let text = value.as_str().ok_or("Invalid theme style value")?;
            if !PROPERTIES.contains(&property.as_str())
                || (property == "backgroundAsset" && !assets.contains_key(text))
                || (property != "backgroundAsset" && !valid_color(text))
            {
                return Err("Unsafe theme style".into());
            }
        }
    }
    Ok(())
}

fn valid_px(value: &str) -> bool {
    value
        .strip_suffix("px")
        .and_then(|number| number.parse::<u16>().ok())
        .is_some_and(|number| number <= 299)
}
fn valid_color(value: &str) -> bool {
    value.strip_prefix('#').is_some_and(|hex| {
        matches!(hex.len(), 3 | 4 | 6 | 8) && hex.bytes().all(|byte| byte.is_ascii_hexdigit())
    }) || ["rgb(", "rgba("].iter().any(|prefix| {
        value.starts_with(prefix)
            && value.ends_with(')')
            && value[prefix.len()..value.len() - 1]
                .bytes()
                .all(|byte| byte.is_ascii_digit() || matches!(byte, b' ' | b',' | b'.' | b'%'))
    })
}

fn strings(value: Option<&Value>, name: &str) -> Result<Vec<String>, String> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let items = value.as_array().ok_or_else(|| format!("Invalid {name}"))?;
    items
        .iter()
        .map(|item| {
            item.as_str()
                .map(str::to_owned)
                .ok_or_else(|| format!("Invalid {name}"))
        })
        .collect()
}

fn unique_len(values: &[String]) -> usize {
    values
        .iter()
        .collect::<std::collections::BTreeSet<_>>()
        .len()
}
fn is_semver(value: &str) -> bool {
    value.split('.').count() == 3
        && value
            .split('.')
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
}
fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 100
        || !id.contains('.')
        || !id.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'-')
        })
        || id
            .split('.')
            .any(|part| part.is_empty() || !part.as_bytes()[0].is_ascii_lowercase())
    {
        return Err("Invalid plugin id".into());
    }
    Ok(())
}
fn safe_relative(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
    if path.as_os_str().is_empty()
        || path.is_absolute()
        || path.components().count() > 8
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("Unsafe plugin path".into());
    }
    Ok(path.to_owned())
}

fn copy_validated_directory(source: &Path, target: &Path) -> Result<(), String> {
    fn visit(
        source: &Path,
        target: &Path,
        count: &mut usize,
        total: &mut u64,
        depth: usize,
    ) -> Result<(), String> {
        if depth > 8 {
            return Err("Plugin directory path is too deep".into());
        }
        for entry in fs::read_dir(source).map_err(|_| "Unable to read plugin directory")? {
            let entry = entry.map_err(|_| "Unable to read plugin directory entry")?;
            let metadata =
                fs::symlink_metadata(entry.path()).map_err(|_| "Unable to inspect plugin file")?;
            if metadata.file_type().is_symlink() {
                return Err("Plugin links are not allowed".into());
            }
            let destination = target.join(entry.file_name());
            if metadata.is_dir() {
                fs::create_dir_all(&destination).map_err(|_| "Unable to stage plugin directory")?;
                visit(&entry.path(), &destination, count, total, depth + 1)?;
            } else if metadata.is_file() {
                *count += 1;
                *total = total.saturating_add(metadata.len());
                if *count > MAX_FILES || metadata.len() > MAX_FILE_BYTES || *total > MAX_TOTAL_BYTES
                {
                    return Err("Plugin package exceeds file limits".into());
                }
                #[cfg(unix)]
                {
                    use std::os::unix::fs::MetadataExt;
                    if metadata.nlink() > 1 || metadata.mode() & 0o111 != 0 {
                        return Err("Plugin links and executable files are not allowed".into());
                    }
                }
                let bytes = fs::read(entry.path()).map_err(|_| "Unable to read plugin file")?;
                reject_executable(&bytes)?;
                fs::write(destination, bytes).map_err(|_| "Unable to stage plugin file")?;
            } else {
                return Err("Unsupported plugin file type".into());
            }
        }
        Ok(())
    }
    let mut count = 0;
    let mut total = 0;
    visit(source, target, &mut count, &mut total, 0)
}

fn extract_validated_zip(source: &Path, target: &Path) -> Result<(), String> {
    let file = File::open(source).map_err(|_| "Unable to open plugin ZIP")?;
    let mut archive = zip::ZipArchive::new(file).map_err(|_| "Invalid plugin ZIP")?;
    if archive.len() > MAX_FILES {
        return Err("Plugin ZIP contains too many files".into());
    }
    let mut total = 0u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|_| "Unable to inspect plugin ZIP entry")?;
        let path = entry
            .enclosed_name()
            .ok_or("Plugin ZIP contains an unsafe path")?;
        if path.components().count() > 8 {
            return Err("Plugin ZIP path is too deep".into());
        }
        if entry.is_symlink() || !entry.is_file() && !entry.is_dir() {
            return Err("Plugin ZIP links are not allowed".into());
        }
        if entry.unix_mode().is_some_and(|mode| {
            mode & 0o170000 != 0 && mode & 0o170000 != 0o100000 && mode & 0o170000 != 0o040000
                || mode & 0o111 != 0
        }) {
            return Err("Plugin ZIP executable or linked entries are not allowed".into());
        }
        if entry.is_dir() {
            fs::create_dir_all(target.join(path))
                .map_err(|_| "Unable to stage plugin ZIP directory")?;
            continue;
        }
        total = total.saturating_add(entry.size());
        if entry.size() > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES {
            return Err("Plugin ZIP exceeds size limits".into());
        }
        if entry.compressed_size() > 0 && entry.size() / entry.compressed_size().max(1) > 100 {
            return Err("Plugin ZIP compression ratio exceeds limit".into());
        }
        let output = target.join(path);
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent).map_err(|_| "Unable to stage plugin ZIP")?;
        }
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        (&mut entry)
            .take(MAX_FILE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Unable to extract plugin ZIP entry")?;
        if bytes.len() as u64 != entry.size() {
            return Err("Plugin ZIP entry size mismatch".into());
        }
        reject_executable(&bytes)?;
        fs::write(output, bytes).map_err(|_| "Unable to write plugin ZIP entry")?;
    }
    Ok(())
}

fn reject_executable(bytes: &[u8]) -> Result<(), String> {
    let executable = bytes.starts_with(b"#!")
        || bytes.starts_with(b"\x7fELF")
        || bytes.starts_with(b"MZ")
        || bytes.starts_with(&[0xfe, 0xed, 0xfa, 0xce])
        || bytes.starts_with(&[0xfe, 0xed, 0xfa, 0xcf])
        || bytes.starts_with(&[0xcf, 0xfa, 0xed, 0xfe])
        || bytes.starts_with(&[0xca, 0xfe, 0xba, 0xbe]);
    if executable {
        Err("Native executables and script entrypoints are not allowed".into())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn manifest(version: &str) -> String {
        format!(
            r#"{{"id":"dev.example.local","name":"Local","version":"{version}","type":"ui","moosVersion":"^0.1.0","entry":"main.js","slots":["composer.trailing"],"permissions":["ui:slots"]}}"#
        )
    }
    fn package(root: &Path, version: &str) {
        fs::create_dir_all(root).unwrap();
        fs::write(root.join("plugin.json"), manifest(version)).unwrap();
        fs::write(
            root.join("main.js"),
            "moos.registerSlot('composer.trailing', () => ({type:'text', text:'ok'}));",
        )
        .unwrap();
    }

    #[test]
    fn directory_install_enable_upgrade_and_uninstall_preserve_or_clear_private_config() {
        let data = tempfile::tempdir().unwrap();
        let first = tempfile::tempdir().unwrap();
        package(first.path(), "1.0.0");
        let manager = PluginManager::new(data.path().join("plugins")).unwrap();
        assert!(!manager.install(first.path()).unwrap().enabled);
        manager.set_enabled("dev.example.local", true).unwrap();
        manager
            .set_config("dev.example.local", serde_json::json!({"choice":"safe"}))
            .unwrap();
        let second = tempfile::tempdir().unwrap();
        package(second.path(), "1.1.0");
        assert!(manager.install(second.path()).unwrap().enabled);
        assert!(manager
            .entry("dev.example.local")
            .unwrap()
            .contains("registerSlot"));
        manager.uninstall("dev.example.local", false).unwrap();
        assert_eq!(
            manager.get_config("dev.example.local").unwrap()["choice"],
            "safe"
        );
        package(second.path(), "1.2.0");
        manager.install(second.path()).unwrap();
        manager.uninstall("dev.example.local", true).unwrap();
        assert_eq!(
            manager.get_config("dev.example.local").unwrap(),
            serde_json::json!({})
        );
    }

    #[test]
    fn rejects_links_executables_oversize_and_invalid_upgrade_without_replacing_current() {
        let data = tempfile::tempdir().unwrap();
        let good = tempfile::tempdir().unwrap();
        package(good.path(), "1.0.0");
        let manager = PluginManager::new(data.path().join("plugins")).unwrap();
        manager.install(good.path()).unwrap();
        let bad = tempfile::tempdir().unwrap();
        package(bad.path(), "2.0.0");
        fs::write(bad.path().join("main.js"), b"\x7fELFbad").unwrap();
        assert!(manager
            .install(bad.path())
            .unwrap_err()
            .contains("executable"));
        assert_eq!(manager.list().unwrap()[0].version, "1.0.0");
        let large = tempfile::tempdir().unwrap();
        package(large.path(), "2.0.0");
        fs::write(
            large.path().join("large.bin"),
            vec![0; MAX_FILE_BYTES as usize + 1],
        )
        .unwrap();
        assert!(manager
            .install(large.path())
            .unwrap_err()
            .contains("limits"));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(good.path().join("main.js"), bad.path().join("link.js"))
                .unwrap();
            assert!(manager.install(bad.path()).unwrap_err().contains("links"));
        }
    }

    #[test]
    fn zip_rejects_traversal_symlink_bomb_many_files_and_native_payload() {
        fn zip_with(entries: Vec<(&str, &[u8], u32)>) -> tempfile::NamedTempFile {
            let file = tempfile::NamedTempFile::new().unwrap();
            {
                let mut writer = zip::ZipWriter::new(file.reopen().unwrap());
                for (name, bytes, mode) in entries {
                    writer
                        .start_file(name, SimpleFileOptions::default().unix_permissions(mode))
                        .unwrap();
                    writer.write_all(bytes).unwrap();
                }
                writer.finish().unwrap();
            }
            file
        }
        let target = tempfile::tempdir().unwrap();
        let traversal = zip_with(vec![("../escape", b"x", 0o644)]);
        assert!(extract_validated_zip(traversal.path(), target.path()).is_err());
        let link = tempfile::NamedTempFile::new().unwrap();
        {
            let mut writer = zip::ZipWriter::new(link.reopen().unwrap());
            writer
                .add_symlink("link", "target", SimpleFileOptions::default())
                .unwrap();
            writer.finish().unwrap();
        }
        assert!(extract_validated_zip(link.path(), target.path())
            .unwrap_err()
            .contains("links"));
        let executable = zip_with(vec![("payload", b"\x7fELFbad", 0o644)]);
        assert!(extract_validated_zip(executable.path(), target.path())
            .unwrap_err()
            .contains("executables"));
        let bomb = zip_with(vec![("bomb.bin", &vec![0; MAX_FILE_BYTES as usize], 0o644)]);
        assert!(extract_validated_zip(bomb.path(), target.path())
            .unwrap_err()
            .contains("ratio"));
        let names: Vec<String> = (0..=MAX_FILES)
            .map(|index| format!("{index}.txt"))
            .collect();
        let refs = names
            .iter()
            .map(|name| (name.as_str(), b"x".as_slice(), 0o644))
            .collect();
        let many = zip_with(refs);
        assert!(extract_validated_zip(many.path(), target.path())
            .unwrap_err()
            .contains("many"));
    }

    #[test]
    fn theme_packages_reject_code_remote_assets_and_unsafe_css_shapes() {
        let root = tempfile::tempdir().unwrap();
        let base = serde_json::json!({"id":"dev.example.theme","name":"Theme","version":"1.0.0","type":"theme","moosVersion":"^0.1.0","slots":[],"permissions":[],"tokens":{"accent":"#123456"},"styles":{"sidebar":{"backgroundColor":"#ffffff"}},"assets":{}});
        assert_eq!(
            validate_manifest(base.clone(), root.path())
                .unwrap()
                .plugin_type,
            "theme"
        );
        let mut remote = base.clone();
        remote["assets"] = serde_json::json!({"bg":"https://evil.test/a.png"});
        assert!(validate_manifest(remote, root.path())
            .unwrap_err()
            .contains("asset"));
        let mut global = base.clone();
        global["styles"] = serde_json::json!({"body":{"color":"#fff"}});
        assert!(validate_manifest(global, root.path())
            .unwrap_err()
            .contains("region"));
        let mut code = base;
        code["entry"] = Value::String("main.js".into());
        assert!(validate_manifest(code, root.path())
            .unwrap_err()
            .contains("execute"));
    }

    #[test]
    fn rejects_non_array_declarations_and_rolls_back_failed_state_writes() {
        let malformed = serde_json::json!({"id":"dev.example.local","name":"Local","version":"1.0.0","type":"ui","moosVersion":"^0.1.0","entry":"main.js","slots":"composer.trailing","permissions":["ui:slots"]});
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("main.js"), "safe").unwrap();
        assert!(validate_manifest(malformed, root.path())
            .unwrap_err()
            .contains("slots"));

        let data = tempfile::tempdir().unwrap();
        let package_root = tempfile::tempdir().unwrap();
        package(package_root.path(), "1.0.0");
        let manager = PluginManager::new(data.path().join("plugins")).unwrap();
        manager.install(package_root.path()).unwrap();
        fs::create_dir(data.path().join("plugins/state.json.tmp")).unwrap();
        assert!(manager.set_enabled("dev.example.local", true).is_err());
        assert!(!manager.list().unwrap()[0].enabled);
        assert!(manager
            .set_config("dev.example.local", serde_json::json!({"x": 1}))
            .is_err());
        assert_eq!(
            manager.get_config("dev.example.local").unwrap(),
            serde_json::json!({})
        );
    }
}
