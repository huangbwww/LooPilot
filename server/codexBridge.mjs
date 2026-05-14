import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { appendBridgeJob, getSessionDetail } from "./codexStore.mjs";
import { respondToServerRequest, startTurnViaAppServer } from "./codexAppServer.mjs";
import { normalizeApprovalPolicy } from "./options.mjs";

const activeJobs = new Map();
const BRIDGE_MODE = process.env.LOOPILOT_BRIDGE_MODE || "app-server";
const DISABLE_CLI_FALLBACK = process.env.LOOPILOT_DISABLE_CLI_FALLBACK === "1";
const ENABLE_CLI_FALLBACK = process.env.LOOPILOT_ENABLE_CLI_FALLBACK === "1";

export function dispatchRemoteMessage({ sessionId, message, model, reasoning, approvalPolicy, recordId, onUpdate }) {
  const session = getSessionDetail(sessionId);
  const safeApprovalPolicy = normalizeApprovalPolicy(approvalPolicy);
  if (!session?.id) {
    return {
      ok: false,
      error: "Session not found"
    };
  }
  if (activeJobs.has(sessionId) || (BRIDGE_MODE !== "queue" && activeJobs.size > 0)) {
    return {
      ok: false,
      error: "A Codex bridge job is already running"
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
    approvalPolicy: safeApprovalPolicy,
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
    const failure = {
      id: recordId,
      sessionId,
      status: "app_server_failed",
      error: error.message,
      at: new Date().toISOString()
    };
    appendBridgeJob(sessionId, failure);
    onUpdate?.(failure);
    if (DISABLE_CLI_FALLBACK || !ENABLE_CLI_FALLBACK) {
      activeJobs.delete(sessionId);
      return;
    }
    dispatchViaCli({ session, sessionId, message, model, reasoning, approvalPolicy: safeApprovalPolicy, recordId, onUpdate });
  });

  activeJobs.set(sessionId, { transport: "app-server" });
  return { ok: true, job };
}

export function resolveBridgeRequest(actionId, decision) {
  return respondToServerRequest(actionId, decision);
}

function dispatchViaCli({ session, sessionId, message, model, reasoning, approvalPolicy, recordId, onUpdate }) {
  const cwd = session.cwd || process.cwd();
  const args = ["resume", "-C", cwd, "--no-alt-screen"];
  if (model) args.push("-m", model);
  if (reasoning) args.push("-c", `model_reasoning_effort="${reasoning}"`);
  if (approvalPolicy) args.push("-c", `approval_policy="${approvalPolicy}"`);
  args.push(sessionId, message);

  const command = codexCommand();
  if (!isSafeCliFallbackCommand(command)) {
    activeJobs.delete(sessionId);
    const update = {
      id: recordId,
      sessionId,
      status: "failed",
      error: "CLI fallback requires a Codex executable that can run without a Windows shell; refusing .cmd fallback for remote messages",
      finishedAt: new Date().toISOString()
    };
    appendBridgeJob(sessionId, update);
    onUpdate?.(update);
    return;
  }

  const child = spawn(command.file, args, {
    cwd,
    shell: command.shell,
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
  if (process.env.LOOPILOT_CODEX_COMMAND) {
    return { file: process.env.LOOPILOT_CODEX_COMMAND, shell: shouldUseShell(process.env.LOOPILOT_CODEX_COMMAND) };
  }
  if (process.platform !== "win32") return { file: "codex", shell: false };
  const candidates = [];
  if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin", "codex.exe"));
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, "npm", "codex.exe"));
    candidates.push(path.join(process.env.APPDATA, "npm", "codex.cmd"));
  }
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (found) return { file: found, shell: shouldUseShell(found) };
  return { file: "codex.cmd", shell: true };
}

export function isSafeCliFallbackCommand(command) {
  return command.shell !== true;
}

function shouldUseShell(command) {
  return process.platform === "win32" && command.toLowerCase().endsWith(".cmd");
}
