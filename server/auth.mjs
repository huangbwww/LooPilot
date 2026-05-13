import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getStateDir } from "./state.mjs";

const STATE_DIR = getStateDir();
const TOKEN_FILE = path.join(STATE_DIR, "auth-token");
const PAIRING_CODE_FILE = path.join(STATE_DIR, "pairing-code");

export function getAuthToken() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  if (process.env.LOOPILOT_TOKEN) return process.env.LOOPILOT_TOKEN;
  if (fs.existsSync(TOKEN_FILE)) return fs.readFileSync(TOKEN_FILE, "utf8").trim();
  const token = crypto.randomBytes(24).toString("base64url");
  fs.writeFileSync(TOKEN_FILE, token, { encoding: "utf8", mode: 0o600 });
  return token;
}

export function getTokenFromRequest(req) {
  const header = req.get("authorization") || "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  if (typeof req.query?.token === "string") return req.query.token;
  return "";
}

export function getPairingCode() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  if (process.env.LOOPILOT_PAIRING_CODE) return process.env.LOOPILOT_PAIRING_CODE;
  if (fs.existsSync(PAIRING_CODE_FILE)) return fs.readFileSync(PAIRING_CODE_FILE, "utf8").trim();
  return rotatePairingCode();
}

export function rotatePairingCode() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  fs.writeFileSync(PAIRING_CODE_FILE, code, { encoding: "utf8", mode: 0o600 });
  return code;
}

export function isPairingCodeValid(input, code) {
  return timingSafeEqual(String(input || "").trim(), String(code || "").trim());
}

export function requireAuth(token) {
  return (req, res, next) => {
    if (!token) return next();
    const provided = getTokenFromRequest(req);
    if (provided && timingSafeEqual(provided, token)) return next();
    res.status(401).json({ error: "Unauthorized" });
  };
}

export function isWsAuthorized(request, token) {
  if (!token) return true;
  const url = new URL(request.url || "/", "http://127.0.0.1");
  const queryToken = url.searchParams.get("token") || "";
  const header = request.headers.authorization || "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  return timingSafeEqual(queryToken || bearer, token);
}

function timingSafeEqual(a, b) {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}
