mod client;

pub use client::RpcClient;

use serde_json::Value;

pub fn parse_frame(line: &str) -> Result<Value, serde_json::Error> {
    serde_json::from_str(line.trim())
}

pub fn frame_type(frame: &Value) -> Option<&str> {
    frame.get("type").and_then(Value::as_str)
}

pub fn frame_id(frame: &Value) -> Option<&str> {
    frame.get("id").and_then(Value::as_str)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ready_frame() {
        let frame = parse_frame(r#"{"type":"ready"}"#).unwrap();

        assert_eq!(frame_type(&frame), Some("ready"));
        assert_eq!(frame_id(&frame), None);
    }

    #[test]
    fn parse_response_frame() {
        let frame = parse_frame(
            r#"{"id":"req_1","type":"response","command":"prompt","success":true,"data":{"agentInvoked":true}}"#,
        )
        .unwrap();

        assert_eq!(frame_type(&frame), Some("response"));
        assert_eq!(frame_id(&frame), Some("req_1"));
    }
}
