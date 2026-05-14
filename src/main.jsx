import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Bell,
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  Circle,
  Clock3,
  Folder,
  MessageSquare,
  PanelLeft,
  Send,
  ShieldCheck,
  Settings2,
  Smartphone,
  Sparkles,
  TerminalSquare,
  Wifi,
  X
} from "lucide-react";
import {
  getNotificationPermission,
  notifyPendingAction,
  pendingActionKey,
  requestNotificationPermission
} from "./notifications.js";
import "./styles.css";

const modelOptions = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex"];
const reasoningOptions = ["low", "medium", "high", "xhigh"];
const approvalPolicyOptions = [
  { value: "on-request", label: "按需确认" },
  { value: "on-failure", label: "失败时确认" },
  { value: "never", label: "完全访问权限" }
];
const approvalScopeOptions = [
  { value: "turn", label: "仅本次" },
  { value: "session", label: "本会话" },
  { value: "always", label: "始终允许" }
];
const storedTokenKey = "loopilot.authToken";

function App() {
  const [authToken, setAuthToken] = useState(() => readInitialToken());
  const [systemInfo, setSystemInfo] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [connection, setConnection] = useState("connecting");
  const [model, setModel] = useState(modelOptions[0]);
  const [reasoning, setReasoning] = useState("high");
  const [approvalPolicy, setApprovalPolicy] = useState(approvalPolicyOptions[0].value);
  const [notificationPermission, setNotificationPermission] = useState(() => getNotificationPermission());
  const notifiedActions = useRef(new Set());
  const selected = useMemo(
    () => sessions.find((session) => session.id === selectedId) || sessions[0],
    [sessions, selectedId]
  );
  const waitingCount = sessions.filter((session) => session.status === "waiting").length;

  useEffect(() => {
    fetch("/api/health")
      .then((response) => response.json())
      .then(setSystemInfo)
      .catch(() => setSystemInfo(null));
  }, []);

  useEffect(() => {
    if (!authToken) return;
    authedFetch("/api/system", authToken)
      .then((response) => response.json())
      .then(setSystemInfo)
      .catch(() => {});
  }, [authToken]);

  useEffect(() => {
    if (!authToken) return;
    fetchSessions(authToken).then((items) => {
      setSessions(items);
      setSelectedId((current) => current || items[0]?.id || "");
    });

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/live?token=${encodeURIComponent(authToken)}`);
    socket.onopen = () => setConnection("live");
    socket.onclose = () => setConnection("offline");
    socket.onerror = () => setConnection("offline");
    socket.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === "snapshot") {
        setSessions(payload.sessions || []);
        setSelectedId((current) => current || payload.sessions?.[0]?.id || "");
        if (selectedId) loadDetail(selectedId, authToken).then(setDetail);
      }
      if (payload.type === "outbox" || payload.type === "action" || payload.type === "bridge") {
        loadDetail(selectedId, authToken).then(setDetail);
      }
    };
    return () => socket.close();
  }, [authToken, selectedId]);

  useEffect(() => {
    if (!selected?.id) return;
    loadDetail(selected.id, authToken).then(setDetail);
    setModel(selected.model || modelOptions[0]);
    setReasoning(selected.reasoning || "high");
  }, [selected?.id, authToken]);

  useEffect(() => {
    for (const session of sessions) {
      const key = pendingActionKey(session);
      if (!key || notifiedActions.current.has(key)) continue;
      if (notifyPendingAction(session)) notifiedActions.current.add(key);
    }
  }, [sessions, notificationPermission]);

  async function enableNotifications() {
    const permission = await requestNotificationPermission();
    setNotificationPermission(permission);
  }

  const current = detail?.id === selected?.id ? detail : selected;

  return (
    <main className="app-shell">
      <aside className={`sidebar ${drawerOpen ? "open" : ""}`}>
        <SidebarHeader connection={connection} waitingCount={waitingCount} onClose={() => setDrawerOpen(false)} />
        <SessionList
          sessions={sessions}
          selectedId={selected?.id}
          onSelect={(id) => {
            setSelectedId(id);
            setDrawerOpen(false);
          }}
        />
      </aside>
      {drawerOpen && <button className="scrim" aria-label="关闭会话列表" onClick={() => setDrawerOpen(false)} />}
      <section className="workspace">
        <TopBar
          session={current}
          connection={connection}
          bridgeMode={systemInfo?.bridgeMode}
          waitingCount={waitingCount}
          notificationPermission={notificationPermission}
          onMenu={() => setDrawerOpen(true)}
          onEnableNotifications={enableNotifications}
          onSignOut={() => {
            localStorage.removeItem(storedTokenKey);
            setAuthToken("");
            setSessions([]);
            setDetail(null);
          }}
        />
        <SessionSurface session={current} authToken={authToken} />
        <Composer
          session={current}
          authToken={authToken}
          model={model}
          reasoning={reasoning}
          setModel={setModel}
          setReasoning={setReasoning}
          approvalPolicy={approvalPolicy}
          setApprovalPolicy={setApprovalPolicy}
          onSent={() => current?.id && loadDetail(current.id, authToken).then(setDetail)}
        />
        {!authToken && <AuthGate onSave={setAuthToken} />}
      </section>
    </main>
  );
}

function AuthGate({ onSave }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    const credential = value.trim();
    if (!credential) return;
    setError("");
    const token = /^\d{6}$/.test(credential) ? await exchangePairingCode(credential) : credential;
    if (!token) {
      setError("配对失败，请检查 6 位配对码");
      return;
    }
    localStorage.setItem(storedTokenKey, token);
    onSave(token);
  }
  return (
    <div className="auth-gate">
      <form onSubmit={submit}>
        <strong>输入访问令牌</strong>
        <input value={value} onChange={(event) => setValue(event.target.value)} placeholder="6 位配对码或 token" />
        {error && <span className="auth-error">{error}</span>}
        <button>进入</button>
      </form>
    </div>
  );
}

async function exchangePairingCode(code) {
  const response = await fetch("/api/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code })
  });
  if (!response.ok) return "";
  const data = await response.json();
  return data.token || "";
}

function SidebarHeader({ connection, waitingCount, onClose }) {
  return (
    <div className="sidebar-header">
      <div className="brand-lockup">
        <div className="brand-mark"><Bot size={20} /></div>
        <div>
          <strong>LooPilot</strong>
          <span>Codex Mobile</span>
        </div>
      </div>
      <div className="sidebar-actions">
        <StatusPill state={connection} />
        {waitingCount > 0 && <span className="alert-dot">{waitingCount}</span>}
        <button className="icon-button mobile-only" aria-label="关闭" onClick={onClose}><X size={18} /></button>
      </div>
    </div>
  );
}

function SessionList({ sessions, selectedId, onSelect }) {
  const groups = groupSessionsByProject(sessions);
  return (
    <div className="session-list">
      {groups.map((group) => (
        <section className="project-group" key={group.key}>
          <div className="project-header">
            <Folder size={15} />
            <span>{group.name}</span>
          </div>
          {group.sessions.map((session) => (
            <button
              key={session.id}
              className={`session-row ${session.id === selectedId ? "active" : ""}`}
              onClick={() => onSelect(session.id)}
            >
              <span className={`state-dot ${session.status}`} />
              <span className="session-main">
                <strong>{session.title}</strong>
                <small>{session.lastOutput || session.cwd || session.id}</small>
              </span>
              <span className="session-meta">
                <small>{formatTime(session.updatedAt)}</small>
                {session.pendingAction && <Bell size={15} />}
              </span>
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}

function TopBar({ session, connection, bridgeMode, waitingCount, notificationPermission, onMenu, onEnableNotifications, onSignOut }) {
  return (
    <header className="topbar">
      <button className="icon-button" aria-label="会话列表" onClick={onMenu}><PanelLeft size={20} /></button>
      <div className="topbar-title">
        <span>{session?.title || "LooPilot"}</span>
        <small>{session?.cwd || "等待 Codex 会话"}</small>
      </div>
      <div className="topbar-right">
        {notificationPermission === "default" && (
          <button className="notify-button" type="button" onClick={onEnableNotifications}>
            <Bell size={15} />
            Notify
          </button>
        )}
        {bridgeMode === "queue" && <span className="notice-badge">队列</span>}
        {waitingCount > 0 && <span className="notice-badge"><Bell size={15} />{waitingCount}</span>}
        <StatusPill state={connection} compact />
        <button className="icon-button compact-only" type="button" aria-label="Sign out" onClick={onSignOut}><X size={16} /></button>
      </div>
    </header>
  );
}

function SessionSurface({ session, authToken }) {
  if (!session) {
    return (
      <div className="empty-state">
        <Smartphone size={34} />
        <strong>没有找到 Codex 会话</strong>
        <span>启动 Codex Desktop 后，这里会自动出现会话列表。</span>
      </div>
    );
  }

  return (
    <div className="session-surface">
      <div className="status-strip">
        <Metric icon={<Circle size={12} />} label="状态" value={statusText(session.status)} tone={session.status} />
        <Metric icon={<MessageSquare size={14} />} label="消息" value={session.messageCount || 0} />
        <Metric icon={<TerminalSquare size={14} />} label="工具" value={session.toolCount || 0} />
        <Metric icon={<Clock3 size={14} />} label="更新" value={formatTime(session.updatedAt)} />
      </div>
      {session.pendingAction && <ActionPrompt session={session} authToken={authToken} />}
      <div className="timeline">
        {(session.timeline || []).map((item, index) => (
          <TimelineItem key={`${item.id}-${index}`} item={item} />
        ))}
      </div>
      {session.outbox?.length > 0 && (
        <div className="outbox">
          <strong>远程队列</strong>
          {session.outbox.slice(-3).map((item) => (
            <span key={`${item.id}-${item.status}-${item.at || item.finishedAt || item.createdAt}`}>
              {item.message || item.decision || item.command || item.text || "Bridge"} · {item.status}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ActionPrompt({ session, authToken }) {
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState({});
  const [customAnswers, setCustomAnswers] = useState({});
  const [approvalScope, setApprovalScope] = useState("turn");
  const canChooseApprovalScope = session.pendingAction.method === "item/permissions/requestApproval";
  async function decide(decision) {
    setBusy(true);
    const mergedAnswers = { ...answers };
    for (const [questionId, value] of Object.entries(customAnswers)) {
      const text = value.trim();
      if (text) mergedAnswers[questionId] = [text];
    }
    await authedFetch(`/api/sessions/${session.id}/actions/${session.pendingAction.id}`, authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(typeof decision === "object"
        ? { ...decision, answers: mergedAnswers }
        : { decision, ...(canChooseApprovalScope ? { scope: approvalScope } : {}) })
    });
    setBusy(false);
  }

  return (
    <section className="action-prompt">
      <div>
        <Bell size={18} />
        <strong>{session.pendingAction.title}</strong>
      </div>
      {session.pendingAction.questions?.length > 0 ? (
        <div className="question-stack">
          {session.pendingAction.questions.map((question) => (
            <div className="question-block" key={question.id}>
              <strong>{question.question}</strong>
              <div className="choice-grid">
                {(question.options || []).map((option) => (
                  <button
                    type="button"
                    className={answers[question.id]?.includes(option.label) ? "selected" : ""}
                    key={option.label}
                    onClick={() => setAnswers((current) => ({
                      ...current,
                      [question.id]: [option.label]
                    }))}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <input
                className="answer-input"
                value={customAnswers[question.id] || ""}
                onChange={(event) => setCustomAnswers((current) => ({
                  ...current,
                  [question.id]: event.target.value
                }))}
                placeholder="Custom answer"
              />
            </div>
          ))}
        </div>
      ) : (
        <pre>{session.pendingAction.detail}</pre>
      )}
      {canChooseApprovalScope && (
        <div className="permission-scope" role="radiogroup" aria-label="Approval scope">
          {approvalScopeOptions.map((option) => (
            <button
              type="button"
              key={option.value}
              className={approvalScope === option.value ? "selected" : ""}
              onClick={() => setApprovalScope(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      <div className="prompt-actions">
        {session.pendingAction.kind === "input" ? (
          <button disabled={busy} onClick={() => decide({ decision: "approved" })}><Check size={16} />提交</button>
        ) : (
          <button disabled={busy} onClick={() => decide("approved")}><Check size={16} />允许</button>
        )}
        <button disabled={busy} onClick={() => decide("denied")}><X size={16} />拒绝</button>
      </div>
    </section>
  );
}

function TimelineItem({ item }) {
  return (
    <article className={`timeline-item ${item.role}`}>
      <div className="item-head">
        <span>{item.title}</span>
        <time>{formatTime(item.at)}</time>
      </div>
      <p>{item.text}</p>
    </article>
  );
}

function Composer({ session, authToken, model, reasoning, setModel, setReasoning, approvalPolicy, setApprovalPolicy, onSent }) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  async function submit(event) {
    event.preventDefault();
    if (!message.trim() || !session?.id) return;
    setSending(true);
    await authedFetch(`/api/sessions/${session.id}/messages`, authToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, model, reasoning, approvalPolicy })
    });
    setMessage("");
    setSending(false);
    onSent();
  }

  return (
    <form className="composer" onSubmit={submit}>
      <div className="control-row">
        <OptionMenu icon={<Sparkles size={15} />} label="Model" value={model} options={modelOptions} onChange={setModel} />
        <OptionMenu icon={<Settings2 size={15} />} label="Reasoning" value={reasoning} options={reasoningOptions} onChange={setReasoning} />
        <OptionMenu
          icon={<ShieldCheck size={15} />}
          label="Approval"
          value={approvalPolicy}
          options={approvalPolicyOptions}
          onChange={setApprovalPolicy}
        />
      </div>
      <div className="input-row">
        <button type="button" className="icon-button" aria-label="返回"><ChevronLeft size={18} /></button>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="给当前 Codex 会话发送消息"
          rows={1}
        />
        <button className="send-button" disabled={sending || !message.trim() || !session?.id} aria-label="发送">
          <Send size={18} />
        </button>
      </div>
    </form>
  );
}

function OptionMenu({ icon, label, value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) || value;
  const selectedLabel = typeof selected === "string" ? selected : selected.label;

  return (
    <div className={`option-menu ${open ? "open" : ""}`}>
      <button type="button" className="option-trigger" aria-label={label} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        {icon}
        <span>{selectedLabel}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="option-list" role="listbox" aria-label={label}>
          {options.map((option) => {
            const optionValue = typeof option === "string" ? option : option.value;
            const optionLabel = typeof option === "string" ? option : option.label;
            return (
              <button
                type="button"
                key={optionValue}
                className={optionValue === value ? "selected" : ""}
                onClick={() => {
                  onChange(optionValue);
                  setOpen(false);
                }}
              >
                {optionLabel}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Metric({ icon, label, value, tone }) {
  return (
    <div className={`metric ${tone || ""}`}>
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusPill({ state, compact }) {
  return (
    <span className={`status-pill ${state}`}>
      <Wifi size={compact ? 14 : 15} />
      {!compact && (state === "live" ? "实时" : state === "offline" ? "离线" : "连接中")}
    </span>
  );
}

async function fetchSessions(authToken) {
  const response = await authedFetch("/api/sessions", authToken);
  const data = await response.json();
  return data.sessions || [];
}

async function loadDetail(id, authToken) {
  const response = await authedFetch(`/api/sessions/${id}`, authToken);
  const data = await response.json();
  return data.session;
}

function authedFetch(url, authToken, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${authToken}`
    }
  });
}

