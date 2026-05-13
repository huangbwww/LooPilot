import { spawn } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.LOOPILOT_ACCEPT_PORT || 45000 + Math.floor(Math.random() * 1000));
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "loopilot-accept-public-"));
const cloudflaredDir = path.join(os.tmpdir(), "LooPilot", "bin");
const token = randomBytes(32).toString("base64url");
const pairingCode = randomInt(0, 1_000_000).toString().padStart(6, "0");
const publicUrlPattern = /Public URL:\s*(https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com)/i;
const publicUrlTimeoutMs = Number(process.env.LOOPILOT_ACCEPT_PUBLIC_URL_TIMEOUT_MS || 600000);

const child = spawn(process.execPath, [path.join(root, "server", "index.mjs"), "--public"], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    LOOPILOT_CLOUDFLARED_DIR: process.env.LOOPILOT_CLOUDFLARED_DIR || cloudflaredDir,
    LOOPILOT_BRIDGE_MODE: process.env.LOOPILOT_BRIDGE_MODE || "queue",
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
  assertEqual(health.publicMode, true, "public mode flag");
  assertEqual(health.bridgeMode, process.env.LOOPILOT_BRIDGE_MODE || "queue", "bridge mode");

  const publicUrl = await waitForPublicUrl(publicUrlTimeoutMs);
  assertTruthy(publicUrl.startsWith("https://"), "public https URL");
  assertEqual(publicUrl.includes("token="), false, "public URL does not embed token");
  const acceptanceBase = process.env.LOOPILOT_FAKE_TUNNEL_URL ? base : publicUrl;

  const publicHealth = await waitForJson(
    `${acceptanceBase}/api/health`,
    120000,
    `Public URL did not become ready at ${acceptanceBase}`
  );
  assertEqual(publicHealth.ok, true, "public health ok");
  assertEqual(publicHealth.publicMode, true, "public health mode flag");

  const pair = await postJson(`${acceptanceBase}/api/pair`, { code: pairingCode });
  const expectedPairToken = process.env.LOOPILOT_TEST_BAD_PAIR_TOKEN ? "wrong-token" : token;
  assertEqual(pair.token, expectedPairToken, "pairing token");

  const system = await getJson(`${acceptanceBase}/api/system`, token);
  assertEqual(system.publicMode, true, "authenticated system public flag");
  assertTruthy(system.codexHome, "authenticated system codex home");

  const sessions = await getJson(`${acceptanceBase}/api/sessions`, token);
  assertTruthy(Array.isArray(sessions.sessions), "sessions array");
  assertTruthy(sessions.sessions.length > 0, "at least one Codex session");

  const snapshot = await websocketSnapshot(acceptanceBase, token);
  assertEqual(snapshot.type, "snapshot", "websocket snapshot type");
  assertTruthy(snapshot.sessions.length > 0, "websocket snapshot sessions");

  console.log("OK public acceptance");
  console.log(JSON.stringify({
    port,
    publicUrl,
    stateDir,
    codexHome: system.codexHome,
    sessionCount: sessions.sessions.length,
    firstSessionTitle: sessions.sessions[0]?.title || null,
    bridgeMode: health.bridgeMode,
    verifiedViaPublicUrl: !process.env.LOOPILOT_FAKE_TUNNEL_URL
  }, null, 2));
} catch (error) {
  console.error(redactLog(error.stack || error.message || error));
  process.exitCode = 1;
} finally {
  await stopChild(child);
}

async function waitForJson(url, timeoutMs, failurePrefix = "Server did not become ready") {
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
  throw new Error(`${failurePrefix}: ${redactLog(formatError(lastError) || stderr || stdout)}`);
}

function formatError(error) {
  if (!error) return "";
  const cause = error.cause ? ` (${error.cause.code || error.cause.message || error.cause})` : "";
  return `${error.message || error}${cause}`;
}

async function waitForPublicUrl(timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const match = stdout.match(publicUrlPattern) || stderr.match(publicUrlPattern);
    if (match) return match[1];
    if (child.exitCode !== null) break;
    await delay(500);
  }
  throw new Error(`Public tunnel URL was not printed: ${redactLog(stderr || stdout)}`);
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

function websocketSnapshot(baseUrl, authToken) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${websocketBaseUrl(baseUrl)}/live?token=${encodeURIComponent(authToken)}`);
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

function websocketBaseUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
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
