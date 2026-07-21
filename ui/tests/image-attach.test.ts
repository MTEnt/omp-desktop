import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_COMPOSER_IMAGES,
  formatByteLen,
  isImageFile,
  isImageMime,
  mimeFromDataUrl,
  stripDataUrlBase64,
  takeImageFiles,
} from "../src/session/image-attach.ts";

describe("image-attach helpers", () => {
  it("caps composer attachments at 4", () => {
    assert.equal(MAX_COMPOSER_IMAGES, 4);
  });

  it("detects image mime and file names", () => {
    assert.equal(isImageMime("image/png"), true);
    assert.equal(isImageMime("IMAGE/JPEG"), true);
    assert.equal(isImageMime("text/plain"), false);
    assert.equal(isImageFile({ type: "image/webp", name: "x" }), true);
    assert.equal(isImageFile({ type: "", name: "shot.PNG" }), true);
    assert.equal(isImageFile({ type: "application/pdf", name: "a.pdf" }), false);
  });

  it("strips data URL prefixes", () => {
    assert.equal(stripDataUrlBase64("data:image/png;base64,abcd"), "abcd");
    assert.equal(stripDataUrlBase64("  abcd==  "), "abcd==");
    assert.equal(mimeFromDataUrl("data:image/jpeg;base64,xx"), "image/jpeg");
  });

  it("formats byte lengths", () => {
    assert.equal(formatByteLen(0), "0 B");
    assert.equal(formatByteLen(512), "512 B");
    assert.equal(formatByteLen(2048), "2.0 KB");
  });

  it("takes only remaining image slots", () => {
    const files = [
      { type: "image/png", name: "a.png" },
      { type: "text/plain", name: "b.txt" },
      { type: "image/jpeg", name: "c.jpg" },
      { type: "image/png", name: "d.png" },
    ] as File[];
    const taken = takeImageFiles(files, 2);
    assert.equal(taken.length, 2);
    assert.equal(taken[0]!.name, "a.png");
    assert.equal(taken[1]!.name, "c.jpg");
    assert.deepEqual(takeImageFiles(files, 0), []);
  });
});