function readInitialToken() {
  const tokenFromUrl = new URLSearchParams(location.search).get("token");
  if (tokenFromUrl) {
    localStorage.setItem(storedTokenKey, tokenFromUrl);
    history.replaceState(null, "", location.pathname);
    return tokenFromUrl;
  }
  return localStorage.getItem(storedTokenKey) || "";
}

function groupSessionsByProject(sessions) {
  const groups = new Map();
  for (const session of sessions) {
    const key = projectKey(session.cwd);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name: projectName(session.cwd),
        cwd: session.cwd || "",
        sessions: []
      });
    }
    groups.get(key).sessions.push(session);
  }
  return [...groups.values()];
}

function projectKey(cwd) {
  const value = String(cwd || "").trim();
  return value ? value.replace(/[\\]+/g, "/").toLowerCase() : "__uncategorized__";
}

function projectName(cwd) {
  const parts = String(cwd || "").split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) || "未归类";
}

function statusText(status) {
  if (status === "running") return "运行中";
  if (status === "waiting") return "待确认";
  return "空闲";
}

function formatTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(date);
}

if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  } else {
    navigator.serviceWorker.getRegistrations?.()
      .then((registrations) => registrations.forEach((registration) => registration.unregister()))
      .catch(() => {});
  }
}

createRoot(document.getElementById("root")).render(<App />);
