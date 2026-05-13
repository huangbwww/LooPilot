import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("uses LOOPILOT_STATE_DIR when provided", async () => {
  const previous = process.env.LOOPILOT_STATE_DIR;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loopilot-state-env-"));
  process.env.LOOPILOT_STATE_DIR = path.join(root, "custom-state");
  const state = await import(`../server/state.mjs?env=${Date.now()}`);

  assert.equal(state.getStateDir(), path.join(root, "custom-state"));

  if (previous === undefined) delete process.env.LOOPILOT_STATE_DIR;
  else process.env.LOOPILOT_STATE_DIR = previous;
});

test("falls back to a user state directory when project .loopilot is not writable", async () => {
  const previousState = process.env.LOOPILOT_STATE_DIR;
  const previousLocal = process.env.LOCALAPPDATA;
  const previousCwd = process.cwd();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loopilot-state-fallback-"));
  const localAppData = path.join(root, "local-app-data");

  delete process.env.LOOPILOT_STATE_DIR;
  process.env.LOCALAPPDATA = localAppData;
  fs.writeFileSync(path.join(root, ".loopilot"), "not a directory", "utf8");
  process.chdir(root);

  try {
    const state = await import(`../server/state.mjs?fallback=${Date.now()}`);
    const expected = process.platform === "win32"
      ? path.join(localAppData, "LooPilot")
      : path.join(os.homedir(), ".loopilot");
    assert.equal(state.getStateDir(), expected);
  } finally {
    process.chdir(previousCwd);
    if (previousState === undefined) delete process.env.LOOPILOT_STATE_DIR;
    else process.env.LOOPILOT_STATE_DIR = previousState;
    if (previousLocal === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocal;
  }
});

test("falls back to temp state when project and user state directories are not writable", async () => {
  const previousState = process.env.LOOPILOT_STATE_DIR;
  const previousLocal = process.env.LOCALAPPDATA;
  const previousCwd = process.cwd();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loopilot-state-temp-"));
  const localAppData = path.join(root, "local-app-data");

  delete process.env.LOOPILOT_STATE_DIR;
  process.env.LOCALAPPDATA = localAppData;
  fs.mkdirSync(localAppData, { recursive: true });
  fs.writeFileSync(path.join(root, ".loopilot"), "not a directory", "utf8");
  if (process.platform === "win32") {
    fs.writeFileSync(path.join(localAppData, "LooPilot"), "not a directory", "utf8");
  }
  process.chdir(root);

  try {
    const state = await import(`../server/state.mjs?temp=${Date.now()}`);
    const expected = process.platform === "win32"
      ? path.join(os.tmpdir(), "LooPilot")
      : path.join(os.homedir(), ".loopilot");
    assert.equal(state.getStateDir(), path.resolve(expected));
  } finally {
    process.chdir(previousCwd);
    if (previousState === undefined) delete process.env.LOOPILOT_STATE_DIR;
    else process.env.LOOPILOT_STATE_DIR = previousState;
    if (previousLocal === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocal;
  }
});
