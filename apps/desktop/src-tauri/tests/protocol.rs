use moos_desktop::protocol::{allowed_method, public_params, response};
use serde_json::json;

#[test]
fn only_public_controller_commands_are_allowed() {
    for method in [
        "snapshot",
        "save_provider",
        "remove_provider",
        "add_project",
        "remove_project",
        "create_conversation",
        "submit",
        "cancel",
        "list_models",
        "test_provider",
        "set_task_policy",
        "get_usage",
        "export_usage",
        "clear_usage",
    ] {
        assert!(allowed_method(method), "{method}");
    }
    for method in [
        "shutdown",
        "exec",
        "shell",
        "read_file",
        "get_api_key",
        "",
        "constructor",
    ] {
        assert!(!allowed_method(method), "{method}");
    }
}

#[test]
fn save_extracts_key_and_recursively_removes_public_credentials() {
    let (params, key) = public_params("save_provider", json!({"apiKey":"secret", "provider":{"id":"glm", "apiKey":"nested", "authorization":"Bearer key", "model":"glm"}})).unwrap();
    assert_eq!(key.as_deref(), Some("secret"));
    assert_eq!(params, json!({"provider":{"id":"glm", "model":"glm"}}));
    assert!(public_params(
        "save_provider",
        json!({"apiKey":"", "provider":{"id":"glm"}})
    )
    .is_err());
}

#[test]
fn diagnostics_extract_only_the_explicit_draft_key() {
    for method in ["list_models", "test_provider"] {
        let (params, key) = public_params(
            method,
            json!({"apiKey":"draft-key", "provider":{"id":"saved", "apiKey":"nested"}}),
        )
        .unwrap();
        assert_eq!(key.as_deref(), Some("draft-key"));
        assert_eq!(params, json!({"provider":{"id":"saved"}}));
        let (_, key) = public_params(method, json!({"provider":{"id":"saved"}})).unwrap();
        assert!(key.is_none());
    }
}

#[test]
fn untrusted_submit_cannot_inject_credentials() {
    let (params, key) =
        public_params("submit", json!({"providerId":"glm", "apiKey":"injected"})).unwrap();
    assert_eq!(params, json!({"providerId":"glm"}));
    assert!(key.is_none());
    assert!(public_params("exec", json!({})).is_err());
    assert!(public_params("snapshot", json!([])).is_err());
}

#[test]
fn responses_require_matching_id_and_exactly_one_outcome() {
    assert_eq!(
        response(r#"{"id":7,"result":{"ok":true}}"#, 7).unwrap(),
        json!({"ok":true})
    );
    for line in [
        r#"{"id":8,"result":true}"#,
        r#"{"id":7}"#,
        r#"{"id":7,"result":true,"error":"oops"}"#,
        "not json",
    ] {
        assert!(response(line, 7).is_err(), "{line}");
    }
    let error = response(r#"{"id":7,"error":"secret raw host failure"}"#, 7).unwrap_err();
    assert!(!error.contains("secret"));
}

#[test]
fn responses_strip_credentials_from_snapshots() {
    assert_eq!(
        response(
            r#"{"id":1,"result":{"providers":[{"id":"glm","apiKey":"secret","token":"secret"}]}}"#,
            1
        )
        .unwrap(),
        json!({"providers":[{"id":"glm"}]})
    );
}
