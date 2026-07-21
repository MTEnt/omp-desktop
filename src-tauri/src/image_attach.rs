//! Prepare image attachments so prompt RPC frames stay under the 1 MiB limit.

use crate::error::{AppError, AppResult};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView, ImageFormat};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::Cursor;

/// Preferred after compression; JPEG is used for the quality ladder.
pub const PREFERRED_MIME: &str = "image/jpeg";

pub const MAX_IMAGES: usize = 4;
pub const MAX_EDGE: u32 = 1600;
/// Spare bytes left for framing / headroom on top of JSON overhead.
pub const FRAME_HEADROOM: usize = 32 * 1024;
/// Must match `MAX_RPC_FRAME_BYTES` in `rpc/client.rs`.
pub const MAX_FRAME: usize = 1024 * 1024;
/// Approximate non-image JSON overhead for a minimal prompt envelope.
const MESSAGE_JSON_OVERHEAD: usize = 8_000;

const JPEG_QUALITY_LADDER: &[u8] = &[85, 75, 65, 55, 45, 35, 25];

/// Image ready for an OMP `prompt` RPC `images` entry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreparedImage {
    pub mime_type: String,
    /// Base64-encoded image bytes (no data-URL prefix).
    pub data_base64: String,
    /// Length of `data_base64` in bytes (the base64 string length, not decoded).
    pub byte_len: usize,
    pub width: u32,
    pub height: u32,
}

/// DTO returned to the UI (same fields as [`PreparedImage`]).
#[allow(dead_code)]
pub type PreparedImageDto = PreparedImage;

/// Raw image input from the frontend (data URL or raw base64).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawImageInput {
    pub data_base64: String,
    #[serde(default)]
    #[allow(dead_code)]
    pub mime_type: Option<String>,
}

/// Budget for one image's base64 payload when packing `n` images into a frame.
pub fn per_image_b64_budget(n: usize) -> usize {
    let n = n.max(1);
    let usable = MAX_FRAME
        .saturating_sub(FRAME_HEADROOM)
        .saturating_sub(MESSAGE_JSON_OVERHEAD);
    usable / n
}

fn resize_to_max_edge(img: DynamicImage, max_edge: u32) -> DynamicImage {
    let (w, h) = img.dimensions();
    let longest = w.max(h);
    if longest <= max_edge || max_edge == 0 {
        return img;
    }
    let scale = max_edge as f64 / longest as f64;
    let nw = ((w as f64) * scale).round().max(1.0) as u32;
    let nh = ((h as f64) * scale).round().max(1.0) as u32;
    img.resize(nw, nh, FilterType::Triangle)
}

fn encode_jpeg(img: &DynamicImage, quality: u8) -> AppResult<Vec<u8>> {
    let rgb = img.to_rgb8();
    let mut buf = Vec::new();
    let mut cursor = Cursor::new(&mut buf);
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, quality);
    encoder
        .encode(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|e| AppError::from(format!("failed to encode JPEG: {e}")))?;
    Ok(buf)
}

fn encode_png(img: &DynamicImage) -> AppResult<Vec<u8>> {
    let mut buf = Vec::new();
    img.write_to(&mut Cursor::new(&mut buf), ImageFormat::Png)
        .map_err(|e| AppError::from(format!("failed to encode PNG: {e}")))?;
    Ok(buf)
}

fn to_prepared(mime_type: &str, bytes: &[u8], width: u32, height: u32) -> PreparedImage {
    let data_base64 = B64.encode(bytes);
    let byte_len = data_base64.len();
    PreparedImage {
        mime_type: mime_type.to_string(),
        data_base64,
        byte_len,
        width,
        height,
    }
}

/// Decode, optionally downscale, and compress so a single image fits the per-image budget.
#[allow(dead_code)]
pub fn prepare_image_from_bytes(bytes: &[u8]) -> AppResult<PreparedImage> {
    prepare_image_from_bytes_with_budget(bytes, per_image_b64_budget(1), MAX_EDGE)
}

