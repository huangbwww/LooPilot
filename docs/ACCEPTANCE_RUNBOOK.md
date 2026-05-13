# LooPilot Acceptance Runbook

Use this runbook for final local acceptance. Run the steps in order and stop if any step fails.

## 1. Safe Local Runtime

This does not start `cloudflared`, `codex app-server`, or `codex resume`.

```bash
npm run accept:safe
```

Expected result:

- Prints `OK safe acceptance`.
- Reports at least one Codex session.
- Exits by itself and leaves no LooPilot server process running.

## 2. Browser / PWA Visual Check

Run the automated headless mobile browser check:

```bash
npm run build
npm run accept:browser
```

Expected result:

- Prints `OK browser acceptance`.
- Starts and stops a safe-mode server by itself.
- Uses a 390x844 mobile Chromium viewport against an authorized PWA URL.
- Runs against the production `build/` output in queue mode.
- Verifies the rendered app shell, session rows, composer, model selector, reasoning selector, queue-mode badge, and composer placeholder in real browser output.
- Writes a screenshot to `.tmp/accept-browser-mobile.png`.
- Writes rendered DOM to `.tmp/accept-browser-mobile.html`.

Set `LOOPILOT_ACCEPT_CHROME` if Chrome or Edge is installed in a non-standard location. Set `LOOPILOT_ACCEPT_BROWSER_SCREENSHOT` to override the screenshot output path.

For manual inspection, start the safe server:

```bash
npm run dev:safe
```

Open the printed local URL in a browser, enter the printed pairing code, then verify:

- The mobile viewport shows a left session drawer.
- Session switching updates the main timeline.
- The top bar shows connection state and pending-action count when present.
- The composer is reachable at the bottom.
- Model and reasoning selectors are reachable above the composer.
- Notification permission can be requested from the top bar.
- Sign out clears the stored token and returns to the pairing screen.
- At mobile width, text does not overlap controls and the drawer scrim closes the sidebar.

Stop the server with `Ctrl+C`.

## 3. Public Tunnel

This may download and run `cloudflared`.

First run the automated public-tunnel check:

```bash
npm run accept:public
```

Expected result:

- Prints `OK public acceptance`.
- Prints a `https://*.trycloudflare.com` public URL with no `token=` query.
- Verifies local health, pairing, authenticated sessions, and WebSocket snapshot.
- Exits by itself and attempts to stop the tunnel process.

The first run may spend several minutes downloading `cloudflared`. To override the public URL wait window, set `LOOPILOT_ACCEPT_PUBLIC_URL_TIMEOUT_MS`.

Then run the manual phone check with the server kept alive:

```bash
npm run dev:public
```

Use the printed public URL on a phone, sign in with the pairing code printed by the server, and confirm the session list loads over mobile data or another network. Stop the server with `Ctrl+C` after the phone check.

## 4. Real Codex App-Server Bridge

This sends a short message to a real Codex session. Choose the target explicitly.

```bash
$env:LOOPILOT_ACCEPT_SESSION_ID = "<session-id>"
npm run accept:bridge
```

`LOOPILOT_ACCEPT_USE_LATEST=1` exists for local developer smoke tests, but do not use it for final acceptance unless you have independently confirmed that the newest session is the intended target. The command sends a real message before reporting success.

```bash
$env:LOOPILOT_ACCEPT_USE_LATEST = "1"
npm run accept:bridge
```

Expected result:

- Prints `OK bridge acceptance`.
- Reports `bridgeStatus: "sent"`.
- Does not fall back to `codex resume`; app-server failure fails the acceptance run.
- Exits by itself and attempts to stop child bridge processes.

## Completion Rule

Do not mark the product complete until all four sections above have been run after the last system restart and their results are recorded in `docs/COMPLETION_AUDIT.md`.
