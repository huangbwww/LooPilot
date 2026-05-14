export const APPROVAL_POLICIES = new Set(["on-request", "on-failure", "never"]);
export const APPROVAL_SCOPES = new Set(["turn", "session", "always"]);
export const SANDBOX_MODES = new Set(["read-only", "workspace-write", "danger-full-access"]);

export function normalizeApprovalPolicy(value) {
  return APPROVAL_POLICIES.has(value) ? value : undefined;
}

export function normalizeApprovalScope(value) {
  return APPROVAL_SCOPES.has(value) ? value : undefined;
}

export function normalizeSandboxMode(value) {
  return SANDBOX_MODES.has(value) ? value : undefined;
}

export function defaultSandboxModeForApproval(approvalPolicy) {
  return approvalPolicy === "never" ? "danger-full-access" : undefined;
}
