/**
 * Policy Engine Types — Authoritative Specification
 * 
 * Per Tier-1 Policy Law:
 * - Policy Engine is the sole authority for capability, escalation, and memory write approvals
 * - All decisions are deterministic, auditable, and stateless
 * - No agent may bypass, cache, or infer approval from similarity/memory/precedent
 * 
 * Per Architecture Guardrails:
 * - Policy Engine MUST NOT accept memory-derived inputs (embeddings, similarity scores)
 * - Policy operates on: Skill definitions, Role declarations, User settings, Capability requests
 */

import type { 
  RoleType, 
  CapabilityType, 
  EscalationReasonType 
} from "../skills/types.js";

// =============================================================================
// POLICY REQUEST TYPES
// =============================================================================

/**
 * Type of policy request being evaluated.
 */
export type PolicyRequestType = "capability" | "escalation" | "memory_write";

/**
 * Context for a policy evaluation request.
 * Provides scope information for the decision.
 */
export type PolicyContext = {
  /** Repository identifier */
  repoId: string;
  /** Workspace identifier */
  workspaceId: string;
  /** Current task identifier */
  taskId: string;
  /** Current step within task (optional) */
  stepId?: string;
};

/**
 * User-configurable policy settings.
 * These are explicit user preferences that override defaults.
 */
export type UserPolicySettings = {
  /** Whether escalation is allowed */
  allowEscalation: boolean;
  /** Whether network access is allowed */
  allowNetwork: boolean;
  /** Whether memory writes are allowed */
  allowMemoryWrite: boolean;
};

/**
 * Default user policy settings (most restrictive).
 */
export const DEFAULT_USER_POLICY_SETTINGS: UserPolicySettings = {
  allowEscalation: true,
  allowNetwork: false,
  allowMemoryWrite: false
};

/**
 * Skill reference for policy evaluation.
 * Contains only the fields needed for policy decisions.
 */
export type PolicySkillReference = {
  /** Skill identifier */
  skillId: string;
  /** Skill version for audit */
  version?: string;
  /** Capabilities declared by this skill */
  declaredCapabilities?: CapabilityType[];
  /** Roles allowed to use this skill */
  allowedRoles?: RoleType[];
  /** Escalation reasons this skill declares */
  escalationReasons?: EscalationReasonType[];
  /** Whether skill declares memory write access */
  declaresMemoryWrite?: boolean;
};

/**
 * Policy evaluation request.
 * 
 * INVARIANT: No memory-derived inputs allowed (embeddings, similarity scores).
 */
export type PolicyRequest = {
  /** Unique request identifier for audit */
  requestId: string;
  
  /** Type of request being evaluated */
  requestType: PolicyRequestType;
  
  /** Role making the request */
  role: RoleType;
  
  /** Skill being invoked */
  skill: PolicySkillReference;
  
  /** Capabilities being requested (for capability requests) */
  capabilitiesRequested?: CapabilityType[];
  
  /** Reason for escalation (for escalation requests) */
  escalationReason?: EscalationReasonType;
  
  /** Context of the request */
  context: PolicyContext;
  
  /** User policy settings */
  userSettings: UserPolicySettings;
};

// =============================================================================
// POLICY DECISION TYPES
// =============================================================================

/**
 * Decision codes returned by Policy Engine.
 * Each code has a specific meaning and is auditable.
 */
export type PolicyDecisionCode =
  | "APPROVED"
  | "DENIED_ROLE"           // Role not allowed for this action
  | "DENIED_SKILL"          // Capability not declared by skill
  | "DENIED_CAPABILITY"     // Capability exceeds role ceiling
  | "DENIED_USER_POLICY"    // User settings deny this action
  | "DENIED_ESCALATION_POLICY"  // Escalation not allowed
  | "DENIED_MEMORY_POLICY"  // Memory write not allowed
  | "DENIED_INVALID_REQUEST"; // Malformed request (deny by default)

/**
 * Audit information for a policy decision.
 * Used for traceability and reproducibility.
 */
