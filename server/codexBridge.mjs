import { spawn } from "node:child_process";
import { appendBridgeJob, getSessionDetail } from "./codexStore.mjs";
import { respondToServerRequest, startTurnViaAppServer } from "./codexAppServer.mjs";

const activeJobs = new Map();
const BRIDGE_MODE = process.env.LOOPILOT_BRIDGE_MODE || "app-server";

export function dispatchRemoteMessage({ sessionId, message, model, reasoning, recordId, onUpdate }) {
  const session = getSessionDetail(sessionId);
  if (!session?.id) {
    return {
      ok: false,
      error: "Session not found"
    };
  }
  if (activeJobs.has(sessionId)) {
    return {
      ok: false,
      error: "A Codex bridge job is already running for this session"
    };
  }

  const job = {
    id: recordId,
    sessionId,
    status: "dispatching",
    command: "codex app-server turn/start",
    transport: "app-server",
    startedAt: new Date().toISOString(),
    cwd: session.cwd || process.cwd()
  };
  appendBridgeJob(sessionId, job);
  onUpdate?.(job);

  if (BRIDGE_MODE === "queue") {
    const update = {
      id: recordId,
      sessionId,
      status: "queued_only",
      transport: "queue",
      finishedAt: new Date().toISOString()
    };
    appendBridgeJob(sessionId, update);
    onUpdate?.(update);
    return { ok: true, job: update };
  }

  startTurnViaAppServer({
    session,
    message,
    model,
    reasoning,
    onUpdate: (update) => {
      const record = {
        id: recordId,
        sessionId,
        ...update
      };
      appendBridgeJob(sessionId, record);
      onUpdate?.(record);
    }
  }).then(() => {
    activeJobs.delete(sessionId);
    const update = {
      id: recordId,
      sessionId,
      status: "sent",
      transport: "app-server",
      finishedAt: new Date().toISOString()
    };
    appendBridgeJob(sessionId, update);
    onUpdate?.(update);
  }).catch((error) => {
    appendBridgeJob(sessionId, {
      id: recordId,
      sessionId,
      status: "app_server_failed",
      error: error.message,
      at: new Date().toISOString()
    });
    dispatchViaCli({ session, sessionId, message, model, reasoning, recordId, onUpdate });
  });

  activeJobs.set(sessionId, { transport: "app-server" });
  return { ok: true, job };
}

export function resolveBridgeRequest(actionId, decision) {
  return respondToServerRequest(actionId, decision);
}

function dispatchViaCli({ session, sessionId, message, model, reasoning, recordId, onUpdate }) {
  const cwd = session.cwd || process.cwd();
  const args = ["resume", "-C", cwd, "--no-alt-screen"];
  if (model) args.push("-m", model);
  if (reasoning) args.push("-c", `model_reasoning_effort="${reasoning}"`);
  args.push(sessionId, message);

  const child = spawn(codexCommand(), args, {
    cwd,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  activeJobs.set(sessionId, child);
  child.stdout.on("data", (chunk) => appendBridgeOutput(sessionId, recordId, "stdout", chunk, onUpdate));
  child.stderr.on("data", (chunk) => appendBridgeOutput(sessionId, recordId, "stderr", chunk, onUpdate));
  child.on("error", (error) => {
    activeJobs.delete(sessionId);
    const update = {
      id: recordId,
      sessionId,
      status: "failed",
      error: error.message,
      finishedAt: new Date().toISOString()
    };
    appendBridgeJob(sessionId, update);
    onUpdate?.(update);
  });
  child.on("close", (code) => {
    activeJobs.delete(sessionId);
    const update = {
      id: recordId,
      sessionId,
      status: code === 0 ? "sent" : "failed",
      exitCode: code,
      finishedAt: new Date().toISOString()
    };
    appendBridgeJob(sessionId, update);
    onUpdate?.(update);
  });

}

function appendBridgeOutput(sessionId, recordId, stream, chunk, onUpdate) {
  const text = chunk.toString().trim();
  if (!text) return;
  const update = {
    id: recordId,
    sessionId,
    status: "output",
    stream,
    text: text.slice(-2000),
    at: new Date().toISOString()
  };
  appendBridgeJob(sessionId, update);
  onUpdate?.(update);
}

function codexCommand() {
  return process.platform === "win32" ? "codex.cmd" : "codex";
}
