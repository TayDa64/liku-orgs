/**
 * Policy Engine — Central Authority for All Policy Decisions
 * 
 * TIER-1 MANDATE (LOCKED):
 * - Policy Engine is the SOLE authority for capability, escalation, and memory write approvals
 * - All decisions are deterministic, auditable, and stateless
 * - No side effects (no memory reads, no LLM calls)
 * - DENY BY DEFAULT on any failure
 * 
 * ARCHITECTURE GUARDRAILS:
 * - Policy Engine MUST NOT accept memory-derived inputs
 * - Policy is evaluated BEFORE tool use, escalation, and memory writes
 */

import crypto from "node:crypto";
import type {
  PolicyRequest,
  PolicyDecision,
  PolicyDecisionCode,
  PolicyAudit,
  PolicyEngineConfig,
  GlobalInvariant,
  InvariantCheckResult,
  PolicySkillReference
} from "./policyTypes.js";
import {
  DEFAULT_POLICY_ENGINE_CONFIG,
  isValidPolicyRequest
} from "./policyTypes.js";
import type { CapabilityType, RoleType } from "../skills/types.js";
import { ROLE_CAPABILITY_CEILING } from "../skills/types.js";

// =============================================================================
// HASH COMPUTATION (Per Hashing Law)
// =============================================================================

/**
 * Compute SHA-256 hash of policy inputs, truncated to 16 hex chars.
 * 
 * Hash inputs (per Architecture Guardrails):
 * - Skill ID + version
 * - Role
 * - Capability set requested
 * - User settings
 * - Policy rule version
 */
function computeInputsHash(request: PolicyRequest, ruleVersion: string): string {
  const hashInput = JSON.stringify({
    skillId: request.skill.skillId,
    skillVersion: request.skill.version,
    role: request.role,
    capabilities: request.capabilitiesRequested?.sort() ?? [],
    escalationReason: request.escalationReason,
    userSettings: request.userSettings,
    ruleVersion
  });
  
  const hash = crypto.createHash("sha256").update(hashInput).digest("hex");
  return hash.slice(0, 16); // Truncate to 16 hex chars (64 bits)
}

/**
 * Create audit record for a decision.
 */
function createAudit(request: PolicyRequest, config: PolicyEngineConfig): PolicyAudit {
  return {
    evaluatedAt: new Date().toISOString(),
    inputsHash: computeInputsHash(request, config.ruleVersion),
    ruleVersion: config.ruleVersion
  };
}

// =============================================================================
// GLOBAL INVARIANTS (G-1 through G-5)
// =============================================================================

/**
 * G-1: Role not allowed by skill.
 * If skill declares allowedRoles, the requesting role must be in the list.
 */
function checkG1(request: PolicyRequest): InvariantCheckResult {
  const { role, skill } = request;
  
  // If skill doesn't declare allowedRoles, any role is allowed (backward compat)
  if (!skill.allowedRoles || skill.allowedRoles.length === 0) {
    return { invariant: "G-1", passed: true };
  }
  
  if (!skill.allowedRoles.includes(role)) {
    return {
      invariant: "G-1",
      passed: false,
      violation: `Role '${role}' not in skill's allowedRoles: [${skill.allowedRoles.join(", ")}]`
    };
  }
  
  return { invariant: "G-1", passed: true };
}

/**
 * G-2: Capability not declared by skill.
 * Requested capabilities must be declared in skill's requiredCapabilities.
 */
function checkG2(request: PolicyRequest): InvariantCheckResult {
  const { capabilitiesRequested, skill } = request;
  
  // Only applies to capability requests
  if (request.requestType !== "capability" || !capabilitiesRequested) {
    return { invariant: "G-2", passed: true };
  }
  
  // If skill doesn't declare capabilities, any capability is allowed (backward compat)
  if (!skill.declaredCapabilities || skill.declaredCapabilities.length === 0) {
    return { invariant: "G-2", passed: true };
  }
  
  for (const cap of capabilitiesRequested) {
    if (!skill.declaredCapabilities.includes(cap)) {
      return {
        invariant: "G-2",
        passed: false,
        violation: `Capability '${cap}' not declared by skill '${skill.skillId}'`
      };
    }
  }
  
  return { invariant: "G-2", passed: true };
}

/**
 * G-3: Capability exceeds role law.
 * Requested capabilities must be within role's capability ceiling.
 */
function checkG3(request: PolicyRequest): InvariantCheckResult {
  const { role, capabilitiesRequested } = request;
  
  // Only applies to capability requests
  if (request.requestType !== "capability" || !capabilitiesRequested) {
    return { invariant: "G-3", passed: true };
  }
  
  const ceiling = ROLE_CAPABILITY_CEILING[role];
  
  for (const cap of capabilitiesRequested) {
    if (!ceiling.includes(cap)) {
      return {
        invariant: "G-3",
        passed: false,
        violation: `Capability '${cap}' exceeds role '${role}' ceiling: [${ceiling.join(", ")}]`
      };
    }
  }
  
  return { invariant: "G-3", passed: true };
}

