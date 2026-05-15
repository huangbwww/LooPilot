import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { WebSocketServer } from "ws";

test("app-server bridge starts a turn and answers approval requests", { timeout: 10000 }, async () => {
  const fake = await startFakeAppServer();
  process.env.LOOPILOT_CODEX_APP_SERVER_PORT = String(fake.port);
  const appServer = await import(`../server/codexAppServer.mjs?case=${Date.now()}`);
  const updates = [];

  try {
    const turn = appServer.startTurnViaAppServer({
      session: {
        id: "019e1c98-c592-7dc2-a684-ffec77c153b8",
        cwd: process.cwd()
      },
      message: "hello from phone",
      attachments: [{
        name: "phone.png",
        path: "D:\\LooPilot\\.loopilot\\attachments\\phone.png",
        mimeType: "image/png",
        size: 68
      }],
      model: "gpt-5.5",
      reasoning: "high",
      approvalPolicy: "on-request",
      sandboxMode: "workspace-write",
      onUpdate: (update) => updates.push(update)
    });

    await waitFor(() => updates.some((update) => update.serverRequestId === "approval-1"), 5000);
    assert.equal(updates.find((update) => update.serverRequestId === "approval-1")?.status, "needs_approval");
    assert.equal(appServer.respondToServerRequest("approval-1", "approved"), true);

    const result = await turn;
    assert.deepEqual(result, { status: "started" });
    assert.deepEqual(fake.approvalResponse, { decision: "accept" });
    assert.deepEqual(fake.methods, ["initialize", "initialized", "thread/resume", "turn/start"]);
    assert.deepEqual(fake.initializeParams.capabilities, { experimentalApi: true });
    assert.equal(fake.threadResumeParams.threadId, "019e1c98-c592-7dc2-a684-ffec77c153b8");
    assert.equal(fake.threadResumeParams.config.model_reasoning_effort, "high");
    assert.equal(fake.threadResumeParams.config.approval_policy, "on-request");
    assert.equal(fake.threadResumeParams.config.sandbox_mode, "workspace-write");
    assert.equal(fake.turnStartParams.model, "gpt-5.5");
    assert.equal(fake.turnStartParams.effort, "high");
    assert.deepEqual(fake.turnStartParams.input, [
      { type: "text", text: "hello from phone", text_elements: [] },
      { type: "local_image", path: "D:\\LooPilot\\.loopilot\\attachments\\phone.png", mime_type: "image/png" }
    ]);
  } finally {
    await fake.close();
  }
});

test("app-server bridge routes server requests to the latest turn callback", { timeout: 10000 }, async () => {
  const fake = await startFakeAppServer();
  process.env.LOOPILOT_CODEX_APP_SERVER_PORT = String(fake.port);
  const appServer = await import(`../server/codexAppServer.mjs?case=${Date.now()}`);
  const firstUpdates = [];
  const secondUpdates = [];

  try {
    const first = appServer.startTurnViaAppServer({
      session: {
        id: "019e1c98-c592-7dc2-a684-ffec77c153b8",
        cwd: process.cwd()
      },
      message: "first",
      model: "gpt-5.5",
      reasoning: "high",
      onUpdate: (update) => firstUpdates.push(update)
    });
    await waitFor(() => firstUpdates.some((update) => update.serverRequestId === "approval-1"), 5000);
    assert.equal(appServer.respondToServerRequest("approval-1", "approved"), true);
    await first;

    const firstCount = firstUpdates.length;
    const second = appServer.startTurnViaAppServer({
      session: {
        id: "019e1c98-c592-7dc2-a684-ffec77c153b8",
        cwd: process.cwd()
      },
      message: "second",
      model: "gpt-5.5",
      reasoning: "high",
      onUpdate: (update) => secondUpdates.push(update)
    });
    await waitFor(() => secondUpdates.some((update) => update.serverRequestId === "approval-1"), 5000);
    assert.equal(firstUpdates.length, firstCount);
    assert.equal(appServer.respondToServerRequest("approval-1", "approved"), true);
    await second;
  } finally {
    appServer.shutdownAppServer();
    await fake.close();
  }
});

test("app-server bridge maps never approval to full sandbox access", { timeout: 10000 }, async () => {
  const fake = await startFakeAppServer();
  process.env.LOOPILOT_CODEX_APP_SERVER_PORT = String(fake.port);
  const appServer = await import(`../server/codexAppServer.mjs?case=${Date.now()}-sandbox-default`);
  const updates = [];

  try {
    const turn = appServer.startTurnViaAppServer({
      session: {
        id: "019e1c98-c592-7dc2-a684-ffec77c153b8",
        cwd: process.cwd()
      },
      message: "needs git push",
      model: "gpt-5.5",
      reasoning: "high",
      approvalPolicy: "never",
      onUpdate: (update) => updates.push(update)
    });
    await waitFor(() => fake.threadResumeParams, 5000);
    assert.equal(fake.threadResumeParams.config.approval_policy, "never");
    assert.equal(fake.threadResumeParams.config.sandbox_mode, "danger-full-access");
    await waitFor(() => updates.some((update) => update.serverRequestId === "approval-1"), 5000);
    assert.equal(appServer.respondToServerRequest("approval-1", "approved"), true);
    await turn;
  } finally {
    appServer.shutdownAppServer();
    await fake.close();
  }
});

function startFakeAppServer() {
  return new Promise((resolve) => {
    const state = {
      methods: [],
      initializeParams: null,
      approvalResponse: null,
      threadResumeParams: null,
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
      let turnRequestId = null;
      socket.on("message", (data) => {
        const message = JSON.parse(data.toString());
        if (message.method) state.methods.push(message.method);
        if (message.method === "initialize") {
          state.initializeParams = message.params;
          socket.send(JSON.stringify({ id: message.id, result: { serverInfo: { name: "Fake Codex" } } }));
        }
        if (message.method === "thread/resume") {
          state.threadResumeParams = message.params;
          socket.send(JSON.stringify({ id: message.id, result: { threadId: message.params.threadId } }));
        }
        if (message.method === "turn/start") {
          turnRequestId = message.id;
          state.turnStartParams = message.params;
          socket.send(JSON.stringify({
            id: "approval-1",
            method: "item/commandExecution/requestApproval",
            params: { command: "echo hello" }
          }));
        }
        if (message.id === "approval-1" && message.result) {
          state.approvalResponse = message.result;
          socket.send(JSON.stringify({ id: turnRequestId, result: { status: "started" } }));
        }
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        port: address.port,
        get methods() {
          return state.methods;
        },
        get approvalResponse() {
          return state.approvalResponse;
        },
        get initializeParams() {
          return state.initializeParams;
        },
        get threadResumeParams() {
          return state.threadResumeParams;
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

async function waitFor(predicate, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for condition");
}