fn prepare_image_from_bytes_with_budget(
    bytes: &[u8],
    b64_budget: usize,
    max_edge: u32,
) -> AppResult<PreparedImage> {
    if bytes.is_empty() {
        return Err(AppError::from("image bytes are empty"));
    }

    let img = image::load_from_memory(bytes)
        .map_err(|e| AppError::from(format!("failed to decode image: {e}")))?;
    let img = resize_to_max_edge(img, max_edge);
    let (width, height) = img.dimensions();

    // Tiny images may already fit as PNG; prefer JPEG once we need compression headroom.
    let png_bytes = encode_png(&img)?;
    let png_prepared = to_prepared("image/png", &png_bytes, width, height);
    if png_prepared.byte_len <= b64_budget {
        return Ok(png_prepared);
    }

    let mut best: Option<PreparedImage> = None;
    for &quality in JPEG_QUALITY_LADDER {
        let jpeg = encode_jpeg(&img, quality)?;
        let prepared = to_prepared(PREFERRED_MIME, &jpeg, width, height);
        if prepared.byte_len <= b64_budget {
            return Ok(prepared);
        }
        best = Some(match best {
            Some(prev) if prev.byte_len <= prepared.byte_len => prev,
            _ => prepared,
        });
    }

    // Still too large — try further downscales.
    let mut edge = max_edge;
    while edge > 256 {
        edge = (edge * 3 / 4).max(256);
        let smaller = resize_to_max_edge(
            image::load_from_memory(bytes)
                .map_err(|e| AppError::from(format!("failed to decode image: {e}")))?,
            edge,
        );
        let (w, h) = smaller.dimensions();
        for &quality in JPEG_QUALITY_LADDER {
            let jpeg = encode_jpeg(&smaller, quality)?;
            let prepared = to_prepared(PREFERRED_MIME, &jpeg, w, h);
            if prepared.byte_len <= b64_budget {
                return Ok(prepared);
            }
            best = Some(match best {
                Some(prev) if prev.byte_len <= prepared.byte_len => prev,
                _ => prepared,
            });
        }
    }

    Err(AppError::from(format!(
        "image could not be compressed under the {}-byte base64 budget (best effort {} bytes)",
        b64_budget,
        best.map(|b| b.byte_len).unwrap_or(0)
    )))
}

/// Build a sample prompt frame used to verify the packed payload fits the RPC limit.
pub fn estimate_prompt_frame_len(message: &str, images: &[PreparedImage]) -> usize {
    let value = json!({
        "id": "req_estimate",
        "type": "request",
        "command": "prompt",
        "params": {
            "message": message,
            "images": images_to_rpc_value(images),
        }
    });
    // Match wire format: JSON + trailing newline.
    serde_json::to_vec(&value)
        .map(|bytes| bytes.len() + 1)
        .unwrap_or(usize::MAX)
}

/// Prepare up to [`MAX_IMAGES`] images and ensure the packed prompt frame fits.
pub fn prepare_images(inputs: &[Vec<u8>]) -> AppResult<Vec<PreparedImage>> {
    if inputs.is_empty() {
        return Err(AppError::from("at least one image is required"));
    }
    if inputs.len() > MAX_IMAGES {
        return Err(AppError::from(format!(
            "at most {MAX_IMAGES} images are allowed (got {})",
            inputs.len()
        )));
    }
    if inputs.iter().any(|b| b.is_empty()) {
        return Err(AppError::from("image bytes are empty"));
    }

    let n = inputs.len();
    let mut budget = per_image_b64_budget(n);
    let mut edge = MAX_EDGE;
    let mut prepared: Vec<PreparedImage> = Vec::with_capacity(n);

    for attempt in 0..8 {
        prepared.clear();
        for bytes in inputs {
            prepared.push(prepare_image_from_bytes_with_budget(bytes, budget, edge)?);
        }

        let frame_len = estimate_prompt_frame_len("x", &prepared);
        if frame_len < MAX_FRAME.saturating_sub(FRAME_HEADROOM) {
            return Ok(prepared);
        }

        // Tighten budget / edge and retry.
        budget = budget.saturating_mul(3) / 4;
        if attempt % 2 == 1 {
            edge = (edge * 3 / 4).max(256);
        }
        if budget < 4_096 {
            break;
        }
    }

    let frame_len = estimate_prompt_frame_len("x", &prepared);
    Err(AppError::from(format!(
        "image set exceeds the RPC frame budget (estimated {frame_len} bytes; limit {})",
        MAX_FRAME.saturating_sub(FRAME_HEADROOM)
    )))
}

/// Convert prepared images into OMP ImageContent values.
pub fn images_to_rpc_value(images: &[PreparedImage]) -> Value {
    Value::Array(
        images
            .iter()
            .map(|img| {
                json!({
                    "type": "image",
                    "data": img.data_base64,
                    "mimeType": img.mime_type,
                })
            })
            .collect(),
    )
}

/// Strip an optional `data:*;base64,` prefix and decode base64 payload.
pub fn decode_raw_image_input(input: &RawImageInput) -> AppResult<Vec<u8>> {
    let raw = input.data_base64.trim();
    if raw.is_empty() {
        return Err(AppError::from("image data is empty"));
    }
    let b64 = if let Some(idx) = raw.find("base64,") {
        &raw[idx + "base64,".len()..]
    } else if let Some(idx) = raw.find(',') {
        // data URL without explicit base64 token — still try after comma
        if raw.starts_with("data:") {
            &raw[idx + 1..]
        } else {
            raw
        }
    } else {
        raw
    };
    B64.decode(b64.trim())
        .map_err(|e| AppError::from(format!("invalid image base64: {e}")))
}

