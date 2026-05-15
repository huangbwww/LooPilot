import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.LOOPILOT_ACCEPT_PORT || 45000 + Math.floor(Math.random() * 1000));
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "loopilot-accept-browser-state-"));
const browserProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), "loopilot-accept-browser-profile-"));
const screenshotPath = path.resolve(process.env.LOOPILOT_ACCEPT_BROWSER_SCREENSHOT || path.join(root, ".tmp", "accept-browser-mobile.png"));
const domPath = path.resolve(process.env.LOOPILOT_ACCEPT_BROWSER_DOM || path.join(root, ".tmp", "accept-browser-mobile.html"));
const token = `accept-browser-${Date.now().toString(36)}`;
const pairingCode = "123456";
const queueBadgeText = "\u961f\u5217";
const composerPlaceholderText = "\u7ed9\u5f53\u524d Codex \u4f1a\u8bdd\u53d1\u9001\u6d88\u606f";
const permissionText = "\u5b8c\u5168\u8bbf\u95ee\u6743\u9650";

fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
fs.mkdirSync(path.dirname(domPath), { recursive: true });

if (!fs.existsSync(path.join(root, "build", "index.html"))) {
  throw new Error("Production build not found. Run `npm run build` before `npm run accept:browser`.");
}

const server = spawn(process.execPath, [path.join(root, "server", "index.mjs"), "--prod"], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    LOOPILOT_BRIDGE_MODE: "queue",
    LOOPILOT_STATE_DIR: stateDir,
    LOOPILOT_TOKEN: token,
    LOOPILOT_PAIRING_CODE: pairingCode
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});

let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

try {
  const base = `http://127.0.0.1:${port}`;
  const health = await waitForJson(`${base}/api/health`, 15000);
  assertEqual(health.bridgeMode, "queue", "browser acceptance bridge mode");

  const sessions = await getJson(`${base}/api/sessions`, token);
  assertTruthy(Array.isArray(sessions.sessions), "sessions array");
  assertTruthy(sessions.sessions.length > 0, "at least one Codex session");

  const browser = resolveChromePath();
  const url = `${base}/?token=${encodeURIComponent(token)}`;
  const commonArgs = [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-gpu-sandbox",
    "--disable-gpu-compositing",
    "--disable-software-rasterizer",
    "--disable-accelerated-2d-canvas",
    "--disable-accelerated-video-decode",
    "--disable-features=VizDisplayCompositor",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-proxy-server",
    "--proxy-server=direct://",
    "--proxy-bypass-list=*",
    `--user-data-dir=${browserProfileDir}`,
    "--window-size=390,844",
    "--force-device-scale-factor=1",
    "--timeout=10000",
    "--virtual-time-budget=10000",
    "--run-all-compositor-stages-before-draw"
  ];

  const dom = await runBrowserForStdout(browser, [...commonArgs, "--dump-dom", url], 30000);
  fs.writeFileSync(domPath, dom);
  assertIncludes(dom, "app-shell", "rendered app shell");
  assertIncludes(dom, "project-group", "rendered project groups");
  assertIncludes(dom, "project-header", "rendered project headers");
  assertIncludes(dom, "session-row", "rendered session rows");
  assertIncludes(dom, "composer", "rendered composer");
  assertIncludes(dom, "option-trigger", "rendered control menu triggers");
  assertIncludes(dom, "gpt-5.5", "rendered model control");
  assertIncludes(dom, "aria-label=\"Reasoning\"", "rendered reasoning control");
  assertIncludes(dom, permissionText, "rendered permission control");
  assertIncludes(dom, queueBadgeText, "rendered safe-mode queue badge");
  assertIncludes(dom, composerPlaceholderText, "rendered composer placeholder");

  await runBrowser(browser, [...commonArgs, `--screenshot=${screenshotPath}`, url], 30000);
  const bytes = fs.readFileSync(screenshotPath);
  const dimensions = readPngDimensions(bytes);
  assertEqual(dimensions.width, 390, "screenshot width");
  assertEqual(dimensions.height, 844, "screenshot height");
  assertTruthy(bytes.length > 10000, "screenshot has visible content");

  console.log("OK browser acceptance");
  console.log(JSON.stringify({
    port,
    stateDir,
    screenshotPath,
    domPath,
    screenshot: dimensions,
    sessionCount: sessions.sessions.length,
    firstSessionTitle: sessions.sessions[0]?.title || null
  }, null, 2));
} finally {
  await stopChild(server);
  fs.rmSync(browserProfileDir, { recursive: true, force: true });
}

async function waitForJson(url, timeoutMs) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      return await getJson(url);
    } catch (error) {
      lastError = error;
      if (server.exitCode !== null) break;
      await delay(250);
    }
  }
  throw new Error(`Server did not become ready: ${redact(lastError?.message || serverOutput)}`);
}

async function getJson(url, authToken = "") {
  const response = await fetch(url, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {}
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}: ${text}`);
  return JSON.parse(text);
}

function resolveChromePath() {
  const candidates = [
    process.env.LOOPILOT_ACCEPT_CHROME,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error("Chrome or Edge was not found. Set LOOPILOT_ACCEPT_CHROME to a Chromium executable.");
  }
  return found;
}

function runBrowserForStdout(file, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    runBrowser(file, args, timeoutMs, {
      onStdout: (chunk) => {
        stdout += chunk;
      }
    }).then(() => resolve(stdout), reject);
  });
}

function runBrowser(file, args, timeoutMs, hooks = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Browser command timed out: ${redactArgs(args).join(" ")}`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => hooks.onStdout?.(chunk.toString()));
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Browser exited with ${code ?? signal}: ${redact(stderr)}`));
    });
  });
}

function readPngDimensions(buffer) {
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function redactArgs(args) {
  return args.map((arg) => redact(arg));
}

function redact(text = "") {
  return String(text)
    .replace(/token=[^&\s"]+/g, "token=[redacted]")
    .replace(new RegExp(escapeRegExp(token), "g"), "[redacted-token]")
    .replace(new RegExp(escapeRegExp(pairingCode), "g"), "[redacted-pairing-code]")
    .replace(/Authorized URL:\s*[^\r\n]+/g, "Authorized URL: [redacted]")
    .replace(/Pairing code:\s*\d{6}/g, "Pairing code: [redacted]");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertIncludes(text, expected, label) {
  if (!text.includes(expected)) {
    throw new Error(`${label}: expected rendered DOM to include ${JSON.stringify(expected)}`);
  }
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
    if (!target || target.exitCode !== null || target.signalCode) {
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
