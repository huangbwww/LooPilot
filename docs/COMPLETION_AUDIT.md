# LooPilot Completion Audit

This audit maps the original product requirements to concrete artifacts and current evidence.

## Success Criteria

1. Phone browser can access local Codex Desktop sessions, including existing conversations.
2. Phone UI can show every conversation's current output, state, and task progress, with live sync.
3. Phone UI can send remote messages to a selected Codex session.
4. Phone UI alerts and responds when Codex needs user confirmation, authorization, or a choice.
5. Product supports public internet access without requiring the phone to be on the same LAN.
6. Startup is simple, ideally one command.
7. Mobile PWA is polished and mirrors core Windows Codex App interaction patterns such as conversation drawer, conversation switching, model selection, and reasoning effort selection.

## Requirement Mapping

| Requirement | Artifact / Evidence | Status |
| --- | --- | --- |
| Existing Codex conversations | `server/codexStore.mjs` reads `~/.codex/session_index.jsonl` and rollout JSONL files under `~/.codex/sessions`. `npm run doctor` found 30 rollout files in the local Codex home. `npm run accept:safe` started the local server in queue mode and authenticated `/api/sessions` returned 30 local Codex sessions. `test/codexStore.test.mjs` validates fixture parsing. | Implemented and tested with fixture plus local doctor and safe-mode runtime evidence. |
| Current output, status, progress | `server/codexStore.mjs` parses messages, tool calls, task events, token usage, status, pending actions, and recent progress. `src/main.jsx` renders metrics, timeline, outbox, and pending prompts. | Implemented and unit-tested for main parser paths. |
| Real-time sync | `server/index.mjs` watches Codex paths with `chokidar` and broadcasts snapshots over `/live` WebSocket. `src/main.jsx` subscribes to `/live`, uses `wss:` automatically on HTTPS public URLs, updates the session list, and reloads the selected session detail on snapshots so the open timeline/output can advance. `test/server.integration.test.mjs` starts the local server, authenticates, receives the initial `/live` snapshot, appends a new assistant message to a rollout JSONL file, and verifies that the WebSocket receives an updated snapshot with the new `lastOutput`. `test/mobilePwa.acceptance.test.mjs` verifies HTTPS-to-`wss:` selection and selected-detail refresh wiring. | Implemented and covered by local integration plus mobile acceptance tests. Browser visual re-check was attempted but did not complete in the current environment. |
| Remote send | `src/main.jsx` posts to `/api/sessions/:id/messages` with selected model and reasoning effort, then reloads session detail with the auth token. `server/index.mjs` queues the message and calls `dispatchRemoteMessage`. `server/codexBridge.mjs` supports app-server bridge plus `queue` safe mode; CLI fallback requires `LOOPILOT_ENABLE_CLI_FALLBACK=1` to avoid duplicate sends after partial app-server failures. `test/server.integration.test.mjs` verifies HTTP send in queue mode. `test/codexAppServer.integration.test.mjs` runs a fake Codex app-server WebSocket on a random local port and verifies `initialize`, `thread/resume`, `turn/start`, selected model/reasoning, text input payload, approval request detection, approval response mapping back to `{ decision: "accept" }`, and that reused app-server connections route server requests to the latest turn callback. `scripts/accept-bridge.mjs` provides a one-command real app-server acceptance check that requires an explicit session id or `LOOPILOT_ACCEPT_USE_LATEST=1`, sends a short message, waits for a `sent` bridge update, and disables CLI fallback so app-server failures are visible. `test/mobilePwa.acceptance.test.mjs` verifies send payload and authenticated detail refresh wiring. | Implemented and queue/fake app-server tested, with a real app-server acceptance command. Full real `codex app-server` end-to-end not re-tested after the reported blue screen. |
| Confirmation / authorization / choice alerts | `server/codexStore.mjs` detects `request_user_input`, plugin install, and app-server approval requests, and suppresses already answered actions from both detail and list summaries. `src/main.jsx` renders approval buttons, choice options, and a custom answer field so questions without suitable preset options can still be answered. `server/index.mjs` preserves `{ decision, answers }` action payloads for local records and bridge responses. `src/notifications.js` builds pending-action notifications and triggers browser Notification plus vibration when permission is granted. `public/sw.js` focuses or opens the PWA on notification click. `server/codexAppServer.mjs` maps decisions back to Codex protocol responses. | Implemented and unit-tested/static-tested for response mapping, local/bridge pending cleanup, notification payloads, custom answer wiring, and action API answer preservation. |
| Public internet access | `server/tunnel.mjs` downloads/caches private `cloudflared`, starts a trycloudflare tunnel in HTTP/2 mode, and prints the public URL without embedding the access token. Phone sign-in uses the pairing code or an explicitly pasted token. `README.md` documents `npm run dev:public` and `npm run accept:public`. `test/tunnel.test.mjs` verifies public tunnel output does not embed tokens. `test/server.integration.test.mjs` runs `server/index.mjs --public` with `LOOPILOT_FAKE_TUNNEL_URL` so no network or cloudflared process starts, verifies that the public URL line has no token, public `/api/health` reports `publicMode: true`, and pairing still returns the configured token. `scripts/accept-public.mjs` provides a one-command real tunnel acceptance check that waits for a public URL, verifies local health, pairing, sessions, and WebSocket snapshots, then stops the server. The script uses random credentials, redacts captured startup logs on failure, and `server/index.mjs` now keeps the tunnel handle so shutdown can kill it. `test/acceptScripts.test.mjs` runs that script with a fake tunnel URL and fixture Codex home to verify the command completes, does not print `token=`, and redacts credentials on tunnel URL validation and assertion failures. `test/server.integration.test.mjs` also verifies shutdown exits with an active `/live` WebSocket client. | Implemented with token-leak prevention, no-network public-mode startup-path coverage, and a real tunnel acceptance command. Quick real tunnel was verified once before the reported blue screen. After the blue screen, `npm run accept:public` was attempted but did not complete because the first `cloudflared` download/startup did not print a public URL before the acceptance timeout. |
| One-command startup | `npm run dev`, `npm run dev:safe`, `npm run dev:public`, `npm run accept:safe`, `npm run accept:public`, and `npm run accept:bridge` exist. `README.md` documents them. Startup prints an authorized URL and a 6-digit pairing code. `server/doctor.mjs` reports token and pairing-code readiness without exposing the pairing code. `server/state.mjs` falls back from project `.loopilot` to user state and temp state when directories are not writable. `server/index.mjs` puts Vite middleware cache under the LooPilot state directory. | Implemented and covered by state plus local server integration tests. Manual safe-mode startup reached the authorized URL after these fixes. On 2026-05-13, `dev:safe` was started through a PowerShell job with `LOOPILOT_BRIDGE_MODE=queue`, exchanged pairing code `123456` for a test token, and authenticated `/api/sessions` returned 30 local Codex sessions. `npm run accept:safe` automates this low-risk runtime check and verifies a WebSocket snapshot before stopping the server. After the blue screen, `npm run accept:public` was attempted but timed out before a public URL printed; `npm run accept:bridge` has not been run after the reported blue screen. |
| PWA | `public/manifest.webmanifest`, `public/sw.js`, and `public/icon.svg` exist. Service worker cache is versioned as `loopilot-v3` so installed PWAs receive the current pairing/security updates. Service worker avoids API/WebSocket fallback. `test/mobilePwa.acceptance.test.mjs` verifies install metadata, offline shell assets, cache version, service worker registration, and API/WebSocket bypass. | Implemented and covered by static PWA acceptance tests. |
| Mobile interaction model | `src/main.jsx` and `src/styles.css` implement mobile-first layout, left drawer, session list, timeline, status metrics, model/reasoning selectors, composer, auth gate, notification button, and queue-mode indicator. `test/mobilePwa.acceptance.test.mjs` verifies drawer state, scrim dismissal, safe-area rules, `100svh`, session switching, model/reasoning controls, textarea, disabled send state, and send payload wiring. | Implemented and covered by static mobile acceptance tests. Browser screenshot verification was attempted, but not completed after the reported blue screen. |
| Public access security | `server/auth.mjs` creates/reuses a token and a 6-digit pairing code. `/api/pair` exchanges a valid pairing code for the device token, so phone setup does not require pasting the full tokenized URL. Random pairing codes rotate after successful exchange unless `LOOPILOT_PAIRING_CODE` pins one explicitly. Pairing attempts are rate-limited in memory. API and WebSocket require token. Public `/api/health` only exposes non-sensitive status; authenticated `/api/system` returns local system details such as `codexHome`. Frontend consumes `?token=` or pairing code, stores the token, and provides a sign-out control to clear the phone token and re-pair. `test/server.integration.test.mjs` verifies pairing, pairing-code rotation, pairing rate limits, unauthenticated API rejection, non-sensitive public health, authenticated system info, and authenticated API/WebSocket access. `test/mobilePwa.acceptance.test.mjs` verifies sign-out wiring. | Implemented and tested. |
| Restricted Windows filesystem behavior | `server/state.mjs` probes state directory writability and falls back to user/temp locations. Vite dev cache is also moved to state dir. | Implemented and tested by `test/state.test.mjs`; `npm run doctor` currently reports token under `%TEMP%\LooPilot`. |

