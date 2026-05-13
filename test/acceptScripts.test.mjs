import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocketServer } from "ws";

const projectRoot = path.resolve(import.meta.dirname, "..");

test("accept-public script completes with a fake tunnel URL", { timeout: 30000 }, async () => {
  const fixture = makeFixture();
  const publicUrl = "https://loopilot-accept-script.trycloudflare.com";
  const result = await runNodeScript("scripts/accept-public.mjs", {
    CODEX_HOME: fixture.codexHome,
    LOOPILOT_ACCEPT_PORT: String(49200 + Math.floor(Math.random() * 1000)),
    LOOPILOT_FAKE_TUNNEL_URL: publicUrl
  });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /OK public acceptance/);
  assert.match(result.stdout, new RegExp(publicUrl.replaceAll(".", "\\.")));
  assert.doesNotMatch(result.stdout, /token=/);
  assert.match(result.stdout, /"sessionCount": 1/);
});

test("accept-public script redacts credentials when tunnel URL validation fails", { timeout: 30000 }, async () => {
  const fixture = makeFixture();
  const result = await runNodeScript("scripts/accept-public.mjs", {
    CODEX_HOME: fixture.codexHome,
    LOOPILOT_ACCEPT_PORT: String(50200 + Math.floor(Math.random() * 1000)),
    LOOPILOT_ACCEPT_PUBLIC_URL_TIMEOUT_MS: "1000",
    LOOPILOT_FAKE_TUNNEL_URL: "https://not-a-cloudflare-url.example.com"
  });

  assert.notEqual(result.code, 0);
  assert.doesNotMatch(result.stderr, /token=/);
  assert.doesNotMatch(result.stderr, /Authorized URL:\s*http:\/\/[^\s]+/);
  assert.doesNotMatch(result.stderr, /Pairing code:\s*\d{6}/);
  assert.match(result.stderr, /Authorized URL: \[redacted\]/);
  assert.match(result.stderr, /Pairing code: \[redacted\]/);
});

test("accept-public script rejects Cloudflare API URLs as tunnel URLs", { timeout: 30000 }, async () => {
  const fixture = makeFixture();
  const result = await runNodeScript("scripts/accept-public.mjs", {
    CODEX_HOME: fixture.codexHome,
    LOOPILOT_ACCEPT_PORT: String(50700 + Math.floor(Math.random() * 1000)),
    LOOPILOT_ACCEPT_PUBLIC_URL_TIMEOUT_MS: "1000",
    LOOPILOT_FAKE_TUNNEL_URL: "https://api.trycloudflare.com"
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Public tunnel URL was not printed/);
  assert.doesNotMatch(result.stderr, /token=/);
  assert.doesNotMatch(result.stderr, /Pairing code:\s*\d{6}/);
});

test("accept-public script redacts credentials from assertion failures", { timeout: 30000 }, async () => {
  const fixture = makeFixture();
  const result = await runNodeScript("scripts/accept-public.mjs", {
    CODEX_HOME: fixture.codexHome,
    LOOPILOT_ACCEPT_PORT: String(51200 + Math.floor(Math.random() * 1000)),
    LOOPILOT_FAKE_TUNNEL_URL: "https://loopilot-accept-script.trycloudflare.com",
    LOOPILOT_TEST_BAD_PAIR_TOKEN: "1"
  });

  assert.notEqual(result.code, 0);
  assert.doesNotMatch(result.stderr, /token=/);
  assert.doesNotMatch(result.stderr, /accept-public-[A-Za-z0-9_-]+/);
  assert.match(result.stderr, /\[redacted-token\]/);
});

test("accept-bridge script requires an explicit target session", { timeout: 30000 }, async () => {
  const result = await runNodeScript("scripts/accept-bridge.mjs", {
    LOOPILOT_ACCEPT_PORT: String(52200 + Math.floor(Math.random() * 1000))
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /LOOPILOT_ACCEPT_SESSION_ID/);
  assert.doesNotMatch(result.stderr, /token=/);
});

test("accept-bridge script completes against a fake app-server", { timeout: 30000 }, async () => {
  const fixture = makeFixture();
  const fake = await startFakeAppServer();
  try {
    const result = await runNodeScript("scripts/accept-bridge.mjs", {
      CODEX_HOME: fixture.codexHome,
      LOOPILOT_ACCEPT_PORT: String(54200 + Math.floor(Math.random() * 1000)),
      LOOPILOT_ACCEPT_USE_LATEST: "1",
      LOOPILOT_CODEX_APP_SERVER_PORT: String(fake.port)
    });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /OK bridge acceptance/);
    assert.match(result.stdout, /"bridgeStatus": "sent"/);
    assert.doesNotMatch(result.stdout, /token=/);
    assert.deepEqual(fake.methods, ["initialize", "initialized", "thread/resume", "turn/start"]);
    assert.deepEqual(fake.initializeParams.capabilities, { experimentalApi: true });
    assert.equal(fake.turnStartParams.model, "gpt-5.5");
    assert.equal(fake.turnStartParams.effort, "high");
    assert.match(fake.turnStartParams.input[0].text, /LooPilot bridge acceptance check/);
  } finally {
    await fake.close();
  }
});

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loopilot-accept-public-test-"));
  const codexHome = path.join(root, ".codex");
  const sessionId = "019e1c98-c592-7dc2-a684-ffec77c153b8";
  const rolloutDir = path.join(codexHome, "sessions", "2026", "05", "13");
  fs.mkdirSync(rolloutDir, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "session_index.jsonl"),
    `${JSON.stringify({ id: sessionId, thread_name: "Accept Public", updated_at: "2026-05-13T01:00:00.000Z" })}\n`
  );
  fs.writeFileSync(
    path.join(rolloutDir, `rollout-2026-05-13T09-00-00-${sessionId}.jsonl`),
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
  return { codexHome };
}

