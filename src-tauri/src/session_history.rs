use crate::error::{AppError, AppResult};
use serde_json::{json, Value};
use std::fs;
use std::path::Path;

/// Rewrite assistant text in an OMP session JSONL file.
/// Matches by `message.responseId` when provided, otherwise the latest assistant message.
pub fn rewrite_assistant_text(
    session_file: &Path,
    response_id: Option<&str>,
    new_text: &str,
) -> AppResult<RewriteResult> {
    if !session_file.is_file() {
        return Err(AppError::Msg(format!(
            "session file not found: {}",
            session_file.display()
        )));
    }

    let raw = fs::read_to_string(session_file)?;
    let mut lines: Vec<String> = raw.lines().map(str::to_string).collect();
    if lines.is_empty() {
        return Err(AppError::Msg("session file is empty".into()));
    }

    let mut target_index: Option<usize> = None;
    for (index, line) in lines.iter().enumerate().rev() {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if value.get("type").and_then(Value::as_str) != Some("message") {
            continue;
        }
        let Some(message) = value.get("message").and_then(Value::as_object) else {
            continue;
        };
        if message.get("role").and_then(Value::as_str) != Some("assistant") {
            continue;
        }
        let entry_response_id = message.get("responseId").and_then(Value::as_str);
        let matches = match response_id {
            Some(wanted) => entry_response_id == Some(wanted),
            None => true, // latest assistant when walking reverse
        };
        if matches {
            target_index = Some(index);
            break;
        }
    }

    let Some(index) = target_index else {
        return Err(AppError::Msg(
            "could not find matching assistant message in session history".into(),
        ));
    };

    let mut value: Value = serde_json::from_str(&lines[index])?;
    {
        let message = value
            .get_mut("message")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| AppError::Msg("invalid assistant message entry".into()))?;
        rewrite_message_text_blocks(message, new_text)?;
        rewrite_provider_payload_text(message, new_text);
    }

    let entry_id = value
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let response_id = value
        .pointer("/message/responseId")
        .and_then(Value::as_str)
        .map(str::to_string);

    lines[index] = serde_json::to_string(&value)?;
    let mut out = lines.join("\n");
    out.push('\n');
    fs::write(session_file, out)?;

    Ok(RewriteResult {
        session_file: session_file.display().to_string(),
        entry_id,
        response_id,
    })
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RewriteResult {
    pub session_file: String,
    pub entry_id: String,
    pub response_id: Option<String>,
}

fn rewrite_message_text_blocks(
    message: &mut serde_json::Map<String, Value>,
    new_text: &str,
) -> AppResult<()> {
    let content = message
        .get_mut("content")
        .ok_or_else(|| AppError::Msg("assistant message has no content".into()))?;

    match content {
        Value::String(text) => {
            *text = new_text.to_string();
            Ok(())
        }
        Value::Array(blocks) => {
            let mut replaced = false;
            for block in blocks.iter_mut() {
                let Some(obj) = block.as_object_mut() else {
                    continue;
                };
                if obj.get("type").and_then(Value::as_str) == Some("text") {
                    obj.insert("text".into(), Value::String(new_text.to_string()));
                    // Signatures/provider-specific seals no longer match rewritten text.
                    obj.remove("textSignature");
                    replaced = true;
                    break;
                }
            }
            if !replaced {
                blocks.push(json!({
                    "type": "text",
                    "text": new_text,
                }));
            }
            Ok(())
        }
        _ => Err(AppError::Msg(
            "unsupported assistant message content shape".into(),
        )),
    }
}

fn rewrite_provider_payload_text(
    message: &mut serde_json::Map<String, Value>,
    new_text: &str,
) {
    let Some(payload) = message
        .get_mut("providerPayload")
        .and_then(Value::as_object_mut)
    else {
        return;
    };
    let Some(items) = payload.get_mut("items").and_then(Value::as_array_mut) else {
        return;
    };
    for item in items {
        let Some(obj) = item.as_object_mut() else {
            continue;
        };
        if obj.get("type").and_then(Value::as_str) != Some("message") {
            continue;
        }
        let Some(content) = obj.get_mut("content").and_then(Value::as_array_mut) else {
            continue;
        };
        for block in content {
            let Some(block_obj) = block.as_object_mut() else {
                continue;
            };
            if block_obj.get("type").and_then(Value::as_str) == Some("output_text") {
                block_obj.insert("text".into(), Value::String(new_text.to_string()));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn rewrites_assistant_text_by_response_id() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("omp-desktop-history-{stamp}.jsonl"));
        let raw = r#"{"type":"message","id":"u1","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}
{"type":"message","id":"a1","message":{"role":"assistant","responseId":"rid-1","content":[{"type":"thinking","thinking":"t"},{"type":"text","text":"old","textSignature":"sig"}],"providerPayload":{"items":[{"type":"message","content":[{"type":"output_text","text":"old"}]}]}}}
"#;
        fs::write(&path, raw).unwrap();
        let result = rewrite_assistant_text(&path, Some("rid-1"), "new reply").unwrap();
        assert_eq!(result.entry_id, "a1");
        let rewritten = fs::read_to_string(&path).unwrap();
        assert!(rewritten.contains("new reply"));
        assert!(!rewritten.contains("\"text\":\"old\""));
        assert!(!rewritten.contains("textSignature"));
        let _ = fs::remove_file(path);
    }
}
