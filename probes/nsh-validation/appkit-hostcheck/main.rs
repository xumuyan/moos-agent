//! Local AppKit TSX probe using a private PI fixture transport.

use nsh_engine::{HostCall, HostChannel};
use nsh_platform_macos::{ActivationPolicy, AppOptions, AppSource, Bundle, run_app};
use serde_json::Value;
use std::{ffi::{CString, c_char, c_void}, slice, sync::atomic::{AtomicBool, AtomicUsize, Ordering::SeqCst}, process::ExitCode};

const METHODS: [&str; 6] = ["projects.list", "sessions.list", "sessions.create", "tasks.submit", "tasks.cancel", "tasks.events"];
static PENDING: AtomicUsize = AtomicUsize::new(0);
static PASSED: AtomicBool = AtomicBool::new(false);
unsafe extern "C" {
    fn n01_pipe_start() -> bool;
    fn n01_pipe_call(method: *const c_char, bytes: *const u8, count: usize, ctx: *mut c_void,
        reply: unsafe extern "C" fn(*mut c_void, *const u8, usize));
    fn n01_pipe_finish() -> bool;
}
unsafe extern "C" fn resolve(ctx: *mut c_void, bytes: *const u8, count: usize) {
    // SAFETY: Swift calls back exactly once with the Box pointer we gave it.
    let call = unsafe { *Box::from_raw(ctx.cast::<HostCall>()) };
    PENDING.fetch_sub(1, SeqCst);
    if !bytes.is_null() && count <= 524287 {
        // SAFETY: The callback borrows a Swift buffer for the duration of this call.
        if let Ok(value @ Value::Object(_)) = serde_json::from_slice(unsafe { slice::from_raw_parts(bytes, count) }) {
            call.resolve(value);
            return;
        }
    }
    call.reject("desktop unavailable");
}
fn forward(call: HostCall, method: &CString) {
    if call.is_post() { return; }
    if !call.data().is_object() { call.reject("invalid parameters"); return; }
    let Ok(body) = serde_json::to_vec(call.data()) else { call.reject("invalid parameters"); return };
    if body.len() > 16384 || PENDING.try_update(SeqCst, SeqCst, |n| (n < 32).then_some(n + 1)).is_err() {
        call.reject("desktop unavailable"); return;
    }
    // SAFETY: Swift copies the borrowed bytes before returning and owns the reply context.
    unsafe { n01_pipe_call(method.as_ptr(), body.as_ptr(), body.len(), Box::into_raw(Box::new(call)).cast(), resolve) };
}
fn main() -> ExitCode {
    let mut logging = nsh_platform_apple::unified_log::Options::default();
    logging.development = true;
    nsh_platform_apple::unified_log::install(logging);
    let root = std::env::current_exe().expect("executable");
    let root = root.parent().unwrap();
    let Ok(bundle) = Bundle::read(&root.join("tsx/build/bundle.js")) else { eprintln!("N01 bundle unavailable"); return ExitCode::FAILURE };
    // SAFETY: The executable starts the Swift pipe on the AppKit owner thread.
    if !unsafe { n01_pipe_start() } { eprintln!("N01 pipe unavailable"); return ExitCode::FAILURE; }
    let host = HostChannel::new();
    for name in METHODS {
        let method = CString::new(name).unwrap();
        host.handle(name, move |call| forward(call, &method));
    }
    host.handle("n01.complete", |call| {
        if call.is_post() { return }
        if call.data() != &Value::Bool(true) { call.reject("incomplete"); return }
        PASSED.store(true, SeqCst);
        call.resolve(Value::Null);
    });
    let app_exit = run_app(AppSource::Bundle(bundle), AppOptions {
        host: host.clone(), data_dir: Some(root.join("private-nsh")),
        background: true, activation_policy: ActivationPolicy::Accessory, size: (430, 180),
        title: "N01 AppKit TSX PI probe".into(), ..AppOptions::default()
    });
    for name in METHODS { host.remove_handler(name); }
    host.remove_handler("n01.complete");
    // SAFETY: The AppKit runner has returned on the owner thread.
    let clean = unsafe { n01_pipe_finish() };
    if app_exit == ExitCode::SUCCESS && PASSED.load(SeqCst) && clean && PENDING.load(SeqCst) == 0 { ExitCode::SUCCESS } else { ExitCode::FAILURE }
}
