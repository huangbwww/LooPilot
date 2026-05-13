import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "loopilot-auth-"));
process.chdir(root);

const auth = await import(`../server/auth.mjs?case=${Date.now()}`);

test("generates and reuses a local auth token", () => {
  const first = auth.getAuthToken();
  const second = auth.getAuthToken();
  assert.equal(first, second);
  assert.equal(first.length > 20, true);
  assert.equal(fs.existsSync(path.join(root, ".loopilot", "auth-token")), true);
});

test("validates websocket token from query string or bearer header", () => {
  const token = auth.getAuthToken();
  assert.equal(auth.isWsAuthorized({ url: `/live?token=${token}`, headers: {} }, token), true);
  assert.equal(auth.isWsAuthorized({ url: "/live", headers: { authorization: `Bearer ${token}` } }, token), true);
  assert.equal(auth.isWsAuthorized({ url: "/live?token=bad", headers: {} }, token), false);
});

test("generates and validates a local pairing code", () => {
  const code = auth.getPairingCode();
  assert.match(code, /^\d{6}$/);
  assert.equal(auth.getPairingCode(), code);
  assert.equal(auth.isPairingCodeValid(code, code), true);
  assert.equal(auth.isPairingCodeValid("000000", code), code === "000000");
  const rotated = auth.rotatePairingCode();
  assert.match(rotated, /^\d{6}$/);
  assert.equal(auth.getPairingCode(), rotated);
});
