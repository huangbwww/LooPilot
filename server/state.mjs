import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function getStateDir() {
  if (process.env.LOOPILOT_STATE_DIR) return path.resolve(process.env.LOOPILOT_STATE_DIR);

  const userStateDir = process.platform === "win32"
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "LooPilot")
    : path.join(os.homedir(), ".loopilot");
  const candidates = [
    path.join(process.cwd(), ".loopilot"),
    userStateDir,
    path.join(os.tmpdir(), "LooPilot")
  ];
  return path.resolve(candidates.find(canUseStateDir) || candidates.at(-1));
}

function canUseStateDir(dir) {
  const probe = path.join(dir, ".write-test");
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(probe, "ok", "utf8");
    fs.rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}
