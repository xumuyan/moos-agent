#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use moos_desktop::{
    host::{dev_paths, Host},
    keychain::NativeKeychain,
    Agent,
};
use serde_json::Value;
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};

type SharedAgent = Arc<Mutex<Option<Agent>>>;
struct DiagnosticAgent(SharedAgent);

#[tauri::command]
async fn agent_request(
    method: String,
    params: Value,
    state: State<'_, SharedAgent>,
    diagnostics: State<'_, DiagnosticAgent>,
) -> Result<Value, String> {
    // Never block the WebView/main event loop with stdio or Keychain operations.
    if !moos_desktop::protocol::allowed_method(&method) {
        return Err("Invalid agent request".into());
    }
    let agent = if matches!(method.as_str(), "list_models" | "test_provider") {
        diagnostics.0.clone()
    } else {
        state.inner().clone()
    };
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = agent.lock().map_err(|_| "Agent state unavailable")?;
        guard
            .as_mut()
            .ok_or("Agent is shutting down")?
            .request(&method, params)
    })
    .await
    .map_err(|_| "Agent request interrupted".to_owned())?
}

#[tauri::command]
async fn pick_directory() -> Option<String> {
    rfd::AsyncFileDialog::new()
        .set_title("选择项目目录")
        .pick_folder()
        .await
        .map(|folder| folder.path().to_string_lossy().into_owned())
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
            let diagnostic_host = Host::launch_diagnostics(&node, &entry, &runtime, &data)
                .map_err(std::io::Error::other)?;
            app.manage(DiagnosticAgent(Arc::new(Mutex::new(Some(Agent::new(
                diagnostic_host,
                Box::new(NativeKeychain),
            ))))));
            app.manage(
                Arc::new(Mutex::new(Some(Agent::new(host, Box::new(NativeKeychain)))))
                    as SharedAgent,
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![agent_request, pick_directory])
        .build(tauri::generate_context!())
        .expect("Unable to initialize Moos desktop");
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let regular = app
                .try_state::<SharedAgent>()
                .map(|state| state.inner().clone());
            let diagnostics = app
                .try_state::<DiagnosticAgent>()
                .map(|state| state.0.clone());
            for state in [regular, diagnostics].into_iter().flatten() {
                if let Ok(mut guard) = state.lock() {
                    if let Some(mut agent) = guard.take() {
                        agent.shutdown();
                    }
                }
            }
        }
    });
}