## Current Verification Commands

Run:

```bash
npm run verify
```

Current verified gates:

- `npm run lint`
- `npm test` currently reports 35 passing tests.
- `npm run build`
- `npm run doctor`
- `npm audit --omit=dev`

Run this when the machine should avoid public tunnels and real Codex bridge processes:

```bash
npm run accept:safe
```

Run this when the machine is stable enough to start the real public tunnel process:

```bash
npm run accept:public
```

Run this when the machine is stable enough to start the real Codex app-server bridge and send a short message to a selected session:

```bash
$env:LOOPILOT_ACCEPT_SESSION_ID = "<session-id>"
npm run accept:bridge
```

Additional low-risk runtime check completed on 2026-05-13:

- `npm run accept:safe`, which starts safe mode with a temporary state directory, fixed test token, and fixed test pairing code.
- `GET /api/health` returned `ok: true`, `publicMode: false`, and `bridgeMode: "queue"`.
- `POST /api/pair` returned the configured test token.
- Authenticated `GET /api/sessions` returned 30 local Codex sessions.
- Authenticated `/live` WebSocket returned a snapshot containing local sessions.

## Known Unverified Items

These items prevent declaring the goal fully complete:

- Public tunnel was attempted after the reported system blue screen, but did not complete because the first `cloudflared` download/startup did not print a public URL before the acceptance timeout. `npm run accept:public` exists to rerun that check in a controlled one-command flow.
- `codex app-server` remote-send bridge was not re-run end-to-end after the reported system blue screen. `npm run accept:bridge` now exists to run that check in a controlled one-command flow.
- Browser/PWA visual verification was not completed after the reported system blue screen.

Recommended safe next step:

```bash
npm run dev:safe
```

Use this to validate local phone UI behavior without launching Codex bridge processes. Follow `docs/ACCEPTANCE_RUNBOOK.md` for the final safe, browser, public tunnel, and real bridge acceptance sequence.
