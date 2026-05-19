import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "loopilot-store-"));
const codexHome = path.join(root, ".codex");
const sessionId = "019e1c98-c592-7dc2-a684-ffec77c153b8";
const bridgeSessionId = "019e1c98-c592-7dc2-a684-ffec77c153b9";
const subagentSessionId = "019e1c98-c592-7dc2-a684-ffec77c153ba";
const outboxOrderSessionId = "019e1c98-c592-7dc2-a684-ffec77c153bb";
const completedPendingSessionId = "019e1c98-c592-7dc2-a684-ffec77c153bc";
const wrappedPromptSessionId = "019e1c98-c592-7dc2-a684-ffec77c153bd";
const splitDataImageSessionId = "019e1c98-c592-7dc2-a684-ffec77c153be";
const rolloutDir = path.join(codexHome, "sessions", "2026", "05", "13");
const rolloutPath = path.join(rolloutDir, `rollout-2026-05-13T09-00-00-${sessionId}.jsonl`);
const bridgeRolloutPath = path.join(rolloutDir, `rollout-2026-05-13T09-01-00-${bridgeSessionId}.jsonl`);
const subagentRolloutPath = path.join(rolloutDir, `rollout-2026-05-13T09-02-00-${subagentSessionId}.jsonl`);
const outboxOrderRolloutPath = path.join(rolloutDir, `rollout-2026-05-13T09-03-00-${outboxOrderSessionId}.jsonl`);
const completedPendingRolloutPath = path.join(rolloutDir, `rollout-2026-05-13T09-04-00-${completedPendingSessionId}.jsonl`);
const wrappedPromptRolloutPath = path.join(rolloutDir, `rollout-2026-05-13T09-05-00-${wrappedPromptSessionId}.jsonl`);
const splitDataImageRolloutPath = path.join(rolloutDir, `rollout-2026-05-13T09-06-00-${splitDataImageSessionId}.jsonl`);

process.env.CODEX_HOME = codexHome;
process.chdir(root);

