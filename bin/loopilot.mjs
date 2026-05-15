#!/usr/bin/env node

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const serverPath = path.join(root, "server", "index.mjs");
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (args.includes("--version") || args.includes("-v")) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  console.log(packageJson.version);
  process.exit(0);
}

const serverArgs = args.filter((arg) => arg !== "--safe" && arg !== "--dev");
if (args.includes("--safe")) process.env.LOOPILOT_BRIDGE_MODE = "queue";
if (!args.includes("--dev") && !serverArgs.includes("--prod")) serverArgs.unshift("--prod");

process.argv = [process.argv[0], serverPath, ...serverArgs];
await import(pathToFileURL(serverPath));

function printHelp() {
  console.log(`LooPilot

Usage:
  loopilot [options]

Options:
  --public     Start a temporary Cloudflare tunnel.
  --safe       Queue phone messages without starting Codex bridge processes.
  --dev        Use Vite development middleware instead of the production build.
  --prod       Serve the production build. This is the default for npx/npm.
  --version    Print the installed LooPilot version.
  --help       Show this help.

Examples:
  npx loopilot
  npx loopilot --public
  npx loopilot --safe
`);
}
