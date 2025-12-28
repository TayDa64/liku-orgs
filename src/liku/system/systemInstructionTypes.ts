/**
 * System Instruction Types
 *
 * Defines the type structure for per-role system instructions.
 * These correspond to the XML schema in info-instructions/system-instruction-schema.xsd.
 *
 * Per Architecture Guardrails:
 * - System instructions are LOCKED and non-negotiable
 * - Agent must acknowledge receipt before execution proceeds
 * - Failure to acknowledge = hard stop
 */

import type { RoleType, CapabilityType, EscalationReasonType } from "../skills/types.js";

// ============================================================================
// SEVERITY TYPES
// ============================================================================

/**
 * Violation severity levels.
 * Determines the response to prohibition violations.
 */
export type SeverityType = "critical" | "high" | "medium" | "low";

/**
 * Action taken when a prohibition is violated.
 */
export type ViolationAction = "terminate" | "escalate" | "log_and_continue";

/**
 * Escalation behavior modes.
 */
export type EscalationBehavior = "explicit_ticket" | "halt_and_report" | "log_only";

// ============================================================================
// PURPOSE TYPES
// ============================================================================

/**
 * Defines the purpose and nature of a role.
 */
export type SystemPurpose = {
  /** Human-readable description of the role's purpose */
  description: string;
  /** The fundamental nature of the role */
  nature: string;
  /** List of responsibilities for this role */
  responsibilities: string[];
  /** Capabilities this role is allowed to use */
  allowedCapabilities?: CapabilityType[];
};

// ============================================================================
// PROHIBITION TYPES
// ============================================================================

/**
 * A single prohibition - an action the role MUST NOT perform.
 */
export type SystemProhibition = {
  /** Unique identifier for this prohibition (e.g., "SUPV-001") */
  id: string;
  /** The prohibited action */
  action: string;
  /** Why this action is prohibited for this role */
  rationale: string;
  /** Severity of violating this prohibition */
  violationSeverity: SeverityType;
  /** What happens when this prohibition is violated */
  onViolation: ViolationAction;
};

/**
 * Collection of prohibitions for a role.
 */
export type SystemProhibitions = {
  prohibitions: SystemProhibition[];
};

// ============================================================================
// ESCALATION RULE TYPES
// ============================================================================

/**
 * A trigger condition for escalation.
 */
export type EscalationTrigger = {
  /** The reason category for escalation */
  reason: EscalationReasonType;
  /** Description of when this trigger applies */
  description: string;
  /** Whether to automatically create escalation ticket */
  autoEscalate: boolean;
};

/**
 * Escalation rules for a role.
 */
export type SystemEscalationRules = {
  /** Whether this role can initiate escalation */
  canEscalate: boolean;
  /** Whether this role can approve escalations (only supervisor) */
  canApproveEscalation: boolean;
  /** Conditions that trigger escalation */
  escalationTriggers?: EscalationTrigger[];
  /** How escalation is handled */
  escalationBehavior: EscalationBehavior;
};

// ============================================================================
// MEMORY RULE TYPES
// ============================================================================

/**
 * Memory scope with priority weight.
 */
export type MemoryScopePriority = {
  /** Scope name: "workspace", "repository", "global" */
  scope: string;
  /** Weight for this scope (1.0 = highest priority) */
  weight: number;
};

/**
 * Memory access rules for a role.
 */
export type SystemMemoryRules = {
  /** Whether this role can read from vector memory */
  canRead: boolean;
  /** Whether this role can propose memory writes */
  canWrite: boolean;
  /** Whether this role can mark memory as validated (only verifier) */
  canValidate: boolean;
  /** If true, memory is treated as advisory only */
  advisoryOnly: boolean;
  /** Scope priority for memory retrieval */
  scopePriority?: MemoryScopePriority[];
};

// ============================================================================
// SYSTEM INSTRUCTION TYPE
// ============================================================================

/**
 * Complete system instruction for a role.
 * Corresponds to the <systemInstruction> XML element.
 */
