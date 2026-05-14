import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "loopilot-store-"));
const codexHome = path.join(root, ".codex");
const sessionId = "019e1c98-c592-7dc2-a684-ffec77c153b8";
const bridgeSessionId = "019e1c98-c592-7dc2-a684-ffec77c153b9";
const rolloutDir = path.join(codexHome, "sessions", "2026", "05", "13");
const rolloutPath = path.join(rolloutDir, `rollout-2026-05-13T09-00-00-${sessionId}.jsonl`);
const bridgeRolloutPath = path.join(rolloutDir, `rollout-2026-05-13T09-01-00-${bridgeSessionId}.jsonl`);

process.env.CODEX_HOME = codexHome;
process.chdir(root);

fs.mkdirSync(rolloutDir, { recursive: true });
fs.writeFileSync(
  path.join(codexHome, "session_index.jsonl"),
  [
    JSON.stringify({ id: sessionId, thread_name: "Test Session", updated_at: "2026-05-13T01:00:00.000Z" }),
    JSON.stringify({ id: bridgeSessionId, thread_name: "Bridge Pending", updated_at: "2026-05-13T01:00:00.000Z" })
  ].join("\n")
);

const rows = [
  {
    timestamp: "2026-05-13T01:00:00.000Z",
    type: "session_meta",
    payload: { id: sessionId, cwd: "D:\\LooPilot", model: "gpt-5.5" }
  },
  {
    timestamp: "2026-05-13T01:00:01.000Z",
    type: "turn_context",
    payload: { model: "gpt-5.5", effort: "high" }
  },
  {
    timestamp: "2026-05-13T01:00:02.000Z",
    type: "event_msg",
    payload: { type: "task_started" }
  },
  {
    timestamp: "2026-05-13T01:00:03.000Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "hello" }]
    }
  },
  {
    timestamp: "2026-05-13T01:00:04.000Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "working" }]
    }
  },
  {
    timestamp: "2026-05-13T01:00:05.000Z",
    type: "response_item",
    payload: {
      type: "function_call",
      name: "request_user_input",
      call_id: "ask-1",
      arguments: JSON.stringify({
        questions: [
          {
            id: "choice",
            question: "Pick one",
            options: [{ label: "A" }, { label: "B" }]
          }
        ]
      })
    }
  },
  {
    timestamp: "2026-05-13T01:00:06.000Z",
    type: "response_item",
    payload: {
      type: "function_call",
      name: "shell_command",
      call_id: "shell-1",
      arguments: JSON.stringify({
        command: "npm.cmd run accept:browser",
        workdir: "D:\\LooPilot",
        timeout_ms: 120000
      })
    }
  }
];

fs.writeFileSync(rolloutPath, rows.map((row) => JSON.stringify(row)).join("\n"));
fs.writeFileSync(
  bridgeRolloutPath,
  `${JSON.stringify({
    timestamp: "2026-05-13T01:00:00.000Z",
    type: "session_meta",
    payload: { id: bridgeSessionId, cwd: "D:\\LooPilot", model: "gpt-5.5" }
  })}\n`
);

const store = await import(`../server/codexStore.mjs?case=${Date.now()}`);

test("lists Codex sessions from session_index and rollout files", () => {
  const sessions = store.listSessions();
  const session = sessions.find((item) => item.id === sessionId);
  assert.equal(sessions.length, 2);
  assert.equal(session.title, "Test Session");
  assert.equal(session.status, "waiting");
  assert.equal(session.model, "gpt-5.5");
  assert.equal(session.reasoning, "high");
  assert.equal(session.messageCount, 2);
  assert.equal(session.toolCount, 2);
});

test("session detail includes timeline and pending user-input action", () => {
  const detail = store.getSessionDetail(sessionId);
  assert.equal(detail.timeline.some((item) => item.role === "user" && item.text === "hello"), true);
  assert.equal(detail.timeline.some((item) => item.role === "assistant" && item.text === "working"), true);
  assert.equal(detail.pendingAction.id, "ask-1");
  assert.equal(detail.pendingAction.kind, "input");
  assert.equal(detail.pendingAction.questions[0].id, "choice");
});

test("session detail summarizes tool calls instead of exposing raw JSON arguments", () => {
  const detail = store.getSessionDetail(sessionId);
  const item = detail.timeline.find((entry) => entry.id === "shell-1");
  assert.equal(item.title, "shell_command");
  assert.match(item.text, /运行命令：npm\.cmd run accept:browser/);
  assert.match(item.text, /目录：D:\\LooPilot/);
  assert.doesNotMatch(item.text, /"command"/);
});

test("remote messages and action decisions are persisted to local state", () => {
  const message = store.enqueueRemoteMessage(sessionId, "from phone", {
    model: "gpt-5.5",
    reasoning: "high",
    approvalPolicy: "on-request"
  });
  const action = store.resolveAction(sessionId, "ask-1", {
    decision: "approved",
    answers: { choice: ["A"] },
    scope: "session"
  });
  const detail = store.getSessionDetail(sessionId);
  assert.equal(detail.outbox.some((item) => item.id === message.id && item.message === "from phone"), true);
  assert.equal(detail.outbox.some((item) => item.id === action.id && item.actionId === "ask-1"), true);
  assert.equal(message.options.approvalPolicy, "on-request");
  assert.equal(action.decision, "approved");
  assert.deepEqual(action.answers, { choice: ["A"] });
  assert.equal(action.scope, "session");
  assert.equal(detail.pendingAction, null);
  assert.equal(detail.status, "idle");
  assert.equal(store.listSessions().find((session) => session.id === sessionId).pendingAction, null);
});

test("resolved bridge requests are not shown as pending actions", () => {
  store.appendBridgeJob(bridgeSessionId, {
    id: "record-2",
    sessionId: bridgeSessionId,
    status: "needs_approval",
    serverRequestId: "approval-1",
    method: "item/commandExecution/requestApproval",
    params: { command: ["git", "status"] },
    at: "2026-05-13T01:00:06.000Z"
  });
  let detail = store.getSessionDetail(bridgeSessionId);
  assert.equal(detail.pendingAction.id, "approval-1");

  store.resolveAction(bridgeSessionId, "approval-1", "approved");
  detail = store.getSessionDetail(bridgeSessionId);
  assert.equal(detail.pendingAction, null);
});