/**
 * G-4: Escalation requested by non-allowed role.
 * Supervisor cannot request escalation (it approves them).
 */
function checkG4(request: PolicyRequest): InvariantCheckResult {
  const { role, requestType } = request;
  
  // Only applies to escalation requests
  if (requestType !== "escalation") {
    return { invariant: "G-4", passed: true };
  }
  
  // Supervisor cannot request escalation (it's the approver)
  if (role === "supervisor") {
    return {
      invariant: "G-4",
      passed: false,
      violation: "Supervisor cannot request escalation (it approves them)"
    };
  }
  
  return { invariant: "G-4", passed: true };
}

/**
 * G-5: Memory write without explicit user approval.
 * Memory writes require userSettings.allowMemoryWrite === true.
 */
function checkG5(request: PolicyRequest): InvariantCheckResult {
  const { requestType, userSettings } = request;
  
  // Only applies to memory write requests
  if (requestType !== "memory_write") {
    return { invariant: "G-5", passed: true };
  }
  
  if (!userSettings.allowMemoryWrite) {
    return {
      invariant: "G-5",
      passed: false,
      violation: "Memory write requires explicit user approval (userSettings.allowMemoryWrite)"
    };
  }
  
  return { invariant: "G-5", passed: true };
}

/**
 * Check all global invariants.
 * Returns first failed invariant, or null if all pass.
 */
function checkGlobalInvariants(request: PolicyRequest): InvariantCheckResult | null {
  const checks = [checkG1, checkG2, checkG3, checkG4, checkG5];
  
  for (const check of checks) {
    const result = check(request);
    if (!result.passed) {
      return result;
    }
  }
  
  return null;
}

// =============================================================================
// CAPABILITY APPROVAL RULES
// =============================================================================

/**
 * Evaluate a capability request.
 * Per policy-engine.md Section 5.
 */
function evaluateCapabilityRequest(
  request: PolicyRequest,
  config: PolicyEngineConfig
): PolicyDecision {
  const { role, capabilitiesRequested, skill, userSettings } = request;
  const audit = createAudit(request, config);
  
  // No capabilities requested = trivially approved
  if (!capabilitiesRequested || capabilitiesRequested.length === 0) {
    return {
      approved: true,
      decisionCode: "APPROVED",
      rationale: "No capabilities requested",
      audit
    };
  }
  
  // Check network access against user settings
  if (capabilitiesRequested.includes("network_access") && !userSettings.allowNetwork) {
    return {
      approved: false,
      decisionCode: "DENIED_USER_POLICY",
      rationale: "Network access denied by user settings",
      audit
    };
  }
  
  // Check memory write against user settings
  if (capabilitiesRequested.includes("memory_write") && !userSettings.allowMemoryWrite) {
    return {
      approved: false,
      decisionCode: "DENIED_USER_POLICY",
      rationale: "Memory write denied by user settings",
      audit
    };
  }
  
  // All checks passed
  return {
    approved: true,
    decisionCode: "APPROVED",
    rationale: `Capabilities [${capabilitiesRequested.join(", ")}] approved for role '${role}' on skill '${skill.skillId}'`,
    audit
  };
}

// =============================================================================
// ESCALATION APPROVAL RULES
// =============================================================================

/**
 * Evaluate an escalation request.
 * Per policy-engine.md Section 6.
 */
function evaluateEscalationRequest(
  request: PolicyRequest,
  config: PolicyEngineConfig
): PolicyDecision {
  const { skill, escalationReason, userSettings } = request;
  const audit = createAudit(request, config);
  
  // Check user settings
  if (!userSettings.allowEscalation) {
    return {
      approved: false,
      decisionCode: "DENIED_USER_POLICY",
      rationale: "Escalation denied by user settings",
      audit
    };
  }
  
  // Check if skill declares escalation policy
  if (!skill.escalationReasons || skill.escalationReasons.length === 0) {
    return {
      approved: false,
      decisionCode: "DENIED_ESCALATION_POLICY",
      rationale: `Skill '${skill.skillId}' does not declare escalationPolicy`,
      audit
    };
  }
  
  // Check if reason matches declared reasons
  if (escalationReason && !skill.escalationReasons.includes(escalationReason)) {
    return {
      approved: false,
      decisionCode: "DENIED_ESCALATION_POLICY",
      rationale: `Escalation reason '${escalationReason}' not declared by skill '${skill.skillId}'`,
      audit
    };
  }
  
  // Approved
  return {
    approved: true,
    decisionCode: "APPROVED",
    rationale: `Escalation approved for reason '${escalationReason}' on skill '${skill.skillId}'`,
    audit
  };
}

// =============================================================================
// MEMORY WRITE APPROVAL RULES
// =============================================================================

/**
 * Evaluate a memory write request.
 * Per policy-engine.md Section 7.
 * 
 * Memory writes are DISABLED BY DEFAULT.
 */