export type SystemInstruction = {
  /** The role this instruction applies to */
  role: RoleType;
  /** Version of this instruction (for change tracking) */
  version: string;
  /** Schema version used to define this instruction */
  schemaVersion: string;
  /** Purpose and nature of the role */
  purpose: SystemPurpose;
  /** Actions the role MUST NOT perform */
  prohibitions: SystemProhibitions;
  /** When and how the role should escalate */
  escalationRules: SystemEscalationRules;
  /** Memory access permissions and constraints */
  memoryRules: SystemMemoryRules;
  /** Whether agent must acknowledge before execution */
  acknowledgementRequired: boolean;
};

// ============================================================================
// ACKNOWLEDGEMENT TYPES
// ============================================================================

/**
 * Acknowledgement emitted by agent after receiving system instruction.
 * Failure to emit = hard stop.
 */
export type SystemInstructionAck = {
  /** The role acknowledging */
  role: RoleType;
  /** Hash of the system instruction version (SHA-256 truncated to 16 hex) */
  version: string;
  /** Whether the agent accepted the instruction */
  accepted: boolean;
  /** Timestamp of acknowledgement */
  timestamp: string;
  /** Task ID for audit trail */
  taskId?: string;
};

/**
 * Result of acknowledgement validation.
 */
export type AckValidationResult = {
  /** Whether the acknowledgement is valid */
  valid: boolean;
  /** Reason for invalid acknowledgement */
  reason?: string;
  /** Expected version hash if mismatch */
  expectedVersion?: string;
  /** Received version hash if mismatch */
  receivedVersion?: string;
};

// ============================================================================
// PROHIBITION CHECK TYPES
// ============================================================================

/**
 * Result of checking an action against prohibitions.
 */
export type ProhibitionCheckResult = {
  /** Whether the action is prohibited */
  prohibited: boolean;
  /** Matching prohibition if found */
  prohibition?: SystemProhibition;
  /** Action to take on violation */
  action?: ViolationAction;
};

/**
 * Well-known prohibited actions for type safety.
 * These map to prohibition IDs in system XMLs.
 */
export const PROHIBITED_ACTIONS = {
  // Supervisor prohibitions
  EXECUTE_TASKS: "execute_tasks",
  CALL_TOOLS: "call_tools",
  MODIFY_ARTIFACTS: "modify_artifacts",
  BYPASS_POLICY: "bypass_policy_engine",
  INVENT_REQUIREMENTS: "invent_requirements",
  FILL_AMBIGUITIES: "fill_ambiguities_silently",

  // Planner prohibitions
  INVOKE_TOOLS: "invoke_tools",
  SILENT_DEGRADATION: "silent_degradation",
  BEST_EFFORT_EXECUTION: "best_effort_execution",
  IMPLICIT_ESCALATION: "implicit_escalation",
  ACCEPT_RAW_INPUT: "accept_raw_input",

  // Specialist prohibitions
  SELF_AUTHORIZE: "self_authorize_capabilities",
  MODIFY_POLICY: "modify_policy",
  APPROVE_ESCALATIONS: "approve_escalations",
  GLOBAL_MEMORY_NO_APPROVAL: "write_global_memory_without_approval",
  EXCEED_SCOPE: "exceed_planner_scope",
  UNDECLARED_TOOLS: "invoke_undeclared_tools",
  SELF_ELEVATE: "self_elevate_privilege",

  // Verifier prohibitions
  MODIFY_OUTPUTS: "modify_outputs",
  EXECUTE_TOOLS: "execute_tools",
  MEMORY_WRITE: "memory_write",
  INVOKE_SUBAGENTS: "invoke_subagents",
  FIX_DIRECTLY: "fix_violations_directly",
  OVERRIDE_POLICY: "override_policy"
} as const;

export type ProhibitedAction = (typeof PROHIBITED_ACTIONS)[keyof typeof PROHIBITED_ACTIONS];
