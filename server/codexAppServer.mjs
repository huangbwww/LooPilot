import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import WebSocket from "ws";
import { normalizeApprovalPolicy, normalizeApprovalScope } from "./options.mjs";

const DEFAULT_PORT = Number(process.env.LOOPILOT_CODEX_APP_SERVER_PORT || 4331);
const APP_SERVER_URL = `ws://127.0.0.1:${DEFAULT_PORT}`;
const READY_URL = `http://127.0.0.1:${DEFAULT_PORT}/readyz`;

let processHandle = null;
let socket = null;
let nextId = 1;
let initialized = false;
let connecting = null;
let currentOnUpdate = null;
const pending = new Map();
const serverRequests = new Map();

export async function startTurnViaAppServer({ session, message, model, reasoning, approvalPolicy, onUpdate }) {
  currentOnUpdate = onUpdate;
  await ensureConnected(onUpdate);
  const safeApprovalPolicy = normalizeApprovalPolicy(approvalPolicy);
  await request("thread/resume", {
    threadId: session.id,
    cwd: session.cwd || process.cwd(),
    model: model || null,
    config: turnConfig({ reasoning, approvalPolicy: safeApprovalPolicy })
  });
  return request("turn/start", {
    threadId: session.id,
    input: [{ type: "text", text: message, text_elements: [] }],
    cwd: session.cwd || process.cwd(),
    model: model || null,
    effort: reasoning || null
  });
}

export function respondToServerRequest(requestId, decision) {
  const pendingRequest = serverRequests.get(String(requestId));
  if (!pendingRequest || !socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify({
    id: pendingRequest.id,
    result: responseForDecision(pendingRequest.method, pendingRequest.params, decision)
  }));
  serverRequests.delete(String(requestId));
  return true;
}

export function shutdownAppServer() {
  socket?.close?.();
  socket = null;
  initialized = false;
  if (processHandle) {
    processHandle.kill();
    processHandle = null;
  }
}

async function ensureConnected(onUpdate) {
  if (socket?.readyState === WebSocket.OPEN && initialized) return;
  if (connecting) return connecting;
  connecting = (async () => {
    await ensureProcess();
    socket = new WebSocket(APP_SERVER_URL);
    socket.on("message", (data) => handleMessage(data, currentOnUpdate || onUpdate));
    socket.on("close", () => {
      initialized = false;
      socket = null;
    });
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    await request("initialize", {
      clientInfo: { name: "LooPilot", version: "0.1.0" },
      capabilities: { experimentalApi: true }
    });
    socket.send(JSON.stringify({ method: "initialized" }));
    initialized = true;
  })().finally(() => {
    connecting = null;
  });
  return connecting;
}

async function ensureProcess() {
  if (await isReady()) return;
  const command = codexCommand();
  processHandle = spawn(command.file, ["app-server", "--listen", APP_SERVER_URL], {
    cwd: process.cwd(),
    shell: command.shell,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  processHandle.stdout.on("data", (chunk) => process.stdout.write(chunk));
  processHandle.stderr.on("data", (chunk) => process.stderr.write(chunk));
  processHandle.on("close", () => {
    initialized = false;
    processHandle = null;
  });
  const started = Date.now();
  while (Date.now() - started < 15000) {
    if (await isReady()) return;
    await sleep(250);
  }
  throw new Error("Codex app-server did not become ready");
}

function request(method, params) {
  if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("Codex app-server websocket is not connected");
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Codex app-server request timed out: ${method}`));
    }, 30000);
    pending.set(id, { resolve, reject, timeout, method });
  });
}

function handleMessage(data, onUpdate) {
  const message = JSON.parse(data.toString());
  if (message.id && pending.has(message.id)) {
    const item = pending.get(message.id);
    clearTimeout(item.timeout);
    pending.delete(message.id);
    if (message.error) item.reject(new Error(message.error.message || JSON.stringify(message.error)));
    else item.resolve(message.result);
    return;
  }
  if (message.id && message.method) {
    const requestId = String(message.id);
    serverRequests.set(requestId, message);
    onUpdate?.({
      status: requestStatus(message.method),
      serverRequestId: requestId,
      method: message.method,
      params: message.params,
      at: new Date().toISOString()
    });
    return;
  }
  if (message.method) {
    onUpdate?.({
      status: "notification",
      method: message.method,
      params: message.params,
      at: new Date().toISOString()
    });
  }
}

export function responseForDecision(method, params, decision) {
  const approved = decision === "approved" || decision?.decision === "approved";
  if (method === "item/commandExecution/requestApproval") return { decision: approved ? "accept" : "decline" };
  if (method === "item/fileChange/requestApproval") return { decision: approved ? "accept" : "decline" };
  if (method === "item/fileRead/requestApproval") return { decision: approved ? "accept" : "decline" };
  if (method === "execCommandApproval" || method === "applyPatchApproval") return { decision: approved ? "approved" : "denied" };
  if (method === "item/permissions/requestApproval") {
    return approved ? { permissions: params.permissions || {}, scope: normalizeApprovalScope(decision?.scope) || "turn" } : { permissions: {}, scope: "turn" };
  }
  if (method === "item/tool/requestUserInput") {
    const answers = {};
    for (const question of params.questions || []) {
      answers[question.id] = { answers: decision?.answers?.[question.id] || [] };
    }
    return { answers };
  }
  return {};
}

function turnConfig({ reasoning, approvalPolicy }) {
  const config = {};
  if (reasoning) config.model_reasoning_effort = reasoning;
  if (approvalPolicy) config.approval_policy = approvalPolicy;
  return Object.keys(config).length ? config : null;
}

function requestStatus(method) {
  if (method.includes("requestApproval") || method.endsWith("Approval")) return "needs_approval";
  if (method.includes("requestUserInput") || method.includes("elicitation")) return "needs_input";
  return "needs_response";
}

function isReady() {
  return new Promise((resolve) => {
    const req = http.get(READY_URL, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function shouldUseShell(command) {
  return process.platform === "win32" && command.toLowerCase().endsWith(".cmd");
}