function startFakeAppServer() {
  return new Promise((resolve) => {
    const state = {
      methods: [],
      initializeParams: null,
      turnStartParams: null
    };
    const server = http.createServer((req, res) => {
      if (req.url === "/readyz") {
        res.writeHead(200);
        res.end("ok");
        return;
      }
      res.writeHead(404);
      res.end();
    });
    const wss = new WebSocketServer({ server });

    wss.on("connection", (socket) => {
      socket.on("message", (data) => {
        const message = JSON.parse(data.toString());
        if (message.method) state.methods.push(message.method);
        if (message.method === "initialize") {
          state.initializeParams = message.params;
          socket.send(JSON.stringify({ id: message.id, result: { serverInfo: { name: "Fake Codex" } } }));
        }
        if (message.method === "thread/resume") {
          socket.send(JSON.stringify({ id: message.id, result: { threadId: message.params.threadId } }));
        }
        if (message.method === "turn/start") {
          state.turnStartParams = message.params;
          socket.send(JSON.stringify({ id: message.id, result: { status: "started" } }));
        }
      });
    });

    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: server.address().port,
        get methods() {
          return state.methods;
        },
        get initializeParams() {
          return state.initializeParams;
        },
        get turnStartParams() {
          return state.turnStartParams;
        },
        close: () => new Promise((closeResolve) => {
          for (const client of wss.clients) client.terminate();
          wss.close(() => server.close(closeResolve));
          setTimeout(closeResolve, 1000);
        })
      });
    });
  });
}

function runNodeScript(scriptPath, env) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env };
    for (const key of [
      "LOOPILOT_ACCEPT_MESSAGE",
      "LOOPILOT_ACCEPT_MODEL",
      "LOOPILOT_ACCEPT_PORT",
      "LOOPILOT_ACCEPT_PUBLIC_URL_TIMEOUT_MS",
      "LOOPILOT_ACCEPT_REASONING",
      "LOOPILOT_ACCEPT_SESSION_ID",
      "LOOPILOT_ACCEPT_USE_LATEST",
      "LOOPILOT_FAKE_TUNNEL_URL",
      "LOOPILOT_TEST_BAD_PAIR_TOKEN"
    ]) {
      delete childEnv[key];
    }
    const child = spawn(process.execPath, [path.join(projectRoot, scriptPath)], {
      cwd: projectRoot,
      env: {
        ...childEnv,
        ...env
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
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}
