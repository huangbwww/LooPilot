import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const manifest = JSON.parse(fs.readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
const serviceWorker = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

function cssBlock(selector, source = css) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`));
  assert.ok(match, `Expected CSS block for ${selector}`);
  return match.groups.body;
}

function mediaBlock(query) {
  const start = css.indexOf(query);
  assert.notEqual(start, -1, `Expected media query ${query}`);

  const firstBrace = css.indexOf("{", start);
  assert.notEqual(firstBrace, -1, `Expected opening brace for ${query}`);

  let depth = 0;
  for (let index = firstBrace; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") depth -= 1;
    if (depth === 0) return css.slice(firstBrace + 1, index);
  }

  assert.fail(`Expected closing brace for ${query}`);
}

test("mobile PWA shell advertises an installable standalone app", () => {
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /name="viewport"[^>]+width=device-width/);
  assert.match(html, /name="viewport"[^>]+viewport-fit=cover/);
  assert.match(html, /name="theme-color" content="#0f141b"/);
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);

  assert.equal(manifest.name, "LooPilot");
  assert.equal(manifest.short_name, "LooPilot");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.theme_color, "#0f141b");
  assert.ok(manifest.icons.some((icon) => icon.src === "/icon.svg" && icon.sizes === "any"));
});

test("offline shell keeps app assets available without intercepting live API traffic", () => {
  assert.match(serviceWorker, /self\.addEventListener\("install"/);
  assert.match(serviceWorker, /const CACHE = "loopilot-v4"/);
  assert.match(serviceWorker, /self\.skipWaiting\(\)/);
  assert.match(serviceWorker, /\.then\(\(\) => self\.clients\.claim\(\)\)/);
  assert.match(serviceWorker, /cache\.addAll\(ASSETS\)/);
  assert.match(serviceWorker, /"\/manifest\.webmanifest"/);
  assert.match(serviceWorker, /"\/icon\.svg"/);
  assert.match(serviceWorker, /event\.request\.method !== "GET"/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api"\)/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/live"\)/);
  assert.match(serviceWorker, /response\.clone\(\)/);
  assert.match(serviceWorker, /cache\.put\(event\.request, copy\)/);
  assert.match(serviceWorker, /caches\.match\("\/"\)/);
  assert.match(app, /if \("serviceWorker" in navigator\)/);
  assert.match(app, /if \(import\.meta\.env\.PROD\)/);
  assert.match(app, /navigator\.serviceWorker\.register\("\/sw\.js"\)/);
  assert.match(app, /registration\.unregister\(\)/);
});

test("phone layout exposes drawer navigation, scrim dismissal, and safe-area controls", () => {
  assert.match(app, /const \[drawerOpen, setDrawerOpen\] = useState\(false\)/);
  assert.match(app, /className=\{`sidebar \$\{drawerOpen \? "open" : ""\}`\}/);
  assert.match(app, /drawerOpen && <button className="scrim"/);
  assert.match(app, /onClick=\{\(\) => setDrawerOpen\(false\)\}/);
  assert.match(app, /onMenu=\{\(\) => setDrawerOpen\(true\)\}/);

  assert.match(cssBlock(".sidebar-header,\n.topbar,\n.composer"), /env\(safe-area-inset-left\)/);
  assert.match(cssBlock(".sidebar-header,\n.topbar,\n.composer"), /env\(safe-area-inset-right\)/);
  assert.match(css, /\.composer\s*\{[\s\S]*?env\(safe-area-inset-bottom\)[\s\S]*?\}/);

  const mobile = mediaBlock("@media (max-width: 760px)");
  assert.match(cssBlock(".app-shell", mobile), /display:\s*block/);
  assert.match(cssBlock(".sidebar", mobile), /position:\s*fixed/);
  assert.match(cssBlock(".sidebar", mobile), /width:\s*min\(88vw,\s*344px\)/);
  assert.match(cssBlock(".sidebar", mobile), /transform:\s*translateX\(-104%\)/);
  assert.match(cssBlock(".sidebar.open", mobile), /transform:\s*translateX\(0\)/);
  assert.match(cssBlock(".scrim", mobile), /position:\s*fixed/);
  assert.match(cssBlock(".scrim", mobile), /inset:\s*0/);
  assert.match(cssBlock(".workspace", mobile), /height:\s*100svh/);
  assert.match(cssBlock(".mobile-only", mobile), /display:\s*grid/);
});

test("critical mobile actions remain reachable from the authenticated workspace", () => {
  assert.match(app, /localStorage\.setItem\(storedTokenKey, token\)/);
  assert.match(app, /placeholder="6 位配对码或 token"/);
  assert.match(app, /配对失败，请检查 6 位配对码/);
  assert.match(app, /\/\^\\d\{6\}\$\/\.test\(credential\) \? await exchangePairingCode\(credential\) : credential/);
  assert.match(app, /fetch\("\/api\/pair"/);
  assert.match(app, /const protocol = location\.protocol === "https:" \? "wss:" : "ws:"/);
  assert.match(app, /new WebSocket\(`\$\{protocol\}\/\/\$\{location\.host\}\/live\?token=/);
  assert.match(app, /if \(payload\.type === "snapshot"\) \{[\s\S]+loadDetail\(selectedId, authToken\)\.then\(setDetail\);[\s\S]+}/);
  assert.match(app, /fetchSessions\(authToken\)/);
  assert.match(app, /loadDetail\(selected\.id, authToken\)/);
  assert.match(app, /notificationPermission === "default"/);
  assert.match(app, /onClick=\{onEnableNotifications\}/);
  assert.match(app, /localStorage\.removeItem\(storedTokenKey\)/);
  assert.match(app, /aria-label="Sign out"/);
  assert.match(app, /onClick=\{onSignOut\}/);

  assert.match(app, /<SessionList[\s\S]+onSelect=\{\(id\) => \{[\s\S]+setDrawerOpen\(false\);/);
  assert.match(app, /const approvalPolicyOptions = \[/);
  assert.match(app, /const approvalScopeOptions = \[/);
  assert.match(app, /const \[approvalPolicy, setApprovalPolicy\] = useState\(approvalPolicyOptions\[0\]\.value\)/);
  assert.match(app, /<OptionMenu icon=\{<Sparkles size=\{15\} \/>\} label="Model" value=\{model\}/);
  assert.match(app, /<OptionMenu icon=\{<Settings2 size=\{15\} \/>\} label="Reasoning" value=\{reasoning\}/);
  assert.match(app, /label="Approval"[\s\S]+value=\{approvalPolicy\}/);
  assert.match(app, /className="permission-scope"/);
  assert.match(app, /<textarea[\s\S]+onChange=\{\(event\) => setMessage\(event\.target\.value\)\}/);
  assert.match(app, /const \[customAnswers, setCustomAnswers\] = useState\(\{\}\)/);
  assert.match(app, /const \[approvalScope, setApprovalScope\] = useState\("turn"\)/);
  assert.match(app, /const canChooseApprovalScope = session\.pendingAction\.method === "item\/permissions\/requestApproval"/);
  assert.match(app, /className="answer-input"/);
  assert.match(app, /placeholder="Custom answer"/);
  assert.match(app, /\.\.\.\(canChooseApprovalScope \? \{ scope: approvalScope \} : \{\}\)/);
  assert.match(app, /disabled=\{sending \|\| !message\.trim\(\) \|\| !session\?\.id\}/);
  assert.match(app, /body: JSON\.stringify\(\{ message, model, reasoning, approvalPolicy \}\)/);
  assert.match(app, /onSent=\{\(\) => current\?\.id && loadDetail\(current\.id, authToken\)\.then\(setDetail\)\}/);
});

test("session drawer groups conversations by project like Codex desktop", () => {
  assert.match(app, /const groups = groupSessionsByProject\(sessions\)/);
  assert.match(app, /<section className="project-group" key=\{group\.key\}>/);
  assert.match(app, /<div className="project-header">[\s\S]+<Folder size=\{15\} \/>[\s\S]+<span>\{group\.name\}<\/span>/);
  assert.match(app, /function groupSessionsByProject\(sessions\)/);
  assert.match(app, /function projectKey\(cwd\)/);
  assert.match(app, /function projectName\(cwd\)/);
  assert.ok(app.includes("split(/[\\\\/]+/)"));

  assert.match(css, /\.project-group\s*\{/);
  assert.match(css, /\.project-header\s*\{/);
  assert.match(cssBlock(".session-row"), /min-height:\s*62px/);
});

test("doctor reports pairing code status without exposing the code", () => {
  const doctor = fs.readFileSync(new URL("../server/doctor.mjs", import.meta.url), "utf8");
  assert.match(doctor, /check\("Pairing code", \(\) => pairingStatus\(\)\)/);
  assert.match(doctor, /LOOPILOT_PAIRING_CODE/);
  assert.match(doctor, /stored in state directory/);
  assert.doesNotMatch(doctor, /readFileSync\(pairingPath/);
});