export type PolicyAudit = {
  /** Timestamp of evaluation (ISO 8601) */
  evaluatedAt: string;
  
  /** SHA-256 hash of inputs (truncated to 16 hex chars) */
  inputsHash: string;
  
  /** Version of policy rules applied */
  ruleVersion: string;
};

/**
 * Policy decision returned by Policy Engine.
 * 
 * This is deterministic: same inputs always produce same output.
 */
export type PolicyDecision = {
  /** Whether the request is approved */
  approved: boolean;
  
  /** Specific decision code */
  decisionCode: PolicyDecisionCode;
  
  /** Human-readable rationale */
  rationale: string;
  
  /** Audit information */
  audit: PolicyAudit;
};

// =============================================================================
// GLOBAL INVARIANTS (G-1 through G-5)
// =============================================================================

/**
 * Global invariant identifiers.
 * These are evaluated before all other rules.
 */
export type GlobalInvariant = 
  | "G-1"  // Role not allowed by skill
  | "G-2"  // Capability not declared by skill
  | "G-3"  // Capability exceeds role law
  | "G-4"  // Escalation requested by non-allowed role
  | "G-5"; // Memory write without explicit user approval

/**
 * Result of checking a global invariant.
 */
export type InvariantCheckResult = {
  invariant: GlobalInvariant;
  passed: boolean;
  violation?: string;
};

// =============================================================================
// ROLE CAPABILITY CEILINGS (from Tier-1)
// =============================================================================

/**
 * Maximum capabilities each role may request.
 * Imported from skills/types.ts for consistency.
 * 
 * Per Tier-1 Role Law:
 * - Supervisor: escalate only
 * - Planner: invoke_subagent, escalate
 * - Specialist: execution capabilities
 * - Verifier: read-only
 */
export { ROLE_CAPABILITY_CEILING } from "../skills/types.js";

// =============================================================================
// POLICY ENGINE CONFIGURATION
// =============================================================================

/**
 * Policy Engine configuration.
 * Allows customization without modifying core rules.
 */
export type PolicyEngineConfig = {
  /** Version string for audit (e.g., "1.0.0") */
  ruleVersion: string;
  
  /** Whether to enforce strict mode (deny on any ambiguity) */
  strictMode: boolean;
};

/**
 * Default Policy Engine configuration.
 */
export const DEFAULT_POLICY_ENGINE_CONFIG: PolicyEngineConfig = {
  ruleVersion: "1.0.0",
  strictMode: true
};

// =============================================================================
// HELPER TYPES
// =============================================================================

/**
 * Input validation result.
 */
export type ValidationResult = 
  | { valid: true }
  | { valid: false; reason: string };

/**
 * Check if a value is a valid PolicyRequest.
 * 
 * Validates essential structure while allowing flexibility:
 * - Required: requestId, requestType, role, skill, context, userSettings
 * - Context must have at least taskId
 * - UserSettings must have at least the boolean flags
 */
export function isValidPolicyRequest(request: unknown): request is PolicyRequest {
  if (!request || typeof request !== "object") return false;
  
  const req = request as Record<string, unknown>;
  
  // Required top-level fields
  if (typeof req.requestId !== "string") return false;
  if (!["capability", "escalation", "memory_write"].includes(req.requestType as string)) return false;
  if (!["supervisor", "planner", "specialist", "verifier"].includes(req.role as string)) return false;
  if (!req.skill || typeof req.skill !== "object") return false;
  if (!req.context || typeof req.context !== "object") return false;
  if (!req.userSettings || typeof req.userSettings !== "object") return false;
  
  // Skill must have at least skillId
  const skill = req.skill as Record<string, unknown>;
  if (typeof skill.skillId !== "string") return false;
  
  // Context must have at least taskId
  const ctx = req.context as Record<string, unknown>;
  if (typeof ctx.taskId !== "string") return false;
  
  // User settings must have the boolean flags
  const settings = req.userSettings as Record<string, unknown>;
  if (typeof settings.allowEscalation !== "boolean") return false;
  if (typeof settings.allowNetwork !== "boolean") return false;
  if (typeof settings.allowMemoryWrite !== "boolean") return false;
  
  return true;
}
