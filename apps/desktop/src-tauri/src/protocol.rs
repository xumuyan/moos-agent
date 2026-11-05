use serde_json::Value;

pub fn allowed_method(method: &str) -> bool {
    matches!(
        method,
        "snapshot"
            | "save_provider"
            | "remove_provider"
            | "add_project"
            | "remove_project"
            | "create_conversation"
            | "submit"
            | "cancel"
            | "list_models"
            | "test_provider"
    )
}

pub fn redact(value: &mut Value) {
    match value {
        Value::Object(map) => {
            map.retain(|key, _| {
                !matches!(
                    key.to_ascii_lowercase().replace(['_', '-'], "").as_str(),
                    "apikey"
                        | "token"
                        | "authorization"
                        | "password"
                        | "secret"
                        | "accesstoken"
                        | "refreshtoken"
                )
            });
            for child in map.values_mut() {
                redact(child);
            }
        }
        Value::Array(items) => items.iter_mut().for_each(redact),
        _ => {}
    }
}

pub fn public_params(method: &str, mut params: Value) -> Result<(Value, Option<String>), String> {
    if !allowed_method(method) || !params.is_object() {
        return Err("Invalid agent request".into());
    }
    let key = if matches!(method, "save_provider" | "list_models" | "test_provider") {
        match params.get("apiKey") {
            Some(Value::String(key)) if !key.trim().is_empty() => Some(key.clone()),
            Some(_) => return Err(
                "API key must be a nonempty string; remove the provider to delete its credential"
                    .into(),
            ),
            None => None,
        }
    } else {
        None
    };
    redact(&mut params);
    Ok((params, key))
}

pub fn provider_id<'a>(params: &'a Value, field: &str) -> Result<&'a str, String> {
    let id = params
        .pointer(field)
        .and_then(Value::as_str)
        .ok_or("Provider ID required")?;
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
    {
        return Err("Invalid provider ID".into());
    }
    Ok(id)
}

pub fn response(line: &str, id: u64) -> Result<Value, String> {
    let mut value: Value = serde_json::from_str(line).map_err(|_| "Invalid agent response")?;
    if value.get("id").and_then(Value::as_u64) != Some(id)
        || value.get("result").is_some() == value.get("error").is_some()
    {
        return Err("Invalid agent response".into());
    }
    if value.get("error").is_some() {
        return Err("Agent request failed".into());
    }
    let mut result = value["result"].take();
    redact(&mut result);
    Ok(result)
}
