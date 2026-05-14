export const APPROVAL_POLICIES = new Set(["on-request", "on-failure", "never"]);
export const APPROVAL_SCOPES = new Set(["turn", "session", "always"]);

export function normalizeApprovalPolicy(value) {
  return APPROVAL_POLICIES.has(value) ? value : undefined;
}

export function normalizeApprovalScope(value) {
  return APPROVAL_SCOPES.has(value) ? value : undefined;
}
