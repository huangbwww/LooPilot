import fs from "node:fs";
import { get as httpGet } from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { getStateDir } from "./state.mjs";

const BIN_DIR = process.env.LOOPILOT_CLOUDFLARED_DIR || path.join(getStateDir(), "bin");
const CLOUDFLARED_VERSION = "latest";
const DOWNLOAD_TIMEOUT_MS = 90000;

export async function startPublicTunnel(port, options = {}) {
  const localUrl = `http://localhost:${port}`;
  if (process.env.LOOPILOT_FAKE_TUNNEL_URL) {
    console.log(`Public URL: ${process.env.LOOPILOT_FAKE_TUNNEL_URL}`);
    await options.onUrl?.(process.env.LOOPILOT_FAKE_TUNNEL_URL);
    const fake = new EventEmitter();
    fake.kill = () => fake.emit("close", 0);
    return fake;
  }
  const bundled = await ensureCloudflaredBinary();
  const metricsAddress = `127.0.0.1:${await getAvailablePort()}`;
  const child = spawn(bundled, ["tunnel", "--protocol", "http2", "--metrics", metricsAddress, "--url", localUrl], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  pipeTunnelOutput(child, /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/i, options.onUrl);
  pollMetricsForTunnelUrl(child, metricsAddress, options.onUrl);
  return child;
}

export async function ensureCloudflaredBinary() {
  fs.mkdirSync(BIN_DIR, { recursive: true });
  const target = path.join(BIN_DIR, cloudflaredFilename());
  if (await isUsableCloudflaredBinary(target)) return target;
  fs.rmSync(target, { force: true });

  const url = cloudflaredDownloadUrl();
  const archiveTarget = url.endsWith(".tgz") ? `${target}.tgz` : target;
  console.log(`Downloading cloudflared from ${url}`);
  const downloaders = [
    { name: "Node", fn: () => downloadWithRetry(url, archiveTarget) }
  ];
  if (process.platform === "win32") {
    downloaders.push(
      { name: "PowerShell", fn: () => downloadWithPowerShell(url, archiveTarget) },
      { name: "curl.exe", fn: () => downloadWithCurl(url, archiveTarget) }
    );
  }
  let lastError = null;
  for (const downloader of downloaders) {
    fs.rmSync(target, { force: true });
    fs.rmSync(archiveTarget, { force: true });
    fs.rmSync(`${archiveTarget}.download`, { force: true });
    try {
      await downloader.fn();
      if (archiveTarget !== target) await extractCloudflaredArchive(archiveTarget, target);
      if (process.platform !== "win32") fs.chmodSync(target, 0o755);
      if (await isUsableCloudflaredBinary(target)) return target;
      throw new Error("downloaded binary did not run `cloudflared --version` successfully");
    } catch (error) {
      lastError = error;
      if (downloader !== downloaders.at(-1)) console.log(`${downloader.name} download failed, retrying: ${error.message}`);
    }
  }
  throw lastError;
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

function downloadWithCurl(url, destination) {
  return new Promise((resolve, reject) => {
    const child = spawn("curl.exe", [
      "-L",
      "--fail",
      "--retry",
      "3",
      "--connect-timeout",
      "30",
      "--max-time",
      "600",
      "-o",
      destination,
      url
    ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      if (code === 0 && fs.existsSync(destination)) resolve();
      else reject(new Error(stderr.trim() || `curl.exe download exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

function extractCloudflaredArchive(archive, target) {
  return new Promise((resolve, reject) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "loopilot-cloudflared-extract-"));
    const child = spawn("tar", ["-xzf", archive, "-C", tempDir], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      try {
        if (code !== 0) throw new Error(stderr.trim() || `tar exited with code ${code}`);
        const binary = findExtractedCloudflared(tempDir);
        if (!binary) throw new Error("cloudflared archive did not contain a cloudflared binary");
        fs.copyFileSync(binary, target);
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.rmSync(archive, { force: true });
      }
    });
    child.on("error", (error) => {
      fs.rmSync(tempDir, { recursive: true, force: true });
      reject(error);
    });
  });
}

function findExtractedCloudflared(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const found = findExtractedCloudflared(fullPath);
      if (found) return found;
    } else if (entry.name === "cloudflared") {
      return fullPath;
    }
  }
  return "";
}

function isUsableCloudflaredBinary(target) {
  return new Promise((resolve) => {
    if (!fs.existsSync(target) || fs.statSync(target).size <= 1024 * 1024) {
      resolve(false);
      return;
    }
    let child;
    try {
      child = spawn(target, ["--version"], { windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(false);
    }, 15000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pipeTunnelOutput(child, urlPattern, onUrl) {
  child.stdout.on("data", (chunk) => printTunnelChunk(chunk, urlPattern, onUrl));
  child.stderr.on("data", (chunk) => printTunnelChunk(chunk, urlPattern, onUrl));
  child.on("close", (code) => console.log(`Public tunnel exited with code ${code}`));
}

function printTunnelChunk(chunk, urlPattern, onUrl) {
  const text = chunk.toString();
  const match = text.match(urlPattern);
  if (match) {
    console.log(`Public URL: ${match[0]}`);
    onUrl?.(match[0]);
  }
  else process.stdout.write(text);
}

function pollMetricsForTunnelUrl(child, metricsAddress, onUrl) {
  const started = Date.now();
  const timer = setInterval(async () => {
    if (child.exitCode !== null || Date.now() - started > 120000) {
      clearInterval(timer);
      return;
    }
    try {
      const url = await readTunnelUrlFromMetrics(metricsAddress);
      if (!url) return;
      console.log(`Public URL: ${url}`);
      onUrl?.(url);
      clearInterval(timer);
    } catch {
      // cloudflared may not have started the metrics endpoint yet.
    }
  }, 1000);
  timer.unref?.();
  child.once("close", () => clearInterval(timer));
}

function readTunnelUrlFromMetrics(metricsAddress) {
  return new Promise((resolve, reject) => {
    const request = httpGet(`http://${metricsAddress}/metrics`, (response) => {
      let body = "";
      response.on("data", (chunk) => {
        body += chunk.toString();
      });
      response.on("end", () => {
        resolve(body.match(/https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/i)?.[0] || "");
      });
    });
    request.setTimeout(1000, () => request.destroy(new Error("metrics request timed out")));
    request.on("error", reject);
  });
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref?.();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("Unable to reserve a metrics port"));
      });
    });
  });
}
