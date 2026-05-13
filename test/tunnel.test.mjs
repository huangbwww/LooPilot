import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const tunnelSource = fs.readFileSync(new URL("../server/tunnel.mjs", import.meta.url), "utf8");

test("public tunnel output does not embed access tokens in URLs", () => {
  assert.match(tunnelSource, /console\.log\(`Public URL: \$\{match\[0\]\}`\)/);
  assert.doesNotMatch(tunnelSource, /token=/);
  assert.doesNotMatch(tunnelSource, /encodeURIComponent\(token\)/);
});
