import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getStateDir } from "./state.mjs";

const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const SESSION_INDEX = path.join(CODEX_HOME, "session_index.jsonl");
const SESSIONS_DIR = path.join(CODEX_HOME, "sessions");
const APP_STATE_DIR = getStateDir();
const OUTBOX_DIR = path.join(APP_STATE_DIR, "outbox");
const JOBS_DIR = path.join(APP_STATE_DIR, "jobs");

const MAX_PREVIEW_CHARS = 320;
const MAX_DETAIL_ITEMS = 900;
const MAX_SESSION_LIMIT = 120;

export function getCodexHome() {
  return CODEX_HOME;
}

export function getWatchedPaths() {
  return [SESSION_INDEX, SESSIONS_DIR];
}

export function ensureStateDirs() {
  fs.mkdirSync(OUTBOX_DIR, { recursive: true });
  fs.mkdirSync(JOBS_DIR, { recursive: true });
}

export function listSessions(options = {}) {
  const limit = normalizeLimit(options.limit);
  const offset = normalizeOffset(options.offset);
  const summaries = sortedSessionSummaries();
  const page = limit ? summaries.slice(offset, offset + limit) : summaries.slice(offset);
  const sessions = page.map((summary) => hydrateSessionSummary(summary));
  sessions.total = summaries.length;
  sessions.hasMore = limit ? offset + sessions.length < summaries.length : false;
  sessions.nextOffset = offset + sessions.length;
  return sessions;
}

export function listSessionPage(options = {}) {
  const sessions = listSessions(options);
  return {
    sessions,
    total: sessions.total || sessions.length,
    hasMore: Boolean(sessions.hasMore),
    nextOffset: sessions.nextOffset || sessions.length
  };
}

export function getSessionDetail(id) {
  const summary = sortedSessionSummaries().find((item) => item.id === id);
  if (!summary?.path) return summary ? hydrateSessionSummary(summary) : null;
  const parsed = parseSessionFile(summary.path, { detail: true });
  const outbox = readOutbox(id);
  const pendingAction = visiblePendingAction(parsed.pendingAction, outbox) || pendingActionFromJobs(outbox);
  return {
    ...summary,
    ...parsed,
    title: readableTitle(summary.title, parsed),
    isSubagent: parsed.threadSource === "subagent",
    status: parsed.status === "waiting" && !pendingAction ? "idle" : parsed.status,
    pendingAction,
    outbox
  };
}

