#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use moos_desktop::{
    host::{dev_paths, Host},
    local_credentials::LocalCredentials,
    plugins::{LocalPlugin, PluginManager},
    Agent,
};
use serde_json::Value;
use std::sync::Arc;
use tauri::{Manager, State};

type SharedAgent = Arc<Agent>;
type SharedPlugins = Arc<PluginManager>;
type SharedTerminals = Arc<moos_desktop::pty::TerminalManager>;

#[tauri::command]
async fn agent_request(
    method: String,
    params: Value,
    state: State<'_, SharedAgent>,
    terminals: State<'_, SharedTerminals>,
) -> Result<Value, String> {
    // Never block the WebView/main event loop with stdio or Keychain operations.
    if !moos_desktop::protocol::allowed_method(&method) {
        return Err("Invalid agent request".into());
    }
    let agent = state.inner().clone();
    let terminals = terminals.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if method == "remove_project" {
            let project = params["projectId"].as_str().ok_or("项目标识无效")?;
            terminals.close_project(Some(project))?;
        }
        agent.request(&method, params)
    })
    .await
    .map_err(|_| "Agent request interrupted".to_owned())?
}

#[tauri::command]
async fn terminal_request(
    action: String,
    params: Value,
    state: State<'_, SharedTerminals>,
) -> Result<Value, String> {
    let terminals = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || terminals.request(&action, params))
        .await
        .map_err(|_| "终端请求中断".to_owned())?
}

#[tauri::command]
async fn pick_directory() -> Option<String> {
    rfd::AsyncFileDialog::new()
        .set_title("选择项目目录")
        .pick_folder()
        .await
        .map(|folder| folder.path().to_string_lossy().into_owned())
}

#[tauri::command]
async fn pick_plugin_zip() -> Option<String> {
    rfd::AsyncFileDialog::new()
        .set_title("选择本地插件 ZIP")
        .add_filter("Moos 插件", &["zip"])
        .pick_file()
        .await
        .map(|file| file.path().to_string_lossy().into_owned())
}

#[tauri::command]
async fn pick_plugin_folder() -> Option<String> {
    rfd::AsyncFileDialog::new()
        .set_title("选择本地插件文件夹")
        .pick_folder()
        .await
        .map(|folder| folder.path().to_string_lossy().into_owned())
}

#[tauri::command]
async fn list_local_plugins(state: State<'_, SharedPlugins>) -> Result<Vec<LocalPlugin>, String> {
    state.list()
}

#[tauri::command]
async fn install_local_plugin(
    path: String,
    state: State<'_, SharedPlugins>,
) -> Result<LocalPlugin, String> {
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager.install(std::path::Path::new(&path)))
        .await
        .map_err(|_| "Plugin installation interrupted".to_owned())?
}

#[tauri::command]
async fn set_local_plugin_enabled(
    id: String,
    enabled: bool,
    state: State<'_, SharedPlugins>,
) -> Result<(), String> {
    state.set_enabled(&id, enabled)
}

#[tauri::command]
async fn uninstall_local_plugin(
    id: String,
    clear_config: bool,
    state: State<'_, SharedPlugins>,
) -> Result<(), String> {
    state.uninstall(&id, clear_config)
}

#[tauri::command]
async fn load_local_plugin_entry(
    id: String,
    state: State<'_, SharedPlugins>,
) -> Result<String, String> {
    state.entry(&id)
}

#[tauri::command]
async fn get_local_plugin_config(
    id: String,
    state: State<'_, SharedPlugins>,
) -> Result<Value, String> {
    state.get_config(&id)
}

#[tauri::command]
async fn set_local_plugin_config(
    id: String,
    value: Value,
    state: State<'_, SharedPlugins>,
) -> Result<(), String> {
    state.set_config(&id, value)
}

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data)?;
            let (node, entry, runtime) = if cfg!(debug_assertions) {
                dev_paths().map_err(std::io::Error::other)?
            } else {
                let resources = app.path().resource_dir()?;
                (
                    std::env::current_exe()?.with_file_name("node"),
                    resources.join("services/agent/main.mjs"),
                    resources.join("runtime"),
                )
            };
            let host =
                Host::launch(&node, &entry, &runtime, &data).map_err(std::io::Error::other)?;
            let credentials =
                LocalCredentials::new(data.join("private")).map_err(std::io::Error::other)?;
            let agent = Arc::new(Agent::new(host, Box::new(credentials))) as SharedAgent;
            app.manage(
                Arc::new(moos_desktop::pty::TerminalManager::new(agent.clone())) as SharedTerminals,
            );
            app.manage(agent);
            app.manage(Arc::new(
                PluginManager::new(data.join("plugins")).map_err(std::io::Error::other)?,
            ) as SharedPlugins);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            agent_request,
            terminal_request,
            pick_directory,
            pick_plugin_zip,
            pick_plugin_folder,
            list_local_plugins,
            install_local_plugin,
            set_local_plugin_enabled,
            uninstall_local_plugin,
            load_local_plugin_entry,
            get_local_plugin_config,
            set_local_plugin_config
        ])
        .build(tauri::generate_context!())
        .expect("Unable to initialize Moos desktop");
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            if let Some(agent) = app.try_state::<SharedAgent>() {
                agent.shutdown();
            }
            // Stop queued tasks before releasing terminal locks during app exit.
            if let Some(terminals) = app.try_state::<SharedTerminals>() {
                terminals.shutdown();
            }
        }
    });
}
