import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chokidar from "chokidar";
import { WebSocketServer } from "ws";
import { getAuthToken, getPairingCode, isPairingCodeValid, isWsAuthorized, requireAuth, rotatePairingCode } from "./auth.mjs";
import { dispatchRemoteMessage, resolveBridgeRequest } from "./codexBridge.mjs";
import { getStateDir } from "./state.mjs";
import { startPublicTunnel } from "./tunnel.mjs";
import {
  enqueueRemoteMessage,
  ensureStateDirs,
  getCodexHome,
  getSessionDetail,
  getWatchedPaths,
  listSessions,
  resolveAction
} from "./codexStore.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const buildDir = path.join(root, "build");
const args = new Set(process.argv.slice(2));
const port = Number(process.env.PORT || 4317);
const authToken = getAuthToken();
let pairingCode = getPairingCode();
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
let tunnelHandle = null;
const pairAttempts = new Map();
const PAIR_ATTEMPT_LIMIT = 8;
const PAIR_ATTEMPT_WINDOW_MS = 5 * 60 * 1000;

ensureStateDirs();

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    publicMode: args.has("--public"),
    bridgeMode: process.env.LOOPILOT_BRIDGE_MODE || "app-server",
    authRequired: Boolean(authToken)
  });
});

app.post("/api/pair", (req, res) => {
  const pairKey = req.ip || req.socket.remoteAddress || "unknown";
  if (isPairRateLimited(pairKey)) return res.status(429).json({ error: "Too many pairing attempts" });
  if (!isPairingCodeValid(req.body?.code, pairingCode)) return res.status(401).json({ error: "Invalid pairing code" });
  pairAttempts.delete(pairKey);
  if (!process.env.LOOPILOT_PAIRING_CODE) pairingCode = rotatePairingCode();
  res.json({ token: authToken });
});

app.use("/api", requireAuth(authToken));

app.get("/api/system", (_req, res) => {
  res.json({
    ok: true,
    codexHome: getCodexHome(),
    publicMode: args.has("--public"),
    bridgeMode: process.env.LOOPILOT_BRIDGE_MODE || "app-server",
    authRequired: Boolean(authToken)
  });
});

app.get("/api/sessions", (_req, res) => {
  res.json({ sessions: listSessions() });
});

app.get("/api/sessions/:id", (req, res) => {
  const detail = getSessionDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: "Session not found" });
  res.json({ session: detail });
});

app.post("/api/sessions/:id/messages", (req, res) => {
  const message = String(req.body?.message || "").trim();
  if (!message) return res.status(400).json({ error: "Message is required" });
  if (!getSessionDetail(req.params.id)) return res.status(404).json({ error: "Session not found" });
  const record = enqueueRemoteMessage(req.params.id, message, {
    model: req.body?.model,
    reasoning: req.body?.reasoning
  });
  broadcast({ type: "outbox", record });
  const dispatch = dispatchRemoteMessage({
    sessionId: req.params.id,
    message,
    model: req.body?.model,
    reasoning: req.body?.reasoning,
    recordId: record.id,
    onUpdate: (job) => broadcast({ type: "bridge", job })
  });
  res.status(dispatch.ok ? 202 : 409).json({ record, dispatch });
});

app.post("/api/sessions/:id/actions/:actionId", (req, res) => {
  const decision = actionDecisionFromBody(req.body);
  const record = resolveAction(req.params.id, req.params.actionId, decision);
  const bridgeResolved = resolveBridgeRequest(req.params.actionId, decision);
  broadcast({ type: "action", record });
  res.status(202).json({ record, bridgeResolved });
});

if (args.has("--prod")) {
  app.use(express.static(buildDir));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(buildDir, "index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root,
    configFile: false,
    cacheDir: path.join(getStateDir(), "vite-cache"),
    server: { middlewareMode: true },
    appType: "spa"
  });
  app.use(vite.middlewares);
}

wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "snapshot", sessions: listSessions() }));
});

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  if (url.pathname !== "/live" || !isWsAuthorized(request, authToken)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

const watcher = chokidar.watch(getWatchedPaths(), {
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }
});

let broadcastTimer = null;
watcher.on("all", () => {
  clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(() => {
    broadcast({ type: "snapshot", sessions: listSessions() });
  }, 120);
});

server.listen(port, async () => {
  const localUrl = `http://localhost:${port}`;
  const localUrlWithToken = `${localUrl}/?token=${encodeURIComponent(authToken)}`;
  console.log(`LooPilot running at ${localUrl}`);
  console.log(`Authorized URL: ${localUrlWithToken}`);
  console.log(`Pairing code: ${pairingCode}`);
  console.log(`Reading Codex sessions from ${getCodexHome()}`);
  if (args.has("--public")) {
    await startTunnel(port);
  }
});

function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(data);
  }
}

async function startTunnel(targetPort) {
  try {
    tunnelHandle = await startPublicTunnel(targetPort);
  } catch (error) {
    console.error(`Unable to start public tunnel: ${error.message}`);
  }
}

function shutdown() {
  tunnelHandle?.kill?.();
  for (const client of wss.clients) client.terminate();
  wss.close();
  const forceExit = setTimeout(() => process.exit(0), 2000);
  forceExit.unref?.();
  watcher.close().finally(() => {
    server.close(() => process.exit(0));
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

export function actionDecisionFromBody(body = {}) {
  if (body?.answers && typeof body.decision === "string") {
    return { decision: body.decision, answers: body.answers };
  }
  return body?.decision || "approved";
}

function isPairRateLimited(key) {
  const now = Date.now();
  const record = pairAttempts.get(key) || { count: 0, resetAt: now + PAIR_ATTEMPT_WINDOW_MS };
  if (record.resetAt <= now) {
    record.count = 0;
    record.resetAt = now + PAIR_ATTEMPT_WINDOW_MS;
  }
  record.count += 1;
  pairAttempts.set(key, record);
  return record.count > PAIR_ATTEMPT_LIMIT;
}
