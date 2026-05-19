import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const manifest = JSON.parse(fs.readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const capacitorConfig = JSON.parse(fs.readFileSync(new URL("../capacitor.config.json", import.meta.url), "utf8"));
const androidManifest = fs.readFileSync(new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
const serviceWorker = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../server/index.mjs", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

function cssBlock(selector, source = css) {
  const normalized = source.replace(/\r\n/g, "\n");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = normalized.match(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`));
  assert.ok(match, `Expected CSS block for ${selector}`);
  return match.groups.body;
}

function mediaBlock(query) {
  const normalized = css.replace(/\r\n/g, "\n");
  const start = normalized.indexOf(query);
  assert.notEqual(start, -1, `Expected media query ${query}`);

  const firstBrace = normalized.indexOf("{", start);
  assert.notEqual(firstBrace, -1, `Expected opening brace for ${query}`);

  let depth = 0;
  for (let index = firstBrace; index < normalized.length; index += 1) {
    if (normalized[index] === "{") depth += 1;
    if (normalized[index] === "}") depth -= 1;
    if (depth === 0) return normalized.slice(firstBrace + 1, index);
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
  assert.ok(manifest.icons.some((icon) => icon.src === "/icon-192.png" && icon.sizes === "192x192"));
  assert.ok(manifest.icons.some((icon) => icon.src === "/icon-512.png" && icon.sizes === "512x512"));
});

test("offline shell keeps app assets available without intercepting live API traffic", () => {
  assert.match(serviceWorker, /self\.addEventListener\("install"/);
  assert.match(serviceWorker, /const CACHE = "loopilot-v5"/);
  assert.match(serviceWorker, /self\.skipWaiting\(\)/);
  assert.match(serviceWorker, /\.then\(\(\) => self\.clients\.claim\(\)\)/);
  assert.match(serviceWorker, /cache\.addAll\(ASSETS\)/);
  assert.match(serviceWorker, /"\/manifest\.webmanifest"/);
  assert.match(serviceWorker, /"\/icon-192\.png"/);
  assert.match(serviceWorker, /"\/icon-512\.png"/);
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
  assert.match(cssBlock(".session-surface"), /overflow-x:\s*hidden/);
  assert.match(cssBlock(".session-surface"), /overflow-y:\s*auto/);
  assert.match(cssBlock(".control-row", mobile), /grid-template-columns:\s*minmax\(0,\s*1\.05fr\)\s+minmax\(0,\s*0\.8fr\)\s+minmax\(0,\s*1\.08fr\)/);
  assert.match(cssBlock(".option-menu.has-compact-label .option-label-full", mobile), /display:\s*none/);
  assert.match(cssBlock(".option-menu.has-compact-label .option-label-compact", mobile), /display:\s*inline/);
  assert.match(cssBlock(".choice-grid", mobile), /grid-template-columns:\s*1fr/);
});

test("critical mobile actions remain reachable from the authenticated workspace", () => {
  assert.match(app, /const storedBackendKey = "loopilot\.backendUrl"/);
  assert.match(app, /const nativeShell = isNativeShell\(\)/);
  assert.match(app, /localStorage\.setItem\(storedTokenKey, token\)/);
  assert.match(app, /import QrScanner from "qr-scanner"/);
  assert.match(app, /qr-scanner-worker\.min\.js\?url/);
  assert.match(app, /function PairingScanner\(\{ onResult, onClose, onError \}\)/);
  assert.match(app, /new QrScanner\(/);
  assert.match(app, /preferredCamera: "environment"/);
  assert.match(app, /QrScanner\.scanImage/);
  assert.match(app, /function parsePairingQr\(rawText\)/);
  assert.match(app, /type="submit" disabled=\{scanning\}/);
  assert.match(app, /className="scan-button"/);
  assert.match(app, /placeholder="6 位配对码或 token"/);
  assert.match(app, /配对失败，请检查 6 位配对码/);
  assert.match(app, /exchangePairingCode\(credential, nextBackendUrl \|\| backendUrl\)/);
  assert.match(app, /fetch\(apiUrl\("\/api\/pair", backendUrl\)/);
  assert.match(app, /new WebSocket\(liveUrl\(backendUrl, authToken\)\)/);
  assert.match(app, /const sessionPageSize = 16/);
  assert.match(app, /const detailItemLimit = 120/);
  assert.match(app, /socket\.onclose = scheduleReconnect/);
  assert.match(app, /document\.addEventListener\("visibilitychange", resumeConnection\)/);
  assert.match(app, /setSessions\(\(current\) => mergeSessionLists\(snapshotSessions, current\)\)/);
  assert.match(app, /loadDetail\(selectedIdRef\.current, authToken, backendUrl\)\.then\(setDetail\)/);
  assert.match(app, /fetchSessions\(authToken, backendUrl\)/);
  assert.match(app, /fetchSessions\(authToken, backendUrl, sessionPaging\.nextOffset\)/);
  assert.match(app, /loadDetail\(selected\.id, authToken, backendUrl\)/);
  assert.match(app, /\/api\/sessions\/\$\{id\}\?limit=\$\{detailItemLimit\}/);
  assert.match(app, /notificationPermission === "default"/);
  assert.match(app, /onClick=\{onEnableNotifications\}/);
  assert.match(app, /localStorage\.removeItem\(storedTokenKey\)/);
  assert.match(app, /aria-label="Sign out"/);
  assert.match(app, /onClick=\{onSignOut\}/);

  assert.match(app, /<SessionList[\s\S]+onSelect=\{\(id\) => \{[\s\S]+setDrawerOpen\(false\);/);
  assert.match(app, /hasMore=\{sessionPaging\.hasMore\}/);
  assert.match(app, /function mergeSessionLists\(primary, secondary\)/);
  assert.match(app, /const permissionPresetOptions = \[/);
  assert.match(app, /const approvalScopeOptions = \[/);
  assert.match(app, /value: "default", label: "默认权限", shortLabel: "默认", approvalPolicy: "on-request", sandboxMode: "workspace-write"/);
  assert.match(app, /value: "auto-review", label: "自动审查", shortLabel: "自动", approvalPolicy: "never", sandboxMode: "read-only"/);
  assert.match(app, /value: "full-access", label: "完全访问权限", shortLabel: "完全访问", approvalPolicy: "never", sandboxMode: "danger-full-access"/);
  assert.match(app, /const \[permissionPreset, setPermissionPreset\] = useState\("full-access"\)/);
  assert.match(app, /<OptionMenu icon=\{<Sparkles size=\{15\} \/>\} label="Model" value=\{model\}/);
  assert.match(app, /<OptionMenu icon=\{<Settings2 size=\{15\} \/>\} label="Reasoning" value=\{reasoning\}/);
  assert.match(app, /label="权限"[\s\S]+value=\{permissionPreset\}/);
  assert.match(app, /const hasCompactLabel = selectedShortLabel !== selectedLabel/);
  assert.match(app, /className=\{`option-menu \$\{open \? "open" : ""\} \$\{hasCompactLabel \? "has-compact-label" : ""\}`\}/);
  assert.match(app, /className="permission-scope"/);
  assert.match(app, /<textarea[\s\S]+onChange=\{\(event\) => setMessage\(event\.target\.value\)\}/);
  assert.match(app, /const \[customAnswers, setCustomAnswers\] = useState\(\{\}\)/);
  assert.match(app, /const \[approvalScope, setApprovalScope\] = useState\("turn"\)/);
  assert.match(app, /const canChooseApprovalScope = session\.pendingAction\.method === "item\/permissions\/requestApproval"/);
  assert.match(app, /className="answer-input"/);
  assert.match(app, /placeholder="Custom answer"/);
  assert.match(app, /\.\.\.\(canChooseApprovalScope \? \{ scope: approvalScope \} : \{\}\)/);
  assert.match(app, /const \[attachments, setAttachments\] = useState\(\[\]\)/);
  assert.match(app, /className="attachment-input"/);
  assert.match(app, /accept="image\/\*"/);
  assert.match(app, /attachments: attachmentPayloads/);
  assert.match(app, /disabled=\{!canSend\}/);
  assert.match(app, /permissionPreset: permission\.value/);
  assert.match(app, /approvalPolicy: permission\.approvalPolicy/);
  assert.match(app, /sandboxMode: permission\.sandboxMode/);
  assert.match(app, /onSent=\{\(\) => current\?\.id && loadDetail\(current\.id, authToken, backendUrl\)\.then\(setDetail\)\}/);
  assert.match(app, /<strong>远程发送状态<\/strong>/);
  assert.match(app, /className="outbox-state"/);
  assert.match(app, /function formatOutboxRecord\(record\)/);
});

test("timeline renders markdown, local images, and compact tool summaries", () => {
  assert.match(app, /<TimelineItem key=\{`\$\{item\.id\}-\$\{index\}`\} item=\{item\} sessionId=\{session\.id\} authToken=\{authToken\} backendUrl=\{backendUrl\} \/>/);
  assert.match(app, /function MarkdownContent\(\{ text, sessionId, authToken, backendUrl \}\)/);
  assert.match(app, /const \[collapsed, setCollapsed\] = useState\(false\)/);
  assert.match(app, /className="timeline-toggle"/);
  assert.match(app, /function collapsePreview\(text\)/);
  assert.match(app, /function renderMarkdownBlocks\(text, sessionId, authToken, backendUrl\)/);
  assert.match(app, /function renderInline\(text, sessionId, authToken, backendUrl, keyPrefix\)/);
  assert.match(app, /normalizeMarkdownImages\(String\(text\)\)/);
  assert.match(app, /function normalizeMarkdownImages\(text\)/);
  assert.match(app, /data:image\\\/\[a-z0-9\.\+-\]\+;base64/);
  assert.match(app, /function ImageBlock\(\{ src, alt, sessionId, authToken, backendUrl \}\)/);
  assert.match(app, /fetch\(apiUrl\(`\/api\/sessions\/\$\{encodeURIComponent\(sessionId\)\}\/media\?path=\$\{encodeURIComponent\(imagePathFromMarkdown\(imageSrc\)\)\}`, backendUrl\)/);
  assert.match(app, /Authorization: `Bearer \$\{authToken\}`/);
  assert.match(app, /referrerPolicy="no-referrer"/);
  assert.match(app, /className="markdown-image"/);
  assert.match(app, /className="tool-summary"/);
  assert.match(app, /<details className="tool-details">/);
  assert.match(app, /<summary>查看工具输出<\/summary>/);

  assert.match(css, /\.markdown-body,/);
  assert.match(css, /\.markdown-image\s*\{/);
  assert.match(css, /\.tool-summary\s*\{/);
  assert.match(css, /\.tool-details\s*\{/);
  assert.match(css, /\.timeline-toggle\s*\{/);
  assert.match(css, /\.collapsed-preview\s*\{/);
  assert.match(css, /\.outbox-row\s*\{/);
  assert.match(css, /\.outbox-state\s*\{/);
});

test("session drawer groups conversations by project like Codex desktop", () => {
  assert.match(app, /const groups = groupSessionsByProject\(sessions\)/);
  assert.match(app, /onScroll=\{handleScroll\}/);
  assert.match(app, /className="load-more-sessions"/);
  assert.match(app, /className="session-list-toolbar"/);
  assert.match(app, /aria-label="全部展开项目"/);
  assert.match(app, /aria-label="全部收起项目"/);
  assert.match(app, /aria-label="定位当前对话"/);
  assert.match(app, /<section className=\{`project-group \$\{projectOpen \? "open" : "collapsed"\}`\} key=\{group\.key\}>/);
  assert.match(app, /className="project-header"[\s\S]+aria-expanded=\{projectOpen\}/);
  assert.match(app, /projectOpen \? <FolderOpen size=\{15\} \/> : <Folder size=\{15\} \/>/);
  assert.match(app, /function groupSessionsByProject\(sessions\)/);
  assert.match(app, /function projectKey\(cwd\)/);
  assert.match(app, /function projectName\(cwd\)/);
  assert.ok(app.includes("split(/[\\\\/]+/)"));

  assert.match(css, /\.project-group\s*\{/);
  assert.match(css, /\.session-list-toolbar\s*\{/);
  assert.match(css, /\.project-header\s*\{/);
  assert.match(css, /\.project-group\.collapsed \.project-header > svg:first-child\s*\{/);
  assert.match(css, /\.load-more-sessions\s*\{/);
  assert.match(cssBlock(".session-row"), /min-height:\s*62px/);
});

test("mobile layout clamps loaded conversation content to the viewport", () => {
  assert.match(css, /html,\s*body,\s*#root\s*\{[\s\S]*max-width:\s*100vw/);
  assert.match(cssBlock(".app-shell"), /max-width:\s*100vw/);
  assert.match(cssBlock(".workspace"), /overflow:\s*hidden/);
  assert.match(cssBlock(".session-surface"), /max-width:\s*100vw/);
  assert.match(cssBlock(".session-surface"), /z-index:\s*1/);
  assert.match(css, /\.composer\s*\{[\s\S]*z-index:\s*400[\s\S]*overflow:\s*visible/);
  assert.match(css, /\.scanner-panel\s*\{/);
  assert.match(css, /\.scanner-card video\s*\{/);
  assert.match(css, /\.auth-actions\s*\{/);
  assert.match(cssBlock(".option-list"), /z-index:\s*120/);
  assert.match(cssBlock(".option-list"), /max-height:\s*min\(320px,\s*42vh\)/);
  assert.match(cssBlock(".timeline"), /width:\s*100%/);
  assert.match(cssBlock(".timeline-item"), /overflow:\s*hidden/);
  assert.match(cssBlock(".markdown-body code"), /overflow-wrap:\s*anywhere/);
  assert.match(cssBlock(".markdown-code"), /white-space:\s*pre-wrap/);
  assert.match(css, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.option-menu\.open\s*\{[\s\S]*z-index:\s*460/);
});

test("android shell keeps the web app local and connects to a configured backend", () => {
  assert.equal(capacitorConfig.appId, "com.huangbwww.loopilot");
  assert.equal(capacitorConfig.appName, "LooPilot");
  assert.equal(capacitorConfig.webDir, "build");
  assert.equal(capacitorConfig.server.androidScheme, "http");
  assert.equal(capacitorConfig.server.cleartext, true);
  assert.match(androidManifest, /android\.permission\.INTERNET/);
  assert.match(androidManifest, /android\.permission\.CAMERA/);
  assert.match(androidManifest, /android:usesCleartextTraffic="true"/);
  assert.equal(packageJson.dependencies["@capacitor/core"], "^8.3.4");
  assert.equal(packageJson.devDependencies["@capacitor/android"], "^8.3.4");
  assert.match(packageJson.scripts["android:sync"], /npx cap sync android/);
  assert.match(packageJson.scripts["android:debug"], /gradlew\.bat assembleDebug/);

  assert.match(app, /function readInitialBackendUrl\(nativeShell\)/);
  assert.match(app, /if \(!nativeShell\) return location\.origin/);
  assert.match(app, /return "";/);
  assert.match(app, /function normalizeBackendUrl\(value\)/);
  assert.match(app, /function defaultBackendProtocol\(text\)/);
  assert.match(app, /host\.startsWith\("localhost:"\)/);
  assert.match(app, /\^\\d\{1,3\}\(\\\.\\d\{1,3\}\)\{3\}\(:\\d\+\)\?\$/);
  assert.match(app, /url\.protocol === "http:" && !isLocalHttpHost\(url\.hostname\)/);
  assert.match(app, /function isLocalHttpHost\(hostname\)/);
  assert.match(app, /\^100\\\.\(6\[4-9\]\|\[7-9\]\\d\|1\[01\]\\d\|12\[0-7\]\)\\\./);
  assert.match(app, /placeholder="https:\/\/xxxx\.trycloudflare\.com 或 http:\/\/100\.x\.x\.x:4317"/);
  assert.match(app, /function apiUrl\(pathname, backendUrl\)/);
  assert.match(app, /function liveUrl\(backendUrl, authToken\)/);

  assert.match(server, /app\.use\(corsForShellClients\)/);
  assert.match(server, /Access-Control-Allow-Origin/);
  assert.match(server, /capacitor:/);
  assert.match(server, /LOOPILOT_ALLOWED_ORIGINS/);
});

test("doctor reports pairing code status without exposing the code", () => {
  const doctor = fs.readFileSync(new URL("../server/doctor.mjs", import.meta.url), "utf8");
  assert.match(doctor, /check\("Pairing code", \(\) => pairingStatus\(\)\)/);
  assert.match(doctor, /LOOPILOT_PAIRING_CODE/);
  assert.match(doctor, /stored in state directory/);
  assert.doesNotMatch(doctor, /readFileSync\(pairingPath/);
});
