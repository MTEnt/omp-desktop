import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const tauriConfigUrl = new URL("../../src-tauri/tauri.conf.json", import.meta.url);

describe("desktop security configuration", () => {
  it("ships a restrictive content security policy", async () => {
    const config = JSON.parse(await readFile(tauriConfigUrl, "utf8")) as {
      app?: { security?: { csp?: unknown } };
    };
    const csp = config.app?.security?.csp;

    assert.equal(typeof csp, "string", "app.security.csp must be enabled");
    assert.match(csp, /(?:^|;)\s*default-src\s+'self'(?:\s|;|$)/);
    assert.match(csp, /(?:^|;)\s*script-src\s+'self'(?:\s|;|$)/);
    assert.match(csp, /(?:^|;)\s*connect-src\s+[^;]*\bipc:/);
    assert.match(csp, /(?:^|;)\s*frame-src\s+[^;]*http:\/\/localhost:\*/);
  });
});
