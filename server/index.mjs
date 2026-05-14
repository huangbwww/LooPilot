import express from "express";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chokidar from "chokidar";
import { WebSocketServer } from "ws";
import { getAuthToken, getPairingCode, isPairingCodeValid, isWsAuthorized, requireAuth, rotatePairingCode } from "./auth.mjs";
import { dispatchRemoteMessage, resolveBridgeRequest } from "./codexBridge.mjs";
import { shutdownAppServer } from "./codexAppServer.mjs";
import { getStateDir } from "./state.mjs";
import { normalizeApprovalPolicy, normalizeApprovalScope } from "./options.mjs";
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
app.use(corsForShellClients);

function corsForShellClients(req, res, next) {
  const origin = req.headers.origin;
  if (isAllowedShellOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  return next();
}

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

app.get("/api/sessions/:id/media", (req, res) => {
  const session = getSessionDetail(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  const filePath = String(req.query?.path || "");
  if (!filePath || !path.isAbsolute(filePath)) return res.status(400).json({ error: "Absolute image path is required" });
  const mediaType = imageMediaType(filePath);
  if (!mediaType) return res.status(415).json({ error: "Unsupported media type" });
  const realPath = safeRealpath(filePath);
  if (!realPath || !isSessionMediaPath(session, realPath)) return res.status(403).json({ error: "Image is not referenced by this session" });
  const stat = safeStat(realPath);
  if (!stat?.isFile()) return res.status(404).json({ error: "Image not found" });
  res.type(mediaType);
  res.set("Cache-Control", "private, max-age=60");
  res.sendFile(realPath);
});

app.post("/api/sessions/:id/messages", (req, res) => {
  const message = String(req.body?.message || "").trim();
  if (!message) return res.status(400).json({ error: "Message is required" });
  if (!getSessionDetail(req.params.id)) return res.status(404).json({ error: "Session not found" });
  const approvalPolicy = normalizeApprovalPolicy(req.body?.approvalPolicy);
  const record = enqueueRemoteMessage(req.params.id, message, {
    model: req.body?.model,
    reasoning: req.body?.reasoning,
    approvalPolicy
  });
  broadcast({ type: "outbox", record });
  const dispatch = dispatchRemoteMessage({
    sessionId: req.params.id,
    message,
    model: req.body?.model,
    reasoning: req.body?.reasoning,
    approvalPolicy,
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
  const react = (await import("@vitejs/plugin-react")).default;
  const vite = await createServer({
    root,
    configFile: false,
    plugins: [react()],
    cacheDir: path.join(getStateDir(), "vite-cache"),
    server: {
      middlewareMode: true,
      hmr: false,
      ws: false,
      allowedHosts: args.has("--public") ? [".trycloudflare.com"] : []
    },
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

function isAllowedShellOrigin(origin) {
  if (!origin) return false;
  const explicit = String(process.env.LOOPILOT_ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (explicit.includes(origin)) return true;
  try {
    const url = new URL(origin);
    if (["capacitor:", "ionic:"].includes(url.protocol)) return true;
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function shutdown() {
  tunnelHandle?.kill?.();
  shutdownAppServer();
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
  if (typeof body?.decision === "string") {
    return {
      decision: body.decision,
      ...(body.answers ? { answers: body.answers } : {}),
      ...(normalizeApprovalScope(body.scope) ? { scope: normalizeApprovalScope(body.scope) } : {})
    };
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

function imageMediaType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp"
  }[extension] || "";
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function safeRealpath(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return "";
  }
}

function isSessionMediaPath(session, realPath) {
  const allowed = new Set();
  for (const item of session.timeline || []) {
    for (const src of markdownImageSources(item.text || "")) {
      const normalized = normalizeMediaPath(src);
      if (!normalized || !path.isAbsolute(normalized)) continue;
      const referencedRealPath = safeRealpath(normalized);
      if (referencedRealPath) allowed.add(normalizePathKey(referencedRealPath));
    }
  }
  return allowed.has(normalizePathKey(realPath));
}

function markdownImageSources(text) {
  return [...String(text || "").matchAll(/!\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)].map((match) => match[1]);
}

function normalizeMediaPath(value) {
  let input = String(value || "").trim();
  try {
    input = decodeURIComponent(input);
  } catch {
    return "";
  }
  if (/^file:\/\/\//i.test(input)) {
    input = input.replace(/^file:\/\/\//i, "");
    if (/^[A-Za-z]:\//.test(input)) return input.replace(/\//g, "\\");
    return `/${input}`;
  }
  if (/^file:\/\//i.test(input)) return input.replace(/^file:\/\//i, "");
  return input;
}

function normalizePathKey(filePath) {
  const normalized = path.normalize(filePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
