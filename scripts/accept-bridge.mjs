import { spawn } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const explicitSessionId = process.env.LOOPILOT_ACCEPT_SESSION_ID || "";
const useLatest = process.env.LOOPILOT_ACCEPT_USE_LATEST === "1";

if (!explicitSessionId && !useLatest) {
  console.error("Set LOOPILOT_ACCEPT_SESSION_ID=<session-id> or LOOPILOT_ACCEPT_USE_LATEST=1 before running accept:bridge.");
  process.exit(1);
}

const port = Number(process.env.LOOPILOT_ACCEPT_PORT || 46000 + Math.floor(Math.random() * 1000));
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "loopilot-accept-bridge-"));
const token = randomBytes(32).toString("base64url");
const pairingCode = randomInt(0, 1_000_000).toString().padStart(6, "0");
const message = process.env.LOOPILOT_ACCEPT_MESSAGE || "LooPilot bridge acceptance check. Please reply with a brief acknowledgement.";
const model = process.env.LOOPILOT_ACCEPT_MODEL || "gpt-5.5";
const reasoning = process.env.LOOPILOT_ACCEPT_REASONING || "high";

const child = spawn(process.execPath, [path.join(root, "server", "index.mjs")], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    LOOPILOT_BRIDGE_MODE: "app-server",
    LOOPILOT_DISABLE_CLI_FALLBACK: "1",
    LOOPILOT_STATE_DIR: stateDir,
    LOOPILOT_TOKEN: token,
    LOOPILOT_PAIRING_CODE: pairingCode
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

try {
  const base = `http://127.0.0.1:${port}`;
  const health = await waitForJson(`${base}/api/health`, 30000);
  assertEqual(health.ok, true, "health ok");
  assertEqual(health.bridgeMode, "app-server", "bridge mode");

  const pair = await postJson(`${base}/api/pair`, { code: pairingCode });
  assertEqual(pair.token, token, "pairing token");

  const sessions = await getJson(`${base}/api/sessions`, token);
  assertTruthy(Array.isArray(sessions.sessions), "sessions array");
  assertTruthy(sessions.sessions.length > 0, "at least one Codex session");
  const targetSession = explicitSessionId
    ? sessions.sessions.find((session) => session.id === explicitSessionId)
    : sessions.sessions[0];
  assertTruthy(targetSession, `target session ${explicitSessionId || "(latest)"} exists`);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/live?token=${encodeURIComponent(token)}`);
  await websocketMessage(ws);

  const send = await postJson(`${base}/api/sessions/${targetSession.id}/messages`, {
    message,
    model,
    reasoning
  }, token);
  assertTruthy(send.dispatch?.ok, "remote send accepted");
  const recordId = send.record?.id;
  assertTruthy(recordId, "remote send record id");

  const bridge = await waitForBridgeResult(ws, recordId, 60000);
  ws.close();
  assertEqual(bridge.job.status, "sent", "bridge job status");
  assertEqual(bridge.job.transport, "app-server", "bridge transport");

  console.log("OK bridge acceptance");
  console.log(JSON.stringify({
    port,
    stateDir,
    sessionId: targetSession.id,
    sessionTitle: targetSession.title,
    model,
    reasoning,
    bridgeStatus: bridge.job.status
  }, null, 2));
} catch (error) {
  console.error(redactLog(error.stack || error.message || error));
  process.exitCode = 1;
} finally {
  await stopChild(child);
}

async function waitForJson(url, timeoutMs) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      return await getJson(url);
    } catch (error) {
      lastError = error;
      if (child.exitCode !== null) break;
      await delay(250);
    }
  }
  throw new Error(`Server did not become ready: ${redactLog(lastError?.message || stderr || stdout)}`);
}

async function getJson(url, authToken = "") {
  const response = await fetch(url, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {}
  });
  return parseResponse(response, "GET", url);
}

async function postJson(url, body, authToken = "") {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
    },
    body: JSON.stringify(body)
  });
  return parseResponse(response, "POST", url);
}

async function parseResponse(response, method, url) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} ${url} failed with ${response.status}: ${text}`);
  return data;
}

function websocketMessage(ws) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("Timed out waiting for websocket snapshot"));
    }, 5000);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
    ws.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function waitForBridgeResult(ws, recordId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for bridge result"));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("error", onError);
    }
    function onMessage(data) {
      const payload = JSON.parse(data.toString());
      if (payload.type !== "bridge" || payload.job?.id !== recordId) return;
      if (!["sent", "app_server_failed", "failed"].includes(payload.job.status)) return;
      cleanup();
      resolve(payload);
    }
    function onError(error) {
      cleanup();
      reject(error);
    }
    ws.on("message", onMessage);
    ws.on("error", onError);
  });
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTruthy(value, label) {
  if (!value) throw new Error(`${label}: expected truthy value`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redactLog(text) {
  return String(text || "")
    .replace(/Authorized URL:\s*\S+/g, "Authorized URL: [redacted]")
    .replace(/Pairing code:\s*\d{6}/g, "Pairing code: [redacted]")
    .replace(/token=[^\s"'<>]+/g, "token=[redacted]")
    .replaceAll(token, "[redacted-token]")
    .replaceAll(pairingCode, "[redacted-pairing-code]");
}

function stopChild(target) {
  return new Promise((resolve) => {
    if (target.exitCode !== null || target.signalCode) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      if (target.exitCode === null) target.kill("SIGKILL");
      resolve();
    }, 5000);
    target.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    target.kill();
  });
}