fs.mkdirSync(rolloutDir, { recursive: true });
fs.writeFileSync(
  path.join(codexHome, "session_index.jsonl"),
  [
    JSON.stringify({ id: sessionId, thread_name: "Test Session", updated_at: "2026-05-13T01:00:00.000Z" }),
    JSON.stringify({ id: bridgeSessionId, thread_name: "Bridge Pending", updated_at: "2026-05-13T01:00:00.000Z" }),
    JSON.stringify({ id: subagentSessionId, thread_name: "Review branch", updated_at: "2026-05-13T01:00:00.000Z" }),
    JSON.stringify({ id: outboxOrderSessionId, thread_name: "Outbox Order", updated_at: "2026-05-13T01:00:00.000Z" }),
    JSON.stringify({ id: completedPendingSessionId, thread_name: "Completed Pending", updated_at: "2026-05-13T01:00:00.000Z" }),
    JSON.stringify({ id: wrappedPromptSessionId, thread_name: "Wrapped Prompt", updated_at: "2026-05-13T01:00:00.000Z" }),
    JSON.stringify({ id: splitDataImageSessionId, thread_name: "Split Data Image", updated_at: "2026-05-13T01:00:00.000Z" })
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
      content: [
        { type: "output_text", text: "working" },
        { type: "local_image", path: "D:\\LooPilot\\phone.png", name: "phone.png", mime_type: "image/png" }
      ]
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
fs.writeFileSync(
  subagentRolloutPath,
  `${JSON.stringify({
    timestamp: "2026-05-13T01:00:00.000Z",
    type: "session_meta",
    payload: {
      id: subagentSessionId,
      cwd: "D:\\LooPilot",
      model: "gpt-5.5",
      thread_source: "subagent",
      agent_nickname: "Ada",
      source: {
        subagent: {
          thread_spawn: {
            parent_thread_id: sessionId,
            depth: 1,
            agent_nickname: "Ada"
          }
        }
      }
    }
  })}\n`
);
fs.writeFileSync(
  outboxOrderRolloutPath,
  `${JSON.stringify({
    timestamp: "2026-05-13T01:00:00.000Z",
    type: "session_meta",
    payload: { id: outboxOrderSessionId, cwd: "D:\\LooPilot", model: "gpt-5.5" }
  })}\n`
);
fs.writeFileSync(
  completedPendingRolloutPath,
  [
    JSON.stringify({
      timestamp: "2026-05-13T01:00:00.000Z",
      type: "session_meta",
      payload: { id: completedPendingSessionId, cwd: "D:\\LooPilot", model: "gpt-5.5" }
    }),
    JSON.stringify({
      timestamp: "2026-05-13T01:00:01.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "request_user_input",
        call_id: "old-ask",
        arguments: JSON.stringify({ questions: [{ id: "choice", question: "Old prompt", options: [] }] })
      }
    }),
    JSON.stringify({
      timestamp: "2026-05-13T01:00:02.000Z",
      type: "event_msg",
      payload: { type: "task_complete" }
    })
  ].join("\n")
);
fs.writeFileSync(
  wrappedPromptRolloutPath,
  [
    JSON.stringify({
      timestamp: "2026-05-13T01:00:00.000Z",
      type: "session_meta",
      payload: { id: wrappedPromptSessionId, cwd: "D:\\LooPilot", model: "gpt-5.5" }
    }),
    JSON.stringify({
      timestamp: "2026-05-13T01:00:01.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{
          type: "input_text",
          text: "The exact task prompt is encoded below as a JSON string with Unicode escapes. Interpret the escapes as Unicode characters, then follow the decoded task prompt. If the decoded prompt is a user chat message, answer that message directly. Do not mention this transport wrapper.\n\nJSON_ESCAPED_PROMPT:\n\"\\u957f\\u946b\\u62db\\u80a1\\u4e66\\u7684\\u534a\\u5bfc\\u4f53\\u8bbe\\u5907\\u548c\\u6750\\u6599\\u4f9b\\u5e94\\u6709\\u54ea\\u4e9b\""
        }]
      }
    })
  ].join("\n")
);
const longDataImage = `data:image/png;base64,${"A".repeat(6000)}${"B".repeat(100)}`;
fs.writeFileSync(
  splitDataImageRolloutPath,
  [
    JSON.stringify({
      timestamp: "2026-05-13T01:00:00.000Z",
      type: "session_meta",
      payload: { id: splitDataImageSessionId, cwd: "D:\\LooPilot", model: "gpt-5.5" }
    }),
    JSON.stringify({
      timestamp: "2026-05-13T01:00:01.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{
          type: "output_text",
          text: `导入之后都是乱码\n\n<image>\n![image]\n(${longDataImage.slice(0, 3000)}\n${longDataImage.slice(3000)})\n</image>`
        }]
      }
    })
  ].join("\n")
);
fs.utimesSync(rolloutPath, new Date("2026-05-13T02:00:00.000Z"), new Date("2026-05-13T02:00:00.000Z"));
fs.utimesSync(bridgeRolloutPath, new Date("2026-05-13T01:01:00.000Z"), new Date("2026-05-13T01:01:00.000Z"));
fs.utimesSync(subagentRolloutPath, new Date("2026-05-13T01:02:00.000Z"), new Date("2026-05-13T01:02:00.000Z"));
fs.utimesSync(outboxOrderRolloutPath, new Date("2026-05-13T01:03:00.000Z"), new Date("2026-05-13T01:03:00.000Z"));
fs.utimesSync(completedPendingRolloutPath, new Date("2026-05-13T01:04:00.000Z"), new Date("2026-05-13T01:04:00.000Z"));
fs.utimesSync(wrappedPromptRolloutPath, new Date("2026-05-13T01:05:00.000Z"), new Date("2026-05-13T01:05:00.000Z"));
fs.utimesSync(splitDataImageRolloutPath, new Date("2026-05-13T01:06:00.000Z"), new Date("2026-05-13T01:06:00.000Z"));

const store = await import(`../server/codexStore.mjs?case=${Date.now()}`);

test("lists Codex sessions from session_index and rollout files", () => {
  const sessions = store.listSessions();
  const session = sessions.find((item) => item.id === sessionId);
  assert.equal(sessions.length, 7);
  assert.equal(sessions.total, 7);
  assert.equal(sessions.hasMore, false);
  assert.equal(session.title, "Test Session");
  assert.equal(session.status, "waiting");
  assert.equal(session.model, "gpt-5.5");
  assert.equal(session.reasoning, "high");
  assert.equal(session.messageCount, 2);
  assert.equal(session.toolCount, 2);
});

