import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "loopilot-bridge-"));
const codexHome = path.join(root, ".codex");
const sessionId = "019e1c98-c592-7dc2-a684-ffec77c153b8";
const rolloutDir = path.join(codexHome, "sessions", "2026", "05", "13");
const rolloutPath = path.join(rolloutDir, `rollout-2026-05-13T09-00-00-${sessionId}.jsonl`);

process.env.CODEX_HOME = codexHome;
process.env.LOOPILOT_BRIDGE_MODE = "queue";
process.chdir(root);

fs.mkdirSync(rolloutDir, { recursive: true });
fs.writeFileSync(
  path.join(codexHome, "session_index.jsonl"),
  `${JSON.stringify({ id: sessionId, thread_name: "Bridge Session", updated_at: "2026-05-13T01:00:00.000Z" })}\n`
);
fs.writeFileSync(
  rolloutPath,
  `${JSON.stringify({
    timestamp: "2026-05-13T01:00:00.000Z",
    type: "session_meta",
    payload: { id: sessionId, cwd: root, model: "gpt-5.5" }
  })}\n`
);

const bridge = await import(`../server/codexBridge.mjs?case=${Date.now()}`);

test("queue bridge mode records remote send without spawning app-server or CLI", () => {
  const updates = [];
  const result = bridge.dispatchRemoteMessage({
    sessionId,
    message: "hello from phone",
    model: "gpt-5.5",
    reasoning: "high",
    recordId: "record-1",
    onUpdate: (update) => updates.push(update)
  });
  assert.equal(result.ok, true);
  assert.equal(updates.some((update) => update.status === "queued_only"), true);

  const jobsPath = path.join(root, ".loopilot", "jobs", `${sessionId}.jsonl`);
  const jobs = fs.readFileSync(jobsPath, "utf8");
  assert.match(jobs, /queued_only/);
  assert.match(jobs, /"transport":"queue"/);
});
