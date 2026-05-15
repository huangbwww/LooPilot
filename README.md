# LooPilot

Mobile companion for Codex Desktop sessions.

Languages: English | [简体中文](README.zh-CN.md)

## Why I built this

I built LooPilot for the same reason many people build mobile Codex companions: I wanted to check on my Codex work during lunch, on the way home, or during a short break away from my Windows machine. The name is intentionally a little silly. It can read like "loop pilot", a small co-pilot that keeps a Codex loop moving, and also like "loo pilot", because sometimes the most realistic mobile workflow is checking whether Codex is still alive while you are away from your desk, including those very serious restroom status checks 😄.

Before writing it, I tried projects such as Happy, Hapi, Remodex, and a few similar tools. They were useful, but none of them quite fit my own setup. I use Android and Windows, I switch between Codex Desktop and the CLI, and at the moment I use the desktop app more often. What I wanted was not just a remote CLI panel, but something closer to a mobile version of Codex Desktop: project-grouped conversations, live session state, approvals, model and reasoning controls, and the ability to continue a desktop conversation from my phone.

After testing it for a while, I also became more aware of the limits of this idea. A lot of real development work still depends on seeing the Windows machine directly: checking a running app, inspecting UI changes, watching a local preview, or dealing with tools that are not meaningful through text alone. On the phone, LooPilot is good for reading progress, nudging Codex, answering approvals, sending a small follow-up, or making a quick change request. It is not a full replacement for sitting at the machine.

There is also a synchronization tradeoff. Messages sent from LooPilot go through Codex's local app-server bridge and local session files, so they can be recorded and followed by LooPilot, but Codex Desktop itself does not always reflect those externally-started turns as if they were typed directly into the desktop UI. If the goal is truly to operate Codex from outside with full visual feedback, remote desktop from the phone may still be faster and more honest. Modern phone input methods already make voice dictation into a remote desktop session surprisingly workable, which is also why LooPilot does not try to add its own voice input.

So LooPilot is intentionally scoped as a practical companion, not a perfect mobile clone. It is useful enough for my own "check in and steer Codex" workflow, and maybe it will be useful to someone else with a similar Android + Windows setup. If you run into issues or have a workflow that would make it more useful, feel free to open an issue.

## Run

```bash
npm install
npm run dev
```

The server prints an `Authorized URL` containing a local access token and a 6-digit pairing code. On a phone, enter the pairing code first; the browser receives and stores the device token. Random pairing codes rotate after a successful exchange. You can also paste the full token into the login prompt.

When a Codex session needs confirmation, authorization, or a choice, the PWA shows the pending request in the session and can use browser notifications plus vibration after notification permission is granted.

To test only viewing/syncing and queue phone messages without starting Codex bridge processes:

```bash
npm run dev:safe
```

For a one-command local acceptance check that starts safe mode, pairs with a test code, reads local Codex sessions, verifies WebSocket snapshots, and then stops the server:

```bash
npm run accept:safe
```

For a public URL through a temporary tunnel:

```bash
npm run dev:public
```

`dev:public` starts the app and downloads a private `cloudflared` binary into the LooPilot state directory on first run, then prints a public `trycloudflare.com` URL. Use the pairing code printed at startup to sign in from the phone. The tunnel uses HTTP/2 mode.

To run the public tunnel acceptance check in one command:

```bash
npm run accept:public
```

`accept:public` starts `--public`, waits for a public `trycloudflare.com` URL, verifies local health, pairing, sessions, and WebSocket snapshots, then stops the server. It may download and run `cloudflared`, so use `accept:safe` when you want to avoid external processes.

To run the real Codex app-server bridge acceptance check, choose a target session explicitly:

```bash
$env:LOOPILOT_ACCEPT_SESSION_ID = "<session-id>"
npm run accept:bridge
```

`accept:bridge` sends a short message through the app-server bridge and disables CLI fallback for the check, so a failed app-server bridge fails the acceptance run instead of starting `codex resume`. Use `LOOPILOT_ACCEPT_USE_LATEST=1` only after confirming the newest session is the intended target.

The app reads Codex Desktop session JSONL files from `~/.codex`, streams changes to the web UI, and sends phone messages through a local `codex app-server` WebSocket bridge. Bridge activity is also recorded under the LooPilot state directory.

Default local URL: `http://localhost:4317`.

Final acceptance steps are tracked in `docs/ACCEPTANCE_RUNBOOK.md`.

## Notes

- The access token is stored in the LooPilot state directory, or can be set with `LOOPILOT_TOKEN`.
- The pairing code is stored in the LooPilot state directory, or can be set with `LOOPILOT_PAIRING_CODE`.
- The default state directory is project `.loopilot`; if that directory is not writable, LooPilot falls back to the user state directory, then the system temp directory. Set `LOOPILOT_STATE_DIR` to choose it explicitly.
- Set `LOOPILOT_BRIDGE_MODE=queue` to test the phone UI without starting `codex app-server` or `codex resume` when a message is sent.
- Production builds are written to `build/`.
- Set `LOOPILOT_ENABLE_CLI_FALLBACK=1` to allow `codex resume` fallback when the app-server bridge fails. It is disabled by default to avoid duplicate sends after partial app-server failures. On Windows, fallback refuses `.cmd` shell wrappers for remote messages; set `LOOPILOT_CODEX_COMMAND` to a real `codex.exe` if fallback is needed.
- Avoid sharing the public URL; it can control local Codex sessions while the server is running.