/// Decode raw inputs and prepare them for a prompt.
pub fn prepare_from_raw_inputs(inputs: &[RawImageInput]) -> AppResult<Vec<PreparedImage>> {
    let mut decoded = Vec::with_capacity(inputs.len());
    for input in inputs {
        decoded.push(decode_raw_image_input(input)?);
    }
    prepare_images(&decoded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb};

    fn solid_png(w: u32, h: u32, color: [u8; 3]) -> Vec<u8> {
        let img: ImageBuffer<Rgb<u8>, Vec<u8>> =
            ImageBuffer::from_fn(w, h, |_, _| Rgb(color));
        let mut buf = Vec::new();
        DynamicImage::ImageRgb8(img)
            .write_to(&mut Cursor::new(&mut buf), ImageFormat::Png)
            .expect("encode png");
        buf
    }

    fn noisy_png(w: u32, h: u32) -> Vec<u8> {
        let img: ImageBuffer<Rgb<u8>, Vec<u8>> = ImageBuffer::from_fn(w, h, |x, y| {
            let r = ((x.wrapping_mul(37) ^ y.wrapping_mul(17)) & 0xff) as u8;
            let g = ((x.wrapping_mul(13) ^ y.wrapping_mul(59)) & 0xff) as u8;
            let b = ((x.wrapping_mul(91) ^ y.wrapping_mul(3)) & 0xff) as u8;
            Rgb([r, g, b])
        });
        let mut buf = Vec::new();
        DynamicImage::ImageRgb8(img)
            .write_to(&mut Cursor::new(&mut buf), ImageFormat::Png)
            .expect("encode png");
        buf
    }

    #[test]
    fn prepare_tiny_png_succeeds() {
        let bytes = solid_png(8, 8, [20, 40, 80]);
        let prepared = prepare_image_from_bytes(&bytes).expect("tiny png");
        assert!(prepared.byte_len > 0);
        assert!(prepared.width <= 8);
        assert!(prepared.height <= 8);
        assert!(prepared.mime_type.starts_with("image/"));
        assert_eq!(prepared.byte_len, prepared.data_base64.len());
    }

    #[test]
    fn prepare_large_image_fits_frame() {
        let bytes = noisy_png(2000, 2000);
        let prepared = prepare_image_from_bytes(&bytes).expect("large image");
        assert!(prepared.width <= MAX_EDGE);
        assert!(prepared.height <= MAX_EDGE);
        let frame = estimate_prompt_frame_len("x", std::slice::from_ref(&prepared));
        assert!(
            frame < MAX_FRAME,
            "estimated frame {frame} must be under {MAX_FRAME}"
        );
        assert!(
            frame < MAX_FRAME - FRAME_HEADROOM,
            "estimated frame {frame} must leave headroom"
        );
        assert_eq!(prepared.byte_len, prepared.data_base64.len());
    }

    #[test]
    fn prepare_images_rejects_more_than_max() {
        let tiny = solid_png(4, 4, [1, 2, 3]);
        let inputs = vec![
            tiny.clone(),
            tiny.clone(),
            tiny.clone(),
            tiny.clone(),
            tiny,
        ];
        let err = prepare_images(&inputs).expect_err("should reject >4");
        let msg = err.to_string();
        assert!(
            msg.contains("at most") || msg.contains("4"),
            "unexpected error: {msg}"
        );
    }

    #[test]
    fn prepare_images_rejects_empty_set() {
        let err = prepare_images(&[]).expect_err("empty");
        assert!(err.to_string().contains("at least one"));
    }

    #[test]
    fn prepare_images_multi_fits_budget() {
        let a = noisy_png(1200, 900);
        let b = noisy_png(900, 1200);
        let prepared = prepare_images(&[a, b]).expect("two images");
        assert_eq!(prepared.len(), 2);
        let frame = estimate_prompt_frame_len("x", &prepared);
        assert!(
            frame < MAX_FRAME - FRAME_HEADROOM,
            "frame {frame} exceeds budget"
        );
    }

    #[test]
    fn images_to_rpc_value_shape() {
        let prepared = PreparedImage {
            mime_type: "image/jpeg".into(),
            data_base64: "abcd".into(),
            byte_len: 4,
            width: 10,
            height: 12,
        };
        let value = images_to_rpc_value(&[prepared]);
        assert_eq!(value[0]["type"], "image");
        assert_eq!(value[0]["data"], "abcd");
        assert_eq!(value[0]["mimeType"], "image/jpeg");
    }

    #[test]
    fn decode_data_url_and_raw_base64() {
        let bytes = solid_png(2, 2, [9, 8, 7]);
        let b64 = B64.encode(&bytes);
        let raw = RawImageInput {
            data_base64: b64.clone(),
            mime_type: Some("image/png".into()),
        };
        assert_eq!(decode_raw_image_input(&raw).unwrap(), bytes);

        let data_url = RawImageInput {
            data_base64: format!("data:image/png;base64,{b64}"),
            mime_type: None,
        };
        assert_eq!(decode_raw_image_input(&data_url).unwrap(), bytes);
    }

    #[test]
    fn per_image_budget_shrinks_with_count() {
        assert!(per_image_b64_budget(4) < per_image_b64_budget(1));
        assert!(per_image_b64_budget(1) < MAX_FRAME);
    }
}
