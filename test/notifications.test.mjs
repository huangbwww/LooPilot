import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPendingActionNotification,
  getNotificationPermission,
  pendingActionKey
} from "../src/notifications.js";

test("builds a stable key for pending action notifications", () => {
  assert.equal(
    pendingActionKey({ id: "session-1", pendingAction: { id: "approval-1" } }),
    "session-1:approval-1"
  );
  assert.equal(pendingActionKey({ id: "session-1" }), "");
});

test("builds phone notification payload for a pending decision", () => {
  const payload = buildPendingActionNotification({
    id: "session-1",
    title: "Fix build",
    pendingAction: { id: "approval-1", title: "Approval required" }
  });
  assert.deepEqual(payload, {
    title: "Approval required",
    body: "Fix build is waiting for a decision.",
    tag: "session-1:approval-1",
    data: { sessionId: "session-1" }
  });
});

test("reports unsupported notification permission outside the browser", () => {
  assert.equal(getNotificationPermission(), "unsupported");
});
