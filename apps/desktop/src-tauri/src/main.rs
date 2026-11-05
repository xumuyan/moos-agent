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

#[tauri::command]
async fn agent_request(
    method: String,
    params: Value,
    state: State<'_, SharedAgent>,
) -> Result<Value, String> {
    // Never block the WebView/main event loop with stdio or Keychain operations.
    if !moos_desktop::protocol::allowed_method(&method) {
        return Err("Invalid agent request".into());
    }
    let agent = state.inner().clone();
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
            app.manage(
                Arc::new(Mutex::new(Some(Agent::new(host, Box::new(NativeKeychain)))))
                    as SharedAgent,
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![agent_request])
        .build(tauri::generate_context!())
        .expect("Unable to initialize Moos desktop");
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            if let Some(state) = app.try_state::<SharedAgent>() {
                if let Ok(mut guard) = state.lock() {
                    if let Some(mut agent) = guard.take() {
                        agent.shutdown();
                    }
                }
            }
        }
    });
}
