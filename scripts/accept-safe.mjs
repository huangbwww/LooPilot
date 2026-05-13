import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.LOOPILOT_ACCEPT_PORT || 44000 + Math.floor(Math.random() * 1000));
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "loopilot-accept-safe-"));
const token = `accept-safe-${Date.now().toString(36)}`;
const pairingCode = "123456";

const child = spawn(process.execPath, [path.join(root, "server", "safe.mjs")], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
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
  const health = await waitForJson(`${base}/api/health`, 15000);
  assertEqual(health.ok, true, "health ok");
  assertEqual(health.publicMode, false, "safe mode public flag");
  assertEqual(health.bridgeMode, "queue", "safe mode bridge mode");

  const pair = await postJson(`${base}/api/pair`, { code: pairingCode });
  assertEqual(pair.token, token, "pairing token");

  const system = await getJson(`${base}/api/system`, token);
  assertEqual(system.bridgeMode, "queue", "authenticated system bridge mode");
  assertTruthy(system.codexHome, "authenticated system codex home");

  const sessions = await getJson(`${base}/api/sessions`, token);
  assertTruthy(Array.isArray(sessions.sessions), "sessions array");
  assertTruthy(sessions.sessions.length > 0, "at least one Codex session");

  const snapshot = await websocketSnapshot(port, token);
  assertEqual(snapshot.type, "snapshot", "websocket snapshot type");
  assertTruthy(snapshot.sessions.length > 0, "websocket snapshot sessions");

  console.log("OK safe acceptance");
  console.log(JSON.stringify({
    port,
    stateDir,
    codexHome: system.codexHome,
    sessionCount: sessions.sessions.length,
    firstSessionTitle: sessions.sessions[0]?.title || null,
    bridgeMode: health.bridgeMode
  }, null, 2));
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
  throw new Error(`Server did not become ready: ${lastError?.message || stderr || stdout}`);
}

async function getJson(url, authToken = "") {
  const response = await fetch(url, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {}
  });
  return parseResponse(response, "GET", url);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

function websocketSnapshot(targetPort, authToken) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${targetPort}/live?token=${encodeURIComponent(authToken)}`);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("Timed out waiting for websocket snapshot"));
    }, 5000);
    ws.once("message", (data) => {
      clearTimeout(timer);
      ws.close();
      resolve(JSON.parse(data.toString()));
    });
    ws.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
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

function stopChild(target) {
  return new Promise((resolve) => {
    if (target.exitCode !== null || target.signalCode) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      clearTimeout(hardTimer);
      resolve();
    };
    const forceTimer = setTimeout(() => {
      if (target.exitCode === null) target.kill("SIGKILL");
    }, 2000);
    const hardTimer = setTimeout(() => {
      target.stdout?.destroy();
      target.stderr?.destroy();
      target.unref?.();
      finish();
    }, 5000);
    target.once("exit", finish);
    target.kill();
  });
}
