/**
 * Skill capability validation.
 * Checks if an agent has the required capabilities to execute skills.
 */

import type { 
  LikuSkill, 
  Privilege, 
  CapabilityType, 
  RoleType,
  SkillsIndex 
} from "./types.js";
import { 
  hasCapability, 
  PRIVILEGE_CAPABILITIES,
  isCapabilityWithinRoleCeiling
} from "./types.js";

// Re-export for backward compatibility
export type Capability = CapabilityType;

/**
 * Result of validating a skill for execution.
 */
export type SkillValidationResult =
  | { allowed: true }
  | { allowed: false; reason: "missing_capability"; capability: CapabilityType; escalate: boolean }
  | { allowed: false; reason: "insufficient_privilege"; required: Privilege; current: Privilege }
  | { allowed: false; reason: "role_not_allowed"; role: RoleType; allowedRoles: RoleType[] }
  | { allowed: false; reason: "capability_exceeds_role_ceiling"; role: RoleType; capability: CapabilityType };

/**
 * Validate if a skill can be executed at the given privilege level.
 * Optionally checks role-based restrictions if role is provided.
 */
export function validateSkillExecution(
  skill: LikuSkill,
  currentPrivilege: Privilege,
  role?: RoleType
): SkillValidationResult {
  // Check privilege level first
  const privilegeOrder: Privilege[] = ["user", "specialist", "root"];
  const currentLevel = privilegeOrder.indexOf(currentPrivilege);
  const requiredLevel = privilegeOrder.indexOf(skill.requiredPrivilege);

  if (currentLevel < requiredLevel) {
    return {
      allowed: false,
      reason: "insufficient_privilege",
      required: skill.requiredPrivilege,
      current: currentPrivilege
    };
  }

  // Check role restrictions if role is provided and skill has allowedRoles
  if (role && skill.allowedRoles && skill.allowedRoles.length > 0) {
    if (!skill.allowedRoles.includes(role)) {
      return {
        allowed: false,
        reason: "role_not_allowed",
        role,
        allowedRoles: skill.allowedRoles
      };
    }
  }

  // Check capability requirements (new XSD format)
  if (skill.requiredCapabilities && skill.requiredCapabilities.length > 0) {
    for (const cap of skill.requiredCapabilities) {
      // Check if privilege level grants this capability
      if (!hasCapability(currentPrivilege, cap)) {
        const escalate = skill.escalationPolicy?.on.includes("missing_capability") ?? 
                         skill.escalateIfMissing ?? false;
        return {
          allowed: false,
          reason: "missing_capability",
          capability: cap,
          escalate
        };
      }
      
      // Check if role ceiling allows this capability
      if (role && !isCapabilityWithinRoleCeiling(role, cap)) {
        return {
          allowed: false,
          reason: "capability_exceeds_role_ceiling",
          role,
          capability: cap
        };
      }
    }
  }

  // Check legacy single capability requirement
  if (skill.requires) {
    if (!hasCapability(currentPrivilege, skill.requires)) {
      return {
        allowed: false,
        reason: "missing_capability",
        capability: skill.requires,
        escalate: skill.escalateIfMissing ?? false
      };
    }
    
    // Check role ceiling for legacy capability
    if (role && !isCapabilityWithinRoleCeiling(role, skill.requires)) {
      return {
        allowed: false,
        reason: "capability_exceeds_role_ceiling",
        role,
        capability: skill.requires
      };
    }
  }

  return { allowed: true };
}

/**
 * Check all skills in an index for capability violations.
 * Returns skills that would require escalation.
 */
export function findEscalationRequired(
  skillsIndex: SkillsIndex,
  currentPrivilege: Privilege,
  role?: RoleType
): LikuSkill[] {
  const escalationSkills: LikuSkill[] = [];

  for (const skill of skillsIndex.skills) {
    const result = validateSkillExecution(skill, currentPrivilege, role);
    if (!result.allowed && result.reason === "missing_capability" && result.escalate) {
      escalationSkills.push(skill);
    }
  }

  return escalationSkills;
}

/**
 * Get capabilities available at a residence based on its path.
 * Root residence has all capabilities, specialists have subset.
 */
export function getResidencePrivilege(residencePath: string): Privilege {
  // Normalize path separators
  const normalized = residencePath.replace(/\\/g, "/");
  
  if (normalized.includes("/root")) {
    return "root";
  }
  // Match "Liku" at end of path (the root Liku directory)
  if (normalized === "Liku" || normalized.endsWith("/Liku")) {
    return "root";
  }
  if (normalized.includes("/specialist")) {
    return "specialist";
  }
  return "user";
}

/**
 * Get all capabilities available at a privilege level.
 */
export function getCapabilities(privilege: Privilege): CapabilityType[] {
  return [...PRIVILEGE_CAPABILITIES[privilege]];
}

/**
 * Build a validation report for a set of skills.
 */
export type SkillValidationReport = {
  totalSkills: number;
  allowed: number;
  blocked: number;
  escalationRequired: number;
  details: Array<{
    skillId: string;
    result: SkillValidationResult;
  }>;
};

export function validateSkillsIndex(
  skillsIndex: SkillsIndex,
  currentPrivilege: Privilege,
  role?: RoleType
): SkillValidationReport {
  const details: SkillValidationReport["details"] = [];
  let allowed = 0;
  let blocked = 0;
  let escalationRequired = 0;

  for (const skill of skillsIndex.skills) {
    const result = validateSkillExecution(skill, currentPrivilege, role);
    details.push({ skillId: skill.id, result });

    if (result.allowed) {
      allowed++;
    } else if (result.reason === "missing_capability" && result.escalate) {
      escalationRequired++;
    } else {
      blocked++;
    }
  }

  return {
    totalSkills: skillsIndex.skills.length,
    allowed,
    blocked,
    escalationRequired,
    details
  };
}
