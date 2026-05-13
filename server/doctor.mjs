import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getStateDir } from "./state.mjs";

const cwd = process.cwd();
const stateDir = getStateDir();
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const checks = [
  check("Node.js runtime", () => process.version),
  check("Codex home", () => exists(codexHome)),
  check("Codex session index", () => exists(path.join(codexHome, "session_index.jsonl"))),
  check("Codex sessions directory", () => countJsonl(path.join(codexHome, "sessions"))),
  check("Codex CLI entry", () => findCodexCli()),
  check("Production build", () => exists(path.join(cwd, "build", "index.html"))),
  check("PWA manifest", () => exists(path.join(cwd, "public", "manifest.webmanifest"))),
  check("Access token", () => tokenStatus()),
  check("Pairing code", () => pairingStatus()),
  check("Cached cloudflared", () => cachedCloudflared()),
  check("Bridge mode", () => process.env.LOOPILOT_BRIDGE_MODE || "app-server")
];

let failed = 0;
for (const item of checks) {
  if (!item.ok) failed += 1;
  console.log(`${item.ok ? "OK " : "ERR"} ${item.name}: ${item.detail}`);
}
process.exitCode = failed > 0 ? 1 : 0;

function check(name, fn) {
  try {
    const detail = fn();
    return { name, ok: !String(detail).startsWith("missing"), detail };
  } catch (error) {
    return { name, ok: false, detail: error.message };
  }
}

function exists(target) {
  return fs.existsSync(target) ? target : `missing: ${target}`;
}

function countJsonl(root) {
  if (!fs.existsSync(root)) return `missing: ${root}`;
  let count = 0;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(next);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) count += 1;
    }
  }
  return `${count} rollout files`;
}

function findCodexCli() {
  const candidates = process.platform === "win32"
    ? [
        path.join(process.env.APPDATA || "", "npm", "codex.cmd"),
        path.join(process.env.APPDATA || "", "npm", "codex.ps1")
      ]
    : ["/usr/local/bin/codex", "/opt/homebrew/bin/codex"];
  const found = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  return found || "missing: codex CLI not found in common install locations";
}

function tokenStatus() {
  if (process.env.LOOPILOT_TOKEN) return "provided by LOOPILOT_TOKEN";
  const tokenPath = path.join(stateDir, "auth-token");
  return fs.existsSync(tokenPath) ? tokenPath : "will be generated on first server start";
}

function pairingStatus() {
  if (process.env.LOOPILOT_PAIRING_CODE) return "provided by LOOPILOT_PAIRING_CODE";
  const pairingPath = path.join(stateDir, "pairing-code");
  return fs.existsSync(pairingPath) ? "stored in state directory" : "will be generated on first server start";
}

function cachedCloudflared() {
  const name = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  const target = path.join(stateDir, "bin", name);
  return fs.existsSync(target) ? target : "will be downloaded by npm run dev:public";
}