function sortedSessionSummaries() {
  const index = readSessionIndex();
  const files = indexSessionFiles();
  const summaries = new Map();

  for (const row of index) {
    if (!row?.id) continue;
    summaries.set(row.id, {
      id: row.id,
      title: row.thread_name || "Untitled session",
      updatedAt: row.updated_at,
      path: files.get(row.id) || null
    });
  }

  for (const [id, filePath] of files) {
    if (!summaries.has(id)) {
      summaries.set(id, {
        id,
        title: titleFromFile(filePath),
        updatedAt: safeStat(filePath)?.mtime?.toISOString(),
        path: filePath
      });
    }
  }

  return [...summaries.values()]
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

function hydrateSessionSummary(summary) {
  const parsed = summary.path ? parseSessionFile(summary.path, { detail: false }) : null;
  const outbox = readOutbox(summary.id);
  const pendingAction = visiblePendingAction(parsed?.pendingAction, outbox) || pendingActionFromJobs(outbox);
  return {
    ...summary,
    title: readableTitle(summary.title, parsed),
    cwd: parsed?.cwd,
    model: parsed?.model,
    reasoning: parsed?.reasoning,
    threadSource: parsed?.threadSource || "user",
    parentThreadId: parsed?.parentThreadId || "",
    agentNickname: parsed?.agentNickname || "",
    isSubagent: parsed?.threadSource === "subagent",
    status: parsed?.status === "waiting" && !pendingAction ? "idle" : parsed?.status || "idle",
    progress: parsed?.progress || [],
    pendingAction,
    lastOutput: parsed?.lastOutput || "",
    messageCount: parsed?.messageCount || 0,
    toolCount: parsed?.toolCount || 0,
    updatedAt: parsed?.updatedAt || summary.updatedAt
  };
}

export function enqueueRemoteMessage(sessionId, message, options = {}) {
  ensureStateDirs();
  const record = {
    id: cryptoId(),
    sessionId,
    message,
    options,
    status: "queued",
    createdAt: new Date().toISOString()
  };
  fs.appendFileSync(path.join(OUTBOX_DIR, `${sessionId}.jsonl`), `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

export function appendBridgeJob(sessionId, record) {
  ensureStateDirs();
  fs.appendFileSync(path.join(JOBS_DIR, `${sessionId}.jsonl`), `${JSON.stringify(record)}\n`, "utf8");
}

export function resolveAction(sessionId, actionId, decision) {
  ensureStateDirs();
  const normalized = normalizeDecisionRecord(decision);
  const record = {
    id: cryptoId(),
    sessionId,
    actionId,
    decision: normalized.decision,
    ...(normalized.answers ? { answers: normalized.answers } : {}),
    ...(normalized.scope ? { scope: normalized.scope } : {}),
    status: "queued",
    createdAt: new Date().toISOString()
  };
  fs.appendFileSync(path.join(OUTBOX_DIR, `${sessionId}.actions.jsonl`), `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

function readSessionIndex() {
  if (!fs.existsSync(SESSION_INDEX)) return [];
  return readJsonl(SESSION_INDEX);
}

function indexSessionFiles() {
  const files = new Map();
  for (const filePath of walkJsonl(SESSIONS_DIR)) {
    const id = idFromRolloutName(filePath);
    if (!id) continue;
    const current = files.get(id);
    if (!current || (safeStat(filePath)?.mtimeMs || 0) > (safeStat(current)?.mtimeMs || 0)) {
      files.set(id, filePath);
    }
  }
  return files;
}

function parseSessionFile(filePath, { detail }) {
  const rows = readJsonl(filePath);
  const timeline = [];
  const progress = [];
  const stats = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let id = idFromRolloutName(filePath);
  let cwd = "";
  let model = "";
  let reasoning = "";
  let threadSource = "user";
  let parentThreadId = "";
  let agentNickname = "";
  let status = "idle";
  let pendingAction = null;
  let lastOutput = "";
  let messageCount = 0;
  let toolCount = 0;
  let updatedAt = safeStat(filePath)?.mtime?.toISOString();

  for (const row of rows) {
    updatedAt = row.timestamp || updatedAt;
    if (row.type === "session_meta") {
      id = row.payload?.id || id;
      cwd = row.payload?.cwd || cwd;
      model = row.payload?.model || model;
      threadSource = row.payload?.thread_source || threadSource;
      parentThreadId = row.payload?.source?.subagent?.thread_spawn?.parent_thread_id
        || row.payload?.forked_from_id
        || parentThreadId;
      agentNickname = row.payload?.agent_nickname
        || row.payload?.source?.subagent?.thread_spawn?.agent_nickname
        || agentNickname;
      continue;
    }

    if (row.type === "turn_context") {
      model = row.payload?.model || model;
      reasoning = row.payload?.effort || row.payload?.collaboration_mode?.settings?.reasoning_effort || reasoning;
      continue;
    }

    if (row.type === "event_msg") {
      const eventType = row.payload?.type;
      if (eventType === "task_started") status = "running";
      if (["task_complete", "task_completed", "turn_complete", "task_stopped"].includes(eventType)) status = "idle";
      if (eventType === "token_count") {
        const usage = row.payload?.info?.total_token_usage || row.payload?.info?.last_token_usage;
        if (usage) {
          stats.inputTokens = usage.input_tokens || stats.inputTokens;
          stats.outputTokens = usage.output_tokens || stats.outputTokens;
          stats.totalTokens = usage.total_tokens || stats.totalTokens;
        }
      }
      if (eventType && eventType !== "token_count") {
        progress.push({ type: eventType, at: row.timestamp });
      }
      continue;
    }

    if (row.type !== "response_item") continue;
    const item = row.payload;

    if (item?.type === "message") {
      if (["developer", "system"].includes(item.role)) continue;
      const text = flattenContent(item.content);
      if (text) {
        messageCount += 1;
        lastOutput = item.role === "assistant" ? text : lastOutput || text;
        pushTimeline(timeline, detail, {
          id: item.id || `${timeline.length}`,
          kind: "message",
          role: item.role || "assistant",
          title: roleTitle(item.role),
          text: truncateForDetail(text, detail),
          at: row.timestamp
        });
      }
    }

    if (["function_call", "tool_call"].includes(item?.type)) {
      toolCount += 1;
      const name = item.name || item.call?.name || "tool";
      if (isUserDecisionTool(name)) {
        const args = parseArgs(item.arguments || item.call?.arguments);
        status = "waiting";
        pendingAction = {
          id: item.call_id || item.id || `${timeline.length}`,
          title: decisionTitle(name),
          kind: name === "request_user_input" ? "input" : "approval",
          questions: args?.questions || [],
          detail: prettyArgs(args || item.arguments || item.call?.arguments)
        };
      }
      pushTimeline(timeline, detail, {
        id: item.call_id || item.id || `${timeline.length}`,
        kind: "tool",
        role: "tool",
        title: name,
        text: summarizeToolCall(name, item.arguments || item.call?.arguments),
        at: row.timestamp
      });
    }

    if (item?.type === "function_call_output") {
      const output = String(item.output || "").trim();
      if (output) {
        pushTimeline(timeline, detail, {
          id: item.call_id || `${timeline.length}`,
          kind: "tool-output",
          role: "tool",
          title: "Tool output",
          text: truncateForDetail(output, detail),
          at: row.timestamp
        });
      }
    }
  }

  return {
    id,
    cwd,
    model,
    reasoning,
    threadSource,
    parentThreadId,
    agentNickname,
    status,
    progress: progress.slice(-5),
    pendingAction,
    lastOutput: clip(lastOutput, MAX_PREVIEW_CHARS),
    messageCount,
    toolCount,
    updatedAt,
    stats,
    timeline: detail ? timeline.slice(-MAX_DETAIL_ITEMS) : undefined
  };
}

function readOutbox(sessionId) {
  const files = [
    path.join(OUTBOX_DIR, `${sessionId}.jsonl`),
    path.join(OUTBOX_DIR, `${sessionId}.actions.jsonl`),
    path.join(JOBS_DIR, `${sessionId}.jsonl`)
  ];
  return files
    .flatMap((file) => (fs.existsSync(file) ? readJsonl(file) : []))
    .sort((a, b) => recordTime(a) - recordTime(b));
}

function recordTime(record) {
  const value = record?.createdAt || record?.at || record?.startedAt || record?.finishedAt;
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function pendingActionFromJobs(records) {
  const resolved = new Set(records.map((record) => record.actionId).filter(Boolean));
  const latest = new Map();
  for (const record of records) {
    const key = record.serverRequestId || record.actionId || record.id;
    if (key) latest.set(key, record);
  }
  for (const record of [...latest.values()].reverse()) {
    if (resolved.has(record.serverRequestId || record.id)) continue;
    if (!["needs_approval", "needs_input", "needs_response"].includes(record.status)) continue;
    return {
      id: record.serverRequestId || record.id,
      title: record.status === "needs_input" ? "User input required" : "Approval required",
      kind: record.status === "needs_input" ? "input" : "approval",
      method: record.method,
      questions: record.params?.questions || [],
      detail: prettyArgs({
        method: record.method,
        params: record.params
      })
    };
  }
  return null;
}

function visiblePendingAction(action, records) {
  if (!action?.id) return null;
  const resolved = records.some((record) => record.actionId === action.id);
  return resolved ? null : action;
}

function readJsonl(filePath) {
  try {
    return fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function walkJsonl(root) {
  if (!fs.existsSync(root)) return [];
  const found = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(next);
      if (entry.isFile() && entry.name.endsWith(".jsonl")) found.push(next);
    }
  }
  return found;
}

function idFromRolloutName(filePath) {
  const match = path.basename(filePath).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return match?.[1] || null;
}

function titleFromFile(filePath) {
  return path.basename(filePath).replace(/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/, "").replace(/\.jsonl$/, "");
}

function readableTitle(title, parsed) {
  if (title && !looksMojibake(title)) return title;
  const firstUser = parsed?.timeline?.find((item) => item.role === "user")?.text;
  return firstUser ? clip(firstUser, 48) : title || "Codex session";
}

function looksMojibake(text) {
  return /[�]|[ÃÂ]|[鐟閸娣囬]/.test(text || "");
}

function flattenContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      return part.text || part.input_text || part.output_text || "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function pushTimeline(timeline, detail, item) {
  if (!detail && item.kind !== "message") return;
  timeline.push(item);
}

function truncateForDetail(text, detail) {
  return detail ? clip(text, 5000) : clip(text, MAX_PREVIEW_CHARS);
}

function clip(text, limit) {
  const value = String(text || "").trim();
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}...`;
}

function roleTitle(role) {
  if (role === "user") return "User";
  if (role === "assistant") return "Codex";
  if (role === "developer") return "Developer";
  return "Message";
}

function isUserDecisionTool(name) {
  return ["request_user_input", "request_plugin_install"].includes(name);
}

function decisionTitle(name) {
  if (name === "request_plugin_install") return "Plugin install approval";
  return "User input required";
}

function prettyArgs(value) {
  if (!value) return "";
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

function summarizeToolCall(name, value) {
  const args = parseArgs(value);
  if (!args || typeof args !== "object") return prettyArgs(value);

  if (name === "shell_command") {
    const command = args.command || args.cmd || args.script;
    const cwd = args.workdir || args.cwd;
    return [
      command ? `运行命令：${command}` : "运行 shell 命令",
      cwd ? `目录：${cwd}` : "",
      args.timeout_ms ? `超时：${args.timeout_ms}ms` : ""
    ].filter(Boolean).join("\n");
  }

  if (name === "apply_patch") return "修改文件";
  if (name === "view_image") return args.path ? `查看图片：${args.path}` : "查看图片";
  if (name.includes("browser") || name.includes("screenshot")) return `浏览器操作：${name}`;
  if (name === "request_user_input") return "等待用户选择或输入";
  if (name === "request_plugin_install") return "请求安装插件或连接器";

  const keys = Object.keys(args).slice(0, 4);
  if (!keys.length) return "调用工具";
  return [`调用工具：${name}`, `参数：${keys.join(", ")}`].join("\n");
}

function parseArgs(value) {
  if (!value) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeDecisionRecord(decision) {
  if (decision && typeof decision === "object") {
    return {
      decision: decision.decision || "approved",
      answers: decision.answers,
      scope: decision.scope
    };
  }
  return { decision: decision || "approved" };
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function normalizeLimit(value) {
  if (value === undefined || value === null || value === "") return 0;
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  return Math.min(Math.floor(limit), MAX_SESSION_LIMIT);
}

function normalizeOffset(value) {
  const offset = Number(value);
  if (!Number.isFinite(offset) || offset <= 0) return 0;
  return Math.floor(offset);
}

function cryptoId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