function evaluateMemoryWriteRequest(
  request: PolicyRequest,
  config: PolicyEngineConfig
): PolicyDecision {
  const { role, skill, userSettings } = request;
  const audit = createAudit(request, config);
  
  // User must explicitly allow memory writes (already checked in G-5)
  // Double-check here for defense in depth
  if (!userSettings.allowMemoryWrite) {
    return {
      approved: false,
      decisionCode: "DENIED_MEMORY_POLICY",
      rationale: "Memory write denied: user settings do not allow",
      audit
    };
  }
  
  // Only Specialist or Supervisor can write memory
  if (role !== "specialist" && role !== "supervisor") {
    return {
      approved: false,
      decisionCode: "DENIED_ROLE",
      rationale: `Memory write denied: role '${role}' cannot write memory (only specialist/supervisor)`,
      audit
    };
  }
  
  // Skill must declare memory write access
  if (!skill.declaresMemoryWrite) {
    return {
      approved: false,
      decisionCode: "DENIED_SKILL",
      rationale: `Memory write denied: skill '${skill.skillId}' does not declare memoryAccess.write`,
      audit
    };
  }
  
  // Approved
  return {
    approved: true,
    decisionCode: "APPROVED",
    rationale: `Memory write approved for role '${role}' on skill '${skill.skillId}'`,
    audit
  };
}

// =============================================================================
// MAIN EVALUATION FUNCTION
// =============================================================================

/**
 * Evaluate a policy request.
 * 
 * This is a PURE FUNCTION:
 * - No side effects
 * - No memory reads
 * - No LLM calls
 * - Deterministic output for same input
 * 
 * FAILURE MODE: DENY BY DEFAULT
 * If anything fails (throws, invalid input), the result is DENY.
 */
export function evaluate(
  request: PolicyRequest,
  config: PolicyEngineConfig = DEFAULT_POLICY_ENGINE_CONFIG
): PolicyDecision {
  // Create audit first (needed for all responses)
  let audit: PolicyAudit;
  
  try {
    // Validate request structure
    if (!isValidPolicyRequest(request)) {
      // Can't create proper audit without valid request, use fallback
      return {
        approved: false,
        decisionCode: "DENIED_INVALID_REQUEST",
        rationale: "Invalid policy request: missing or malformed required fields",
        audit: {
          evaluatedAt: new Date().toISOString(),
          inputsHash: "0000000000000000",
          ruleVersion: config.ruleVersion
        }
      };
    }
    
    audit = createAudit(request, config);
    
    // Check global invariants first (G-1 through G-5)
    const invariantViolation = checkGlobalInvariants(request);
    if (invariantViolation) {
      // Map invariant to decision code
      const codeMap: Record<GlobalInvariant, PolicyDecisionCode> = {
        "G-1": "DENIED_ROLE",
        "G-2": "DENIED_SKILL",
        "G-3": "DENIED_CAPABILITY",
        "G-4": "DENIED_ESCALATION_POLICY",
        "G-5": "DENIED_MEMORY_POLICY"
      };
      
      return {
        approved: false,
        decisionCode: codeMap[invariantViolation.invariant],
        rationale: `Global invariant ${invariantViolation.invariant} violated: ${invariantViolation.violation}`,
        audit
      };
    }
    
    // Route to specific request type handler
    switch (request.requestType) {
      case "capability":
        return evaluateCapabilityRequest(request, config);
      
      case "escalation":
        return evaluateEscalationRequest(request, config);
      
      case "memory_write":
        return evaluateMemoryWriteRequest(request, config);
      
      default:
        // Should never reach here due to validation, but DENY BY DEFAULT
        return {
          approved: false,
          decisionCode: "DENIED_INVALID_REQUEST",
          rationale: `Unknown request type: ${request.requestType}`,
          audit
        };
    }
    
  } catch (err) {
    // FAILURE MODE: DENY BY DEFAULT
    // This is a security feature per policy-engine.md Section 12
    return {
      approved: false,
      decisionCode: "DENIED_INVALID_REQUEST",
      rationale: `Policy evaluation failed: ${err instanceof Error ? err.message : "unknown error"}`,
      audit: {
        evaluatedAt: new Date().toISOString(),
        inputsHash: "0000000000000000",
        ruleVersion: config.ruleVersion
      }
    };
  }
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Create a minimal PolicySkillReference from a skill ID.
 * Useful for simple capability checks.
 */
export function createSkillReference(
  skillId: string,
  options?: Partial<PolicySkillReference>
): PolicySkillReference {
  return {
    skillId,
    ...options
  };
}

/**
 * Create a PolicyRequest for a capability check.
 */
export function createCapabilityRequest(
  requestId: string,
  role: RoleType,
  skill: PolicySkillReference,
  capabilities: CapabilityType[],
  context: PolicyRequest["context"],
  userSettings: PolicyRequest["userSettings"]
): PolicyRequest {
  return {
    requestId,
    requestType: "capability",
    role,
    skill,
    capabilitiesRequested: capabilities,
    context,
    userSettings
  };
}

/**
 * Check if a decision is approved.
 */
export function isApproved(decision: PolicyDecision): boolean {
  return decision.approved && decision.decisionCode === "APPROVED";
}
