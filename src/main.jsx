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
  const [expandedSubagents, setExpandedSubagents] = useState({});
  const groups = groupSessionsByProject(sessions);
  return (
    <div className="session-list">
      {groups.map((group) => {
        const primarySessions = group.sessions.filter((session) => !session.isSubagent);
        const subagents = group.sessions.filter((session) => session.isSubagent);
        const selectedSubagent = subagents.some((session) => session.id === selectedId);
        const subagentsOpen = Boolean(expandedSubagents[group.key] || selectedSubagent);
        return (
          <section className="project-group" key={group.key}>
            <div className="project-header">
              <Folder size={15} />
              <span>{group.name}</span>
            </div>
            {primarySessions.map((session) => (
              <SessionRow key={session.id} session={session} selectedId={selectedId} onSelect={onSelect} />
            ))}
            {subagents.length > 0 && (
              <div className="subagent-section">
                <button
                  type="button"
                  className={`subagent-toggle ${subagentsOpen ? "open" : ""}`}
                  onClick={() => setExpandedSubagents((current) => ({
                    ...current,
                    [group.key]: !subagentsOpen
                  }))}
                >
                  <ChevronDown size={14} />
                  <span>子会话</span>
                  <small>{subagents.length}</small>
                </button>
                {subagentsOpen && (
                  <div className="subagent-list">
                    {subagents.map((session) => (
                      <SessionRow key={session.id} session={session} selectedId={selectedId} onSelect={onSelect} subagent />
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function SessionRow({ session, selectedId, onSelect, subagent }) {
  return (
    <button
      className={`session-row ${subagent ? "subagent" : ""} ${session.id === selectedId ? "active" : ""}`}
      onClick={() => onSelect(session.id)}
    >
      <span className={`state-dot ${session.status}`} />
      <span className="session-main">
        <strong>{session.title}</strong>
        <small>{session.lastOutput || session.agentNickname || session.cwd || session.id}</small>
      </span>
      <span className="session-meta">
        <small>{formatTime(session.updatedAt)}</small>
        {session.pendingAction && <Bell size={15} />}
      </span>
    </button>
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
  const surfaceRef = useRef(null);
  const outboxItems = useMemo(() => visibleOutboxItems(session?.outbox), [session?.outbox]);

  useEffect(() => {
    const element = surfaceRef.current;
    if (!element || !session?.id) return undefined;
    const frame = requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [session?.id, session?.timeline?.length, session?.outbox?.length, session?.status]);

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
    <div className="session-surface" ref={surfaceRef}>
      <div className="status-strip">
        <Metric icon={<Circle size={12} />} label="状态" value={statusText(session.status)} tone={session.status} />
        <Metric icon={<MessageSquare size={14} />} label="消息" value={session.messageCount || 0} />
        <Metric icon={<TerminalSquare size={14} />} label="工具" value={session.toolCount || 0} />
        <Metric icon={<Clock3 size={14} />} label="更新" value={formatTime(session.updatedAt)} />
      </div>
      {session.pendingAction && <ActionPrompt session={session} authToken={authToken} />}
      <div className="timeline">
        {(session.timeline || []).map((item, index) => (
          <TimelineItem key={`${item.id}-${index}`} item={item} sessionId={session.id} authToken={authToken} />
        ))}
        {session.status === "running" && <RunningIndicator />}
      </div>
      {outboxItems.length > 0 && (
        <div className="outbox">
          <strong>远程队列</strong>
          {outboxItems.map((item) => (
            <span className={item.tone || ""} key={item.key}>
              {item.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function RunningIndicator() {
  return (
    <div className="running-indicator" aria-live="polite">
      <span className="thinking-dot" />
      <span className="thinking-dot" />
      <span className="thinking-dot" />
      <strong>Codex 正在运行</strong>
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

function TimelineItem({ item, sessionId, authToken }) {
  const isTool = item.kind === "tool";
  const isToolOutput = item.kind === "tool-output";
  return (
    <article className={`timeline-item ${item.role}`}>
      <div className="item-head">
        <span>{item.title}</span>
        <time>{formatTime(item.at)}</time>
      </div>
      {isTool && <pre className="tool-summary">{item.text}</pre>}
      {isToolOutput && (
        <details className="tool-details">
          <summary>查看工具输出</summary>
          <pre className="tool-summary">{item.text}</pre>
        </details>
      )}
      {!isTool && !isToolOutput && <MarkdownContent text={item.text} sessionId={sessionId} authToken={authToken} />}
    </article>
  );
}

function MarkdownContent({ text, sessionId, authToken }) {
  return <div className="markdown-body">{renderMarkdownBlocks(text || "", sessionId, authToken)}</div>;
}

function renderMarkdownBlocks(text, sessionId, authToken) {
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = [];
  let quote = [];
  let code = null;

  function flushParagraph() {
    if (!paragraph.length) return;
    blocks.push(<p key={`p-${blocks.length}`}>{renderInline(paragraph.join("\n"), sessionId, authToken, `p-${blocks.length}`)}</p>);
    paragraph = [];
  }

  function flushList() {
    if (!list.length) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`}>
        {list.map((item, index) => <li key={index}>{renderInline(item, sessionId, authToken, `li-${blocks.length}-${index}`)}</li>)}
      </ul>
    );
    list = [];
  }

  function flushQuote() {
    if (!quote.length) return;
    blocks.push(<blockquote key={`q-${blocks.length}`}>{renderInline(quote.join("\n"), sessionId, authToken, `q-${blocks.length}`)}</blockquote>);
    quote = [];
  }

  function flushLoose() {
    flushParagraph();
    flushList();
    flushQuote();
  }

  for (const line of lines) {
    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      if (code) {
        blocks.push(
          <pre className="markdown-code" key={`code-${blocks.length}`}>
            <code>{code.lines.join("\n")}</code>
          </pre>
        );
        code = null;
      } else {
        flushLoose();
        code = { language: fence[1] || "", lines: [] };
      }
      continue;
    }
    if (code) {
      code.lines.push(line);
      continue;
    }

    if (!line.trim()) {
      flushLoose();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushLoose();
      const Tag = `h${heading[1].length + 2}`;
      blocks.push(<Tag key={`h-${blocks.length}`}>{renderInline(heading[2], sessionId, authToken, `h-${blocks.length}`)}</Tag>);
      continue;
    }

    const listItem = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      flushQuote();
      list.push(listItem[1]);
      continue;
    }

    const quoteLine = line.match(/^>\s?(.*)$/);
    if (quoteLine) {
      flushParagraph();
      flushList();
      quote.push(quoteLine[1]);
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(line);
  }

  if (code) {
    blocks.push(
      <pre className="markdown-code" key={`code-${blocks.length}`}>
        <code>{code.lines.join("\n")}</code>
      </pre>
    );
  }
  flushLoose();
  return blocks.length ? blocks : null;
}

function renderInline(text, sessionId, authToken, keyPrefix) {
  const pattern = /(!?\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\))|(`([^`]+)`)|(\*\*([^*]+)\*\*)/g;
  const parts = [];
  let cursor = 0;
  let match = null;

  function pushText(value) {
    if (!value) return;
    const pieces = value.split("\n");
    pieces.forEach((piece, index) => {
      if (index > 0) parts.push(<br key={`${keyPrefix}-br-${parts.length}`} />);
      if (piece) parts.push(piece);
    });
  }

  while ((match = pattern.exec(text)) !== null) {
    pushText(text.slice(cursor, match.index));
    if (match[1]?.startsWith("!")) {
      parts.push(<ImageBlock key={`${keyPrefix}-img-${parts.length}`} src={match[3]} alt={match[2]} sessionId={sessionId} authToken={authToken} />);
    } else if (match[1]) {
      const href = safeHref(match[3]);
      parts.push(href
        ? <a key={`${keyPrefix}-a-${parts.length}`} href={href} target="_blank" rel="noreferrer">{match[2] || match[3]}</a>
        : match[2]);
    } else if (match[4]) {
      parts.push(<code key={`${keyPrefix}-code-${parts.length}`}>{match[5]}</code>);
    } else if (match[6]) {
      parts.push(<strong key={`${keyPrefix}-strong-${parts.length}`}>{match[7]}</strong>);
    }
    cursor = match.index + match[0].length;
  }
  pushText(text.slice(cursor));
  return parts;
}

function ImageBlock({ src, alt, sessionId, authToken }) {
  const [objectUrl, setObjectUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const imageSrc = String(src || "").trim();
  const directSrc = isDirectImageSrc(imageSrc);

  useEffect(() => {
    setFailed(false);
    setObjectUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return "";
    });
  }, [imageSrc]);

  useEffect(() => {
    if (!imageSrc || directSrc || !sessionId) return undefined;
    let cancelled = false;
    const controller = new AbortController();
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}/media?path=${encodeURIComponent(imagePathFromMarkdown(imageSrc))}`, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      signal: controller.signal
    })
      .then((response) => {
        if (!response.ok) throw new Error("Image request failed");
        return response.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        const nextUrl = URL.createObjectURL(blob);
        setObjectUrl(nextUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [imageSrc, directSrc, sessionId, authToken]);

  useEffect(() => () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  if (!imageSrc) return null;
  if (directSrc) return <img className="markdown-image" src={imageSrc} alt={alt || ""} loading="lazy" referrerPolicy="no-referrer" />;
  if (failed) return <span className="image-error">图片无法加载：{imageSrc}</span>;
  return objectUrl
    ? <img className="markdown-image" src={objectUrl} alt={alt || ""} loading="lazy" />
    : <span className="image-loading">图片加载中...</span>;
}

function safeHref(value) {
  const href = String(value || "").trim();
  if (/^(https?:|mailto:)/i.test(href)) return href;
  return "";
}

function isDirectImageSrc(value) {
  return /^https:\/\//i.test(value);
}

function imagePathFromMarkdown(value) {
  let input = String(value || "").trim();
  try {
    input = decodeURIComponent(input);
  } catch {
    return "";
  }
  if (/^file:\/\/\//i.test(input)) {
    input = input.replace(/^file:\/\/\//i, "");
    if (/^[A-Za-z]:\//.test(input)) return input.replace(/\//g, "\\");
    return `/${input}`;
  }
  return input.replace(/^file:\/\//i, "");
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
  const menuRef = useRef(null);
  const selected = options.find((option) => option.value === value) || value;
  const selectedLabel = typeof selected === "string" ? selected : selected.label;

  useEffect(() => {
    if (!open) return undefined;
    function closeFromOutside(event) {
      if (!menuRef.current?.contains(event.target)) setOpen(false);
    }
    function closeOnEscape(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className={`option-menu ${open ? "open" : ""}`} ref={menuRef}>
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

function visibleOutboxItems(items = []) {
  return items
    .slice()
    .sort((a, b) => outboxItemTime(a) - outboxItemTime(b))
    .map((item) => formatOutboxItem(item))
    .filter(Boolean)
    .map((item) => ({
      ...item,
      label: item.status ? `${item.message} · ${item.status}` : item.message
    }))
    .slice(-3);
}

function outboxItemTime(item) {
  const value = item?.createdAt || item?.at || item?.startedAt || item?.finishedAt;
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function formatOutboxItem(item) {
  const status = String(item?.status || "");
  const key = `${item?.id || item?.serverRequestId || item?.createdAt || item?.at}-${status}`;

  if (item?.message) {
    return {
      key,
      tone: statusTone(status),
      message: `已发送：${clipUi(item.message, 72)}`,
      status: outboxStatusText(status)
    };
  }

  if (item?.decision || item?.actionId) {
    return {
      key,
      tone: statusTone(status),
      message: item.decision ? `已响应确认：${item.decision}` : "已响应确认",
      status: outboxStatusText(status)
    };
  }

  if (status === "output") return null;
  if (status === "dispatching") {
    return { key, tone: "syncing", message: "正在发送到 Codex Desktop", status: "同步中" };
  }
  if (status === "sent") {
    return { key, tone: "synced", message: "已同步到 Codex Desktop", status: "完成" };
  }
  if (status === "queued_only") {
    return { key, tone: "waiting", message: "已加入本地队列", status: "等待同步" };
  }
  if (["needs_approval", "needs_input", "needs_response"].includes(status)) {
    return { key, tone: "waiting", message: "等待你处理确认", status: "待确认" };
  }
  if (status.includes("failed") || item?.error) {
    return { key, tone: "failed", message: item?.error ? `发送失败：${clipUi(item.error, 72)}` : "发送失败", status: "失败" };
  }
  return null;
}

function statusTone(status) {
  if (status === "sent") return "synced";
  if (status === "queued" || status === "dispatching") return "syncing";
  if (status.includes("failed")) return "failed";
  return "";
}

function outboxStatusText(status) {
  if (status === "queued") return "排队中";
  if (status === "dispatching") return "同步中";
  if (status === "sent") return "完成";
  if (status === "failed") return "失败";
  return status || "记录";
}

function clipUi(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
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
