// =============================================================================
// PRIVILEGE LEVELS
// =============================================================================

export type Privilege = "user" | "specialist" | "root";

// =============================================================================
// ROLE TYPES (XSD: roleType enumeration)
// =============================================================================

/**
 * Agent roles as defined in skills-schema.xsd.
 * Each role has specific authority boundaries per Tier-1 Role Law.
 */
export type RoleType = "supervisor" | "planner" | "specialist" | "verifier";

/**
 * All valid role types for validation.
 */
export const VALID_ROLES: readonly RoleType[] = [
  "supervisor",
  "planner",
  "specialist",
  "verifier"
] as const;

// =============================================================================
// CAPABILITY TYPES (XSD: capabilityType enumeration)
// =============================================================================

/**
 * Capabilities as defined in skills-schema.xsd.
 * Capabilities are checked before skill execution.
 */
export type CapabilityType =
  | "read_repo"
  | "write_repo"
  | "execute_code"
  | "network_access"
  | "memory_read"
  | "memory_write"
  | "invoke_subagent"
  | "escalate";

/**
 * All valid capability types for validation.
 */
export const VALID_CAPABILITIES: readonly CapabilityType[] = [
  "read_repo",
  "write_repo",
  "execute_code",
  "network_access",
  "memory_read",
  "memory_write",
  "invoke_subagent",
  "escalate"
] as const;

/**
 * @deprecated Use CapabilityType instead. Kept for backward compatibility.
 */
export type Capability = CapabilityType;

// =============================================================================
// ESCALATION REASON TYPES (XSD: escalationReasonType enumeration)
// =============================================================================

/**
 * Escalation reasons as defined in skills-schema.xsd.
 * Used in escalation policies and tickets.
 */
export type EscalationReasonType =
  | "missing_capability"
  | "ambiguous_requirement"
  | "framework_uncertainty"
  | "malformed_output"
  | "policy_conflict";

/**
 * All valid escalation reasons for validation.
 */
export const VALID_ESCALATION_REASONS: readonly EscalationReasonType[] = [
  "missing_capability",
  "ambiguous_requirement",
  "framework_uncertainty",
  "malformed_output",
  "policy_conflict"
] as const;

// =============================================================================
// MEMORY ACCESS (XSD: memoryAccess element)
// =============================================================================

/**
 * Memory access declaration for a skill.
 * Per Memory Law: memory writes require policy approval.
 */
export type MemoryAccess = {
  read: boolean;
  write: boolean;
};

// =============================================================================
// ESCALATION POLICY (XSD: escalationPolicy element)
// =============================================================================

/**
 * Escalation policy declaration for a skill.
 * Defines which escalation reasons are valid for this skill.
 */
export type EscalationPolicy = {
  on: EscalationReasonType[];
};

// =============================================================================
// SKILL DEFINITION (XSD: SkillType complexType)
// =============================================================================

/**
 * A skill definition as parsed from skills.xml.
 * Matches the XSD schema structure with backward-compatible extensions.
 */
export type LikuSkill = {
  /** Unique skill identifier (required) */
  id: string;
  
  /** Skill version for audit and hashing (XSD: required) */
  version?: string;
  
  /** Human-readable description */
  description?: string;
  
  /** Residence path where skill is defined */
  residencePath: string;
  
  /** Minimum privilege level required */
  requiredPrivilege: Privilege;
  
  /** Parent skill ID for hierarchical inheritance (XSD: extends) */
  extends?: string;
  
  /** Roles allowed to invoke this skill (XSD: allowedRoles) */
  allowedRoles?: RoleType[];
  
  /** Capabilities required to execute (XSD: requiredCapabilities) */
  requiredCapabilities?: CapabilityType[];
  
  /** Tools this skill is allowed to invoke (XSD: allowedTools) */
  allowedTools?: string[];
  
  /** Escalation policy for this skill (XSD: escalationPolicy) */
  escalationPolicy?: EscalationPolicy;
  
  /** Memory access permissions (XSD: memoryAccess) */
  memoryAccess?: MemoryAccess;
  
  // --- Backward compatibility fields ---
  
  /** @deprecated Use requiredCapabilities instead. Single capability required. */
  requires?: CapabilityType;
  
  /** @deprecated Use escalationPolicy instead. If true, missing capability triggers escalation. */
  escalateIfMissing?: boolean;
};

/**
 * Index of all skills loaded for an agent.
 */
export type SkillsIndex = {
  skills: LikuSkill[];
  byId: Map<string, LikuSkill>;
};

// =============================================================================
// ROLE CAPABILITY CEILINGS (Policy Engine Reference)
// =============================================================================

/**
 * Maximum capabilities each role may request.
 * Per Tier-1: Roles may not exceed their ceiling.
 * Used by Policy Engine for DENIED_ROLE decisions.
 */
export const ROLE_CAPABILITY_CEILING: Record<RoleType, CapabilityType[]> = {
  supervisor: ["escalate"],
  planner: ["invoke_subagent", "escalate"],
  specialist: ["read_repo", "write_repo", "execute_code", "memory_read", "memory_write", "invoke_subagent"],
  verifier: ["read_repo", "memory_read"]
};

// =============================================================================
// PRIVILEGE CAPABILITIES (Backward Compatible)
// =============================================================================

/**
 * Capabilities granted at a residence level.
 * Root has all capabilities, specialists have subset.
 */
export const PRIVILEGE_CAPABILITIES: Record<Privilege, CapabilityType[]> = {
  root: ["read_repo", "write_repo", "execute_code", "network_access", "memory_read", "memory_write", "escalate", "invoke_subagent"],
  specialist: ["read_repo", "write_repo", "execute_code", "memory_read", "memory_write", "invoke_subagent"],
  user: ["read_repo", "memory_read"]
};

/**
 * Check if a privilege level has a capability.
 */
export function hasCapability(privilege: Privilege, capability: CapabilityType): boolean {
  return PRIVILEGE_CAPABILITIES[privilege].includes(capability);
}

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Check if a string is a valid RoleType.
 */
export function isValidRole(role: string): role is RoleType {
  return VALID_ROLES.includes(role as RoleType);
}

/**
 * Check if a string is a valid CapabilityType.
 */
export function isValidCapability(cap: string): cap is CapabilityType {
  return VALID_CAPABILITIES.includes(cap as CapabilityType);
}

/**
 * Check if a string is a valid EscalationReasonType.
 */
export function isValidEscalationReason(reason: string): reason is EscalationReasonType {
  return VALID_ESCALATION_REASONS.includes(reason as EscalationReasonType);
}

/**
 * Check if a role can request a capability (within ceiling).
 */
export function isCapabilityWithinRoleCeiling(role: RoleType, capability: CapabilityType): boolean {
  return ROLE_CAPABILITY_CEILING[role].includes(capability);
}

