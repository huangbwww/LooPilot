import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import WebSocket from "ws";

const projectRoot = path.resolve(import.meta.dirname, "..");

test("local server exposes token-protected sessions, websocket sync, and queue send", async () => {
  const fixture = makeFixture();
  const port = 45217 + Math.floor(Math.random() * 1000);
  const token = "integration-test-token";
  const pairingCode = "123456";
  const child = spawn(process.execPath, [path.join(projectRoot, "server", "index.mjs")], {
    cwd: projectRoot,
    env: {
      ...process.env,
      CODEX_HOME: fixture.codexHome,
      LOOPILOT_BRIDGE_MODE: "queue",
      LOOPILOT_PAIRING_CODE: pairingCode,
      LOOPILOT_STATE_DIR: fixture.stateDir,
      LOOPILOT_TOKEN: token,
      PORT: String(port)
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
    await waitFor(() => stdout.includes("Authorized URL:"), 10000, () => stderr || stdout);
    assert.match(stdout, new RegExp(`token=${token}`));

    const health = await requestJson(port, "/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal("codexHome" in health.body, false);

    const pair = await requestJson(port, "/api/pair", "", {
      method: "POST",
      body: JSON.stringify({ code: pairingCode })
    });
    assert.equal(pair.status, 200);
    assert.equal(pair.body.token, token);

    const badPair = await requestJson(port, "/api/pair", "", {
      method: "POST",
      body: JSON.stringify({ code: "000000" })
    });
    assert.equal(badPair.status, 401);

    const reusedPair = await requestJson(port, "/api/pair", "", {
      method: "POST",
      body: JSON.stringify({ code: pairingCode })
    });
    assert.equal(reusedPair.status, 200);

    let limitedPair = null;
    for (let attempt = 0; attempt < 9; attempt += 1) {
      limitedPair = await requestJson(port, "/api/pair", "", {
        method: "POST",
        body: JSON.stringify({ code: "999999" })
      });
    }
    assert.equal(limitedPair.status, 429);

    const unauthorized = await requestJson(port, "/api/sessions");
    assert.equal(unauthorized.status, 401);

    const system = await requestJson(port, "/api/system", token);
    assert.equal(system.status, 200);
    assert.equal(system.body.codexHome, fixture.codexHome);

    const sessions = await requestJson(port, "/api/sessions", token);
    assert.equal(sessions.status, 200);
    assert.equal(sessions.body.sessions[0].id, fixture.sessionId);

    const snapshot = await websocketSnapshot(port, token);
    assert.equal(snapshot.type, "snapshot");
    assert.equal(snapshot.sessions[0].id, fixture.sessionId);

    const send = await requestJson(port, `/api/sessions/${fixture.sessionId}/messages`, token, {
      method: "POST",
      body: JSON.stringify({ message: "queued from integration", model: "gpt-5.5", reasoning: "high" })
    });
    assert.equal(send.status, 202);
    assert.equal(send.body.dispatch.ok, true);
    assert.equal(send.body.dispatch.job.status, "queued_only");

    const action = await requestJson(port, `/api/sessions/${fixture.sessionId}/actions/ask-1`, token, {
      method: "POST",
      body: JSON.stringify({ decision: "approved", answers: { mode: ["Custom"] } })
    });
    assert.equal(action.status, 202);
    assert.equal(action.body.record.decision, "approved");
    assert.deepEqual(action.body.record.answers, { mode: ["Custom"] });
  } finally {
    await stopChild(child);
  }
});

test("random pairing codes rotate after a successful exchange", async () => {
  const fixture = makeFixture();
  const port = 46317 + Math.floor(Math.random() * 1000);
  const token = "rotating-pair-token";
  const child = spawn(process.execPath, [path.join(projectRoot, "server", "index.mjs")], {
    cwd: projectRoot,
    env: {
      ...process.env,
      CODEX_HOME: fixture.codexHome,
      LOOPILOT_BRIDGE_MODE: "queue",
      LOOPILOT_STATE_DIR: fixture.stateDir,
      LOOPILOT_TOKEN: token,
      PORT: String(port)
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
    await waitFor(() => stdout.includes("Pairing code:"), 10000, () => stderr || stdout);
    const code = stdout.match(/Pairing code:\s*(\d{6})/)?.[1];
    assert.ok(code);

    const first = await requestJson(port, "/api/pair", "", {
      method: "POST",
      body: JSON.stringify({ code })
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.token, token);

    const second = await requestJson(port, "/api/pair", "", {
      method: "POST",
      body: JSON.stringify({ code })
    });
    assert.equal(second.status, 401);
  } finally {
    await stopChild(child);
  }
});

test("websocket broadcasts updated snapshots when rollout files change", async () => {
  const fixture = makeFixture();
  const port = 47317 + Math.floor(Math.random() * 1000);
  const token = "watcher-test-token";
  const child = spawn(process.execPath, [path.join(projectRoot, "server", "index.mjs")], {
    cwd: projectRoot,
    env: {
      ...process.env,
      CODEX_HOME: fixture.codexHome,
      LOOPILOT_BRIDGE_MODE: "queue",
      LOOPILOT_PAIRING_CODE: "123456",
      LOOPILOT_STATE_DIR: fixture.stateDir,
      LOOPILOT_TOKEN: token,
      PORT: String(port)
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

  let ws = null;
  try {
    await waitFor(() => stdout.includes("Authorized URL:"), 10000, () => stderr || stdout);
    ws = new WebSocket(`ws://127.0.0.1:${port}/live?token=${encodeURIComponent(token)}`);
    const initial = await websocketMessage(ws);
    assert.equal(initial.type, "snapshot");
    assert.equal(initial.sessions[0].lastOutput, "ready");

    await delay(1000);
    fs.appendFileSync(
      fixture.rolloutPath,
      `\n${JSON.stringify({
        timestamp: "2026-05-13T01:00:02.000Z",
        type: "response_item",
        payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "live update arrived" }] }
      })}`,
      "utf8"
    );

    const updated = await waitForWebsocketMessage(
      ws,
      (message) => message.type === "snapshot" && message.sessions[0]?.lastOutput === "live update arrived",
      10000
    );
    assert.equal(updated.sessions[0].id, fixture.sessionId);
  } finally {
    ws?.close();
    await stopChild(child);
  }
});

test("public mode starts tunnel path without exposing tokens", async () => {
  const fixture = makeFixture();
  const port = 48317 + Math.floor(Math.random() * 1000);
  const token = "public-mode-token";
  const pairingCode = "123456";
  const publicUrl = "https://loopilot-test.trycloudflare.com";
  const child = spawn(process.execPath, [path.join(projectRoot, "server", "index.mjs"), "--public"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      CODEX_HOME: fixture.codexHome,
      LOOPILOT_BRIDGE_MODE: "queue",
      LOOPILOT_FAKE_TUNNEL_URL: publicUrl,
      LOOPILOT_PAIRING_CODE: pairingCode,
      LOOPILOT_STATE_DIR: fixture.stateDir,
      LOOPILOT_TOKEN: token,
      PORT: String(port)
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
    await waitFor(() => stdout.includes(`Public URL: ${publicUrl}`), 10000, () => stderr || stdout);
    const publicLine = stdout.split(/\r?\n/).find((line) => line.includes("Public URL:"));
    assert.equal(publicLine, `Public URL: ${publicUrl}`);
    assert.doesNotMatch(publicLine, /token=/);

    const health = await requestJson(port, "/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.publicMode, true);
    assert.equal(health.body.bridgeMode, "queue");
    assert.equal("codexHome" in health.body, false);

    const publicShell = await requestText(port, "/", {
      Host: new URL(publicUrl).host
    });
    assert.equal(publicShell.status, 200);
    assert.doesNotMatch(publicShell.body, /Blocked request/);

    const pair = await requestJson(port, "/api/pair", "", {
      method: "POST",
      body: JSON.stringify({ code: pairingCode })
    });
    assert.equal(pair.status, 200);
    assert.equal(pair.body.token, token);
  } finally {
    await stopChild(child);
  }
});

test("server shutdown terminates active websocket clients", async () => {
  const fixture = makeFixture();
  const port = 49317 + Math.floor(Math.random() * 1000);
  const token = "shutdown-test-token";
  const child = spawn(process.execPath, [path.join(projectRoot, "server", "index.mjs")], {
    cwd: projectRoot,
    env: {
      ...process.env,
      CODEX_HOME: fixture.codexHome,
      LOOPILOT_BRIDGE_MODE: "queue",
      LOOPILOT_PAIRING_CODE: "123456",
      LOOPILOT_STATE_DIR: fixture.stateDir,
      LOOPILOT_TOKEN: token,
      PORT: String(port)
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

  let ws = null;
  try {
    await waitFor(() => stdout.includes("Authorized URL:"), 10000, () => stderr || stdout);
    ws = new WebSocket(`ws://127.0.0.1:${port}/live?token=${encodeURIComponent(token)}`);
    const initial = await websocketMessage(ws);
    assert.equal(initial.type, "snapshot");
    child.kill();
    await waitForChildExit(child, 5000);
  } finally {
    ws?.close();
    if (child.exitCode === null && !child.signalCode) await stopChild(child);
  }
});

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loopilot-server-"));
  const codexHome = path.join(root, ".codex");
  const stateDir = path.join(root, ".loopilot");
  const sessionId = "019e1c98-c592-7dc2-a684-ffec77c153b8";
  const rolloutDir = path.join(codexHome, "sessions", "2026", "05", "13");
  const rolloutPath = path.join(rolloutDir, `rollout-2026-05-13T09-00-00-${sessionId}.jsonl`);
  fs.mkdirSync(rolloutDir, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "session_index.jsonl"),
    `${JSON.stringify({ id: sessionId, thread_name: "Server Fixture", updated_at: "2026-05-13T01:00:00.000Z" })}\n`
  );
  fs.writeFileSync(
    rolloutPath,
    [
      JSON.stringify({
        timestamp: "2026-05-13T01:00:00.000Z",
        type: "session_meta",
        payload: { id: sessionId, cwd: root, model: "gpt-5.5" }
      }),
      JSON.stringify({
        timestamp: "2026-05-13T01:00:01.000Z",
        type: "response_item",
        payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "ready" }] }
      })
    ].join("\n")
  );
  return { root, codexHome, stateDir, sessionId, rolloutPath };
}

function requestJson(port, route, token = "", options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      path: route,
      method: options.method || "GET",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    }, (response) => {
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        let parsed = null;
        try {
          parsed = body ? JSON.parse(body) : null;
        } catch (error) {
          error.message = `${error.message} for ${options.method || "GET"} ${route} (${response.statusCode}): ${body.slice(0, 500)}`;
          reject(error);
          return;
        }
        resolve({
          status: response.statusCode,
          body: parsed
        });
      });
    });
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

function requestText(port, route, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      path: route,
      method: "GET",
      headers
    }, (response) => {
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        resolve({
          status: response.statusCode,
          body
        });
      });
    });
    request.on("error", reject);
    request.end();
  });
}

function websocketSnapshot(port, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/live?token=${encodeURIComponent(token)}`);
    ws.on("message", (data) => {
      resolve(JSON.parse(data.toString()));
      ws.close();
    });
    ws.on("error", reject);
  });
}

function websocketMessage(ws) {
  return new Promise((resolve, reject) => {
    ws.once("message", (data) => {
      resolve(JSON.parse(data.toString()));
    });
    ws.once("error", reject);
  });
}

function waitForWebsocketMessage(ws, predicate, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for websocket message"));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("error", onError);
    }
    function onMessage(data) {
      const message = JSON.parse(data.toString());
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    }
    function onError(error) {
      cleanup();
      reject(error);
    }
    ws.on("message", onMessage);
    ws.on("error", onError);
  });
}

async function waitFor(predicate, timeoutMs, getError) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(getError());
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stopChild(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, 2000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill();
  });
}

function waitForChildExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      reject(new Error("Child process did not exit"));
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
