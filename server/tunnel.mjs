import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { getStateDir } from "./state.mjs";

const BIN_DIR = path.join(getStateDir(), "bin");
const CLOUDFLARED_VERSION = "latest";
const DOWNLOAD_TIMEOUT_MS = 90000;

export async function startPublicTunnel(port) {
  const localUrl = `http://localhost:${port}`;
  if (process.env.LOOPILOT_FAKE_TUNNEL_URL) {
    console.log(`Public URL: ${process.env.LOOPILOT_FAKE_TUNNEL_URL}`);
    const fake = new EventEmitter();
    fake.kill = () => fake.emit("close", 0);
    return fake;
  }
  const bundled = await ensureCloudflaredBinary();
  const child = spawn(bundled, ["tunnel", "--protocol", "http2", "--url", localUrl], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  pipeTunnelOutput(child, /https:\/\/[^\s]+\.trycloudflare\.com/i);
  return child;
}

export async function ensureCloudflaredBinary() {
  fs.mkdirSync(BIN_DIR, { recursive: true });
  const target = path.join(BIN_DIR, cloudflaredFilename());
  if (fs.existsSync(target) && fs.statSync(target).size > 1024 * 1024) return target;

  const url = cloudflaredDownloadUrl();
  console.log(`Downloading cloudflared from ${url}`);
  try {
    await downloadWithRetry(url, target);
  } catch (error) {
    if (process.platform !== "win32") throw error;
    console.log(`Node download failed, retrying with PowerShell: ${error.message}`);
    await downloadWithPowerShell(url, target);
  }
  if (process.platform !== "win32") fs.chmodSync(target, 0o755);
  return target;
}

function cloudflaredFilename() {
  return process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
}

function cloudflaredDownloadUrl() {
  const platform = process.platform;
  const arch = os.arch();
  if (platform === "win32" && arch === "x64") return releaseUrl("cloudflared-windows-amd64.exe");
  if (platform === "win32" && arch === "arm64") return releaseUrl("cloudflared-windows-arm64.exe");
  if (platform === "darwin" && arch === "x64") return releaseUrl("cloudflared-darwin-amd64.tgz");
  if (platform === "darwin" && arch === "arm64") return releaseUrl("cloudflared-darwin-arm64.tgz");
  if (platform === "linux" && arch === "x64") return releaseUrl("cloudflared-linux-amd64");
  if (platform === "linux" && arch === "arm64") return releaseUrl("cloudflared-linux-arm64");
  throw new Error(`Unsupported platform for bundled tunnel: ${platform}/${arch}`);
}

function releaseUrl(asset) {
  return `https://github.com/cloudflare/cloudflared/releases/${CLOUDFLARED_VERSION}/download/${asset}`;
}

async function downloadWithRetry(url, destination) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await download(url, destination);
      return;
    } catch (error) {
      lastError = error;
      fs.rmSync(`${destination}.download`, { force: true });
      if (attempt < 3) await sleep(1000 * attempt);
    }
  }
  throw lastError;
}

function download(url, destination, redirects = 0) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      request.destroy(new Error("cloudflared download timed out"));
    }, DOWNLOAD_TIMEOUT_MS);
    const request = https.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        clearTimeout(timeout);
        if (redirects > 5) return reject(new Error("Too many redirects while downloading cloudflared"));
        return resolve(download(new URL(response.headers.location, url).toString(), destination, redirects + 1));
      }
      if (response.statusCode !== 200) {
        response.resume();
        clearTimeout(timeout);
        return reject(new Error(`cloudflared download failed with HTTP ${response.statusCode}`));
      }
      const tmp = `${destination}.download`;
      const file = fs.createWriteStream(tmp);
      response.pipe(file);
      file.on("finish", () => {
        clearTimeout(timeout);
        file.close(() => {
          fs.renameSync(tmp, destination);
          resolve();
        });
      });
      file.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    request.on("error", (error) => {
      clearTimeout(timeout);
      if (!settled) reject(error);
      else reject(error);
    });
  });
}

function downloadWithPowerShell(url, destination) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Invoke-WebRequest -Uri '${url}' -OutFile '${destination}' -TimeoutSec 180`
    ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      if (code === 0 && fs.existsSync(destination)) resolve();
      else reject(new Error(stderr.trim() || `PowerShell download exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pipeTunnelOutput(child, urlPattern) {
  child.stdout.on("data", (chunk) => printTunnelChunk(chunk, urlPattern));
  child.stderr.on("data", (chunk) => printTunnelChunk(chunk, urlPattern));
  child.on("close", (code) => console.log(`Public tunnel exited with code ${code}`));
}

function printTunnelChunk(chunk, urlPattern) {
  const text = chunk.toString();
  const match = text.match(urlPattern);
  if (match) {
    console.log(`Public URL: ${match[0]}`);
  }
  else process.stdout.write(text);
}