test("prefers rollout file mtime when session_index timestamps are stale", () => {
  const sessions = store.listSessions();
  assert.equal(sessions[0].id, sessionId);
});

test("paginates session summaries before hydrating details", () => {
  const firstPage = store.listSessionPage({ limit: 2 });
  assert.equal(firstPage.sessions.length, 2);
  assert.equal(firstPage.total, 7);
  assert.equal(firstPage.hasMore, true);
  assert.equal(firstPage.nextOffset, 2);

  const secondPage = store.listSessionPage({ limit: 2, offset: 2 });
  assert.equal(secondPage.sessions.length, 2);
  assert.equal(secondPage.hasMore, true);
  assert.equal(secondPage.nextOffset, 4);
  assert.notEqual(firstPage.sessions[0].id, secondPage.sessions[0].id);
});

test("outbox records are ordered by timestamp across message action and job files", () => {
  const message = store.enqueueRemoteMessage(outboxOrderSessionId, "latest phone message");
  store.appendBridgeJob(outboxOrderSessionId, {
    id: "old-bridge",
    sessionId: outboxOrderSessionId,
    status: "output",
    at: "2020-01-01T00:00:00.000Z"
  });
  const action = store.resolveAction(outboxOrderSessionId, "approval-2", {
    decision: "approved",
    scope: "turn"
  });
  const detail = store.getSessionDetail(outboxOrderSessionId);
  assert.equal(detail.outbox[0].id, "old-bridge");
  assert.equal(detail.outbox.at(-2).id, message.id);
  assert.equal(detail.outbox.at(-1).id, action.id);
});

test("subagent sessions are exposed with parent metadata", () => {
  const subagent = store.listSessions().find((item) => item.id === subagentSessionId);
  assert.equal(subagent.isSubagent, true);
  assert.equal(subagent.threadSource, "subagent");
  assert.equal(subagent.parentThreadId, sessionId);
  assert.equal(subagent.agentNickname, "Ada");
});

test("session detail includes timeline and pending user-input action", () => {
  const detail = store.getSessionDetail(sessionId);
  assert.equal(detail.timeline.some((item) => item.role === "user" && item.text === "hello"), true);
  assert.equal(detail.timeline.some((item) => item.role === "assistant" && item.text.includes("working")), true);
  assert.equal(detail.timeline.some((item) => item.role === "assistant" && item.text.includes("![phone.png](D:\\LooPilot\\phone.png)")), true);
  assert.equal(detail.pendingAction.id, "ask-1");
  assert.equal(detail.pendingAction.kind, "input");
  assert.equal(detail.pendingAction.questions[0].id, "choice");
});

test("session detail unwraps JSON escaped transport prompts", () => {
  const detail = store.getSessionDetail(wrappedPromptSessionId);
  assert.equal(detail.timeline[0].role, "user");
  assert.equal(detail.timeline[0].text, "长鑫招股书的半导体设备和材料供应有哪些");
  assert.equal(detail.lastOutput, "长鑫招股书的半导体设备和材料供应有哪些");
});

test("session detail preserves split data URL images for rendering", () => {
  const detail = store.getSessionDetail(splitDataImageSessionId);
  const text = detail.timeline[0].text;
  assert.equal(text.includes("![image]\n("), false);
  assert.match(text, /!\[image\]\(data:image\/png;base64,/);
  assert.equal(text.includes("<image>"), false);
  assert.equal(text.includes("</image>"), false);
  assert.equal(text.includes("\nAAAA"), false);
  assert.equal(text.includes("..."), false);
  assert.equal(text.includes(longDataImage), true);
});

test("session detail can be limited for mobile rendering", () => {
  const detail = store.getSessionDetail(sessionId, { limit: 2 });
  assert.equal(detail.timeline.length, 2);
  assert.equal(detail.timelineTotal, 4);
  assert.equal(detail.timelineHasMore, true);
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
    approvalPolicy: "on-request",
    sandboxMode: "workspace-write"
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
  assert.equal(message.options.sandboxMode, "workspace-write");
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

test("completed turns do not keep stale pending action indicators", () => {
  const detail = store.getSessionDetail(completedPendingSessionId);
  assert.equal(detail.pendingAction, null);
  assert.equal(detail.status, "idle");
  assert.equal(store.listSessions().find((session) => session.id === completedPendingSessionId).pendingAction, null);
});
