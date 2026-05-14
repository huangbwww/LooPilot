import assert from "node:assert/strict";
import test from "node:test";
import { responseForDecision } from "../server/codexAppServer.mjs";

test("maps approval decisions to Codex app-server approval responses", () => {
  assert.deepEqual(responseForDecision("item/commandExecution/requestApproval", {}, "approved"), {
    decision: "accept"
  });
  assert.deepEqual(responseForDecision("item/commandExecution/requestApproval", {}, "denied"), {
    decision: "decline"
  });
  assert.deepEqual(responseForDecision("item/fileChange/requestApproval", {}, "approved"), {
    decision: "accept"
  });
  assert.deepEqual(responseForDecision("item/fileRead/requestApproval", {}, "approved"), {
    decision: "accept"
  });
  assert.deepEqual(responseForDecision("execCommandApproval", {}, "approved"), {
    decision: "approved"
  });
});

test("maps phone choice answers to request_user_input response shape", () => {
  const response = responseForDecision(
    "item/tool/requestUserInput",
    { questions: [{ id: "mode" }, { id: "scope" }] },
    { decision: "approved", answers: { mode: ["Fast"], scope: ["Session"] } }
  );
  assert.deepEqual(response, {
    answers: {
      mode: { answers: ["Fast"] },
      scope: { answers: ["Session"] }
    }
  });
});

test("maps permission approvals to a turn-scoped permission grant", () => {
  const permissions = { network: { hosts: ["example.com"] } };
  assert.deepEqual(responseForDecision("item/permissions/requestApproval", { permissions }, "approved"), {
    permissions,
    scope: "turn"
  });
  assert.deepEqual(responseForDecision("item/permissions/requestApproval", { permissions }, { decision: "approved", scope: "session" }), {
    permissions,
    scope: "session"
  });
  assert.deepEqual(responseForDecision("item/permissions/requestApproval", { permissions }, { decision: "approved", scope: "invalid" }), {
    permissions,
    scope: "turn"
  });
  assert.deepEqual(responseForDecision("item/permissions/requestApproval", { permissions }, "denied"), {
    permissions: {},
    scope: "turn"
  });
});
