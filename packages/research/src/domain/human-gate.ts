/**
 * HumanGate entity — durable, cross-process recoverable human decision gate.
 * resumeToken is stored HASHED (never plaintext), scoped, single-use, expiring.
 * The safe token primitive lives in runtime/human-gate.ts.
 */

export type HumanGateStatus = "pending" | "approved" | "rejected" | "expired" | "cancelled";

export type HumanGateDecision = "approved" | "rejected";

export interface HumanGateScope {
  projectId: string;
  runId: string;
  gateId: string;
}

export interface HumanGate {
  gateId: string;
  taskId: string;
  type: "before_reserve" | "before_major_conclusion" | "methodology_activate";
  status: HumanGateStatus;
  requestedAt: string;
  decidedAt?: string;
  decision?: HumanGateDecision;
  operator?: string;
  comment?: string;
  /** SHA-256 hash of the resume token — plaintext is returned once at creation only. */
  resumeTokenHash?: string;
  resumeTokenScope?: HumanGateScope;
  resumeTokenExpiresAt?: string;
  resumeTokenConsumed?: boolean;
}
