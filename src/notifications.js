export function pendingActionKey(session) {
  if (!session?.id || !session.pendingAction?.id) return "";
  return `${session.id}:${session.pendingAction.id}`;
}

export function buildPendingActionNotification(session) {
  if (!session?.pendingAction) return null;
  return {
    title: session.pendingAction.title || "LooPilot needs your input",
    body: session.title ? `${session.title} is waiting for a decision.` : "A Codex session is waiting for a decision.",
    tag: pendingActionKey(session),
    data: { sessionId: session.id }
  };
}

export function getNotificationPermission() {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export async function requestNotificationPermission() {
  if (typeof Notification === "undefined" || !Notification.requestPermission) return "unsupported";
  return Notification.requestPermission();
}

export function notifyPendingAction(session) {
  const payload = buildPendingActionNotification(session);
  if (!payload) return false;

  const canNotify = typeof Notification !== "undefined" && Notification.permission === "granted";
  if (!canNotify) return false;

  if (typeof navigator !== "undefined" && navigator.vibrate) {
    navigator.vibrate([140, 70, 140]);
  }

  if (typeof navigator !== "undefined" && navigator.serviceWorker?.ready) {
    navigator.serviceWorker.ready
      .then((registration) => registration.showNotification(payload.title, payload))
      .catch(() => new Notification(payload.title, payload));
  } else {
    new Notification(payload.title, payload);
  }
  return true;
}
