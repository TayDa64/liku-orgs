/**
 * System Instruction Loader
 *
 * Parses and validates system instruction XML files for each role.
 * Uses fast-xml-parser for XML parsing (same as skillsXml.ts).
 *
 * Per Architecture Guardrails:
 * - System instructions are LOCKED and non-negotiable
 * - Invalid structure fails fast with specific error
 */

import { XMLParser } from "fast-xml-parser";
import type { RoleType, CapabilityType, EscalationReasonType } from "../skills/types.js";
import type {
  SystemInstruction,
  SystemPurpose,
  SystemProhibition,
  SystemProhibitions,
  SystemEscalationRules,
  SystemMemoryRules,
  EscalationTrigger,
  MemoryScopePriority,
  SeverityType,
  ViolationAction,
  EscalationBehavior
} from "./systemInstructionTypes.js";

// ============================================================================
// CONSTANTS
// ============================================================================

const VALID_ROLES: readonly RoleType[] = ["supervisor", "planner", "specialist", "verifier"];

const VALID_CAPABILITIES: readonly CapabilityType[] = [
  "read_repo",
  "write_repo",
  "execute_code",
  "network_access",
  "memory_read",
  "memory_write",
  "invoke_subagent",
  "escalate"
];

const VALID_ESCALATION_REASONS: readonly EscalationReasonType[] = [
  "missing_capability",
  "ambiguous_requirement",
  "framework_uncertainty",
  "malformed_output",
  "policy_conflict"
];

const VALID_SEVERITIES: readonly SeverityType[] = ["critical", "high", "medium", "low"];

const VALID_VIOLATION_ACTIONS: readonly ViolationAction[] = ["terminate", "escalate", "log_and_continue"];

const VALID_ESCALATION_BEHAVIORS: readonly EscalationBehavior[] = ["explicit_ticket", "halt_and_report", "log_only"];

// ============================================================================
// XML PARSER CONFIGURATION
// ============================================================================

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseAttributeValue: false, // Keep attributes as strings to preserve version formats like "1.0.0"
  parseTagValue: true,
  trimValues: true,
  isArray: (name) => {
    // Elements that should always be arrays
    return [
      "responsibility",
      "capability",
      "prohibition",
      "trigger",
      "scope"
    ].includes(name);
  }
});

// ============================================================================
// PARSING ERRORS
// ============================================================================

export class SystemInstructionParseError extends Error {
  constructor(
    message: string,
    public readonly role?: RoleType,
    public readonly field?: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "SystemInstructionParseError";
  }
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

function isValidRole(role: unknown): role is RoleType {
  return typeof role === "string" && VALID_ROLES.includes(role as RoleType);
}

function isValidCapability(cap: unknown): cap is CapabilityType {
  return typeof cap === "string" && VALID_CAPABILITIES.includes(cap as CapabilityType);
}

function isValidEscalationReason(reason: unknown): reason is EscalationReasonType {
  return typeof reason === "string" && VALID_ESCALATION_REASONS.includes(reason as EscalationReasonType);
}

function isValidSeverity(sev: unknown): sev is SeverityType {
  return typeof sev === "string" && VALID_SEVERITIES.includes(sev as SeverityType);
}

function isValidViolationAction(action: unknown): action is ViolationAction {
  return typeof action === "string" && VALID_VIOLATION_ACTIONS.includes(action as ViolationAction);
}

function isValidEscalationBehavior(behavior: unknown): behavior is EscalationBehavior {
  return typeof behavior === "string" && VALID_ESCALATION_BEHAVIORS.includes(behavior as EscalationBehavior);
}

function ensureArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "#text" in value) {
    return String((value as Record<string, unknown>)["#text"]);
  }
  return String(value ?? "");
}

// ============================================================================
// PARSING FUNCTIONS
// ============================================================================

/**
 * Parse purpose section from XML.
 */
function parsePurpose(raw: unknown, role: RoleType): SystemPurpose {
  if (!raw || typeof raw !== "object") {
    throw new SystemInstructionParseError("Missing or invalid purpose section", role, "purpose");
  }

  const obj = raw as Record<string, unknown>;

  const description = extractText(obj.description);
  if (!description) {
    throw new SystemInstructionParseError("Purpose description is required", role, "purpose.description");
  }

  const nature = extractText(obj.nature);
  if (!nature) {
    throw new SystemInstructionParseError("Purpose nature is required", role, "purpose.nature");
  }

  const responsibilitiesRaw = obj.responsibilities;
  if (!responsibilitiesRaw || typeof responsibilitiesRaw !== "object") {
    throw new SystemInstructionParseError("Purpose responsibilities are required", role, "purpose.responsibilities");
  }

  const respObj = responsibilitiesRaw as Record<string, unknown>;
  const responsibilities = ensureArray(respObj.responsibility).map(extractText).filter(Boolean);
  if (responsibilities.length === 0) {
    throw new SystemInstructionParseError("At least one responsibility is required", role, "purpose.responsibilities");
  }

  const result: SystemPurpose = {
    description,
    nature,
    responsibilities
  };

  // Parse allowed capabilities if present
  const allowedCapsRaw = obj.allowedCapabilities;
  if (allowedCapsRaw && typeof allowedCapsRaw === "object") {
    const capsObj = allowedCapsRaw as Record<string, unknown>;
    const caps = ensureArray(capsObj.capability).map(extractText).filter(Boolean);
    const validCaps: CapabilityType[] = [];

    for (const cap of caps) {
      if (isValidCapability(cap)) {
        validCaps.push(cap);
      } else {
        throw new SystemInstructionParseError(
          `Invalid capability: ${cap}`,
          role,
          "purpose.allowedCapabilities"
        );
      }
    }

    if (validCaps.length > 0) {
      result.allowedCapabilities = validCaps;
    }
  }

  return result;
}

/**
 * Parse prohibitions section from XML.
 */
function parseProhibitions(raw: unknown, role: RoleType): SystemProhibitions {
  if (!raw || typeof raw !== "object") {
    throw new SystemInstructionParseError("Missing or invalid prohibitions section", role, "prohibitions");
  }

  const obj = raw as Record<string, unknown>;
  const prohibitionItems = ensureArray(obj.prohibition);

  if (prohibitionItems.length === 0) {
    throw new SystemInstructionParseError("At least one prohibition is required", role, "prohibitions");
  }

  const prohibitions: SystemProhibition[] = [];

  for (const item of prohibitionItems) {
    if (!item || typeof item !== "object") continue;

    const p = item as Record<string, unknown>;
    const id = p["@_id"] ? String(p["@_id"]) : undefined;

    if (!id) {
      throw new SystemInstructionParseError("Prohibition id attribute is required", role, "prohibitions.prohibition");
    }

    const action = extractText(p.action);
    if (!action) {
      throw new SystemInstructionParseError(`Prohibition ${id} action is required`, role, `prohibitions.prohibition[${id}].action`);
    }

    const rationale = extractText(p.rationale);
    if (!rationale) {
      throw new SystemInstructionParseError(`Prohibition ${id} rationale is required`, role, `prohibitions.prohibition[${id}].rationale`);
    }

    const severityRaw = extractText(p.violationSeverity) || "critical";
    if (!isValidSeverity(severityRaw)) {
      throw new SystemInstructionParseError(
        `Invalid severity: ${severityRaw}`,
        role,
        `prohibitions.prohibition[${id}].violationSeverity`
      );
    }

    const onViolationRaw = extractText(p.onViolation) || "escalate";
    if (!isValidViolationAction(onViolationRaw)) {
      throw new SystemInstructionParseError(
        `Invalid violation action: ${onViolationRaw}`,
        role,
        `prohibitions.prohibition[${id}].onViolation`
      );
    }

    prohibitions.push({
      id,
      action,
      rationale,
      violationSeverity: severityRaw,
      onViolation: onViolationRaw
    });
  }

  return { prohibitions };
}

/**
 * Parse escalation rules section from XML.
 */
function parseEscalationRules(raw: unknown, role: RoleType): SystemEscalationRules {
  if (!raw || typeof raw !== "object") {
    throw new SystemInstructionParseError("Missing or invalid escalationRules section", role, "escalationRules");
  }

  const obj = raw as Record<string, unknown>;

  const canEscalate = obj.canEscalate !== false && obj.canEscalate !== "false";
  const canApproveEscalation = obj.canApproveEscalation === true || obj.canApproveEscalation === "true";

  const behaviorRaw = extractText(obj.escalationBehavior) || "explicit_ticket";
  if (!isValidEscalationBehavior(behaviorRaw)) {
    throw new SystemInstructionParseError(
      `Invalid escalation behavior: ${behaviorRaw}`,
      role,
      "escalationRules.escalationBehavior"
    );
  }

  const result: SystemEscalationRules = {
    canEscalate,
    canApproveEscalation,
    escalationBehavior: behaviorRaw
  };

  // Parse triggers if present
  const triggersRaw = obj.escalationTriggers;
  if (triggersRaw && typeof triggersRaw === "object") {
    const triggersObj = triggersRaw as Record<string, unknown>;
    const triggerItems = ensureArray(triggersObj.trigger);

    if (triggerItems.length > 0) {
      const triggers: EscalationTrigger[] = [];

      for (const item of triggerItems) {
        if (!item || typeof item !== "object") continue;

        const t = item as Record<string, unknown>;
        const reason = extractText(t.reason);

        if (!isValidEscalationReason(reason)) {
          throw new SystemInstructionParseError(
            `Invalid escalation reason: ${reason}`,
            role,
            "escalationRules.escalationTriggers.trigger.reason"
          );
        }

        const description = extractText(t.description);
        const autoEscalate = t.autoEscalate === true || t.autoEscalate === "true";

        triggers.push({
          reason,
          description,
          autoEscalate
        });
      }

      if (triggers.length > 0) {
        result.escalationTriggers = triggers;
      }
    }
  }

  return result;
}

/**
 * Parse memory rules section from XML.
 */
function parseMemoryRules(raw: unknown, role: RoleType): SystemMemoryRules {
  if (!raw || typeof raw !== "object") {
    throw new SystemInstructionParseError("Missing or invalid memoryRules section", role, "memoryRules");
  }

  const obj = raw as Record<string, unknown>;

  const canRead = obj.canRead !== false && obj.canRead !== "false";
  const canWrite = obj.canWrite === true || obj.canWrite === "true";
  const canValidate = obj.canValidate === true || obj.canValidate === "true";
  const advisoryOnly = obj.advisoryOnly !== false && obj.advisoryOnly !== "false";

  const result: SystemMemoryRules = {
    canRead,
    canWrite,
    canValidate,
    advisoryOnly
  };

  // Parse scope priority if present
  const scopePriorityRaw = obj.scopePriority;
  if (scopePriorityRaw && typeof scopePriorityRaw === "object") {
    const scopeObj = scopePriorityRaw as Record<string, unknown>;
    const scopeItems = ensureArray(scopeObj.scope);

    if (scopeItems.length > 0) {
      const scopePriority: MemoryScopePriority[] = [];

      for (const item of scopeItems) {
        if (!item || typeof item !== "object") continue;

        const s = item as Record<string, unknown>;
        const scope = extractText(s["#text"]) || extractText(s);
        const weightRaw = s["@_weight"];
        const weight = typeof weightRaw === "number" ? weightRaw : parseFloat(String(weightRaw));

        if (scope && !isNaN(weight)) {
          scopePriority.push({ scope, weight });
        }
      }

      if (scopePriority.length > 0) {
        result.scopePriority = scopePriority;
      }
    }
  }

  return result;
}

// ============================================================================
// MAIN PARSING FUNCTION
// ============================================================================

/**
 * Parse a system instruction XML string into a typed SystemInstruction object.
 *
 * @param xmlContent - Raw XML string
 * @returns Parsed and validated SystemInstruction
 * @throws SystemInstructionParseError on invalid structure
 */
export function parseSystemInstructionXml(xmlContent: string): SystemInstruction {
  let parsed: Record<string, unknown>;

  try {
    parsed = parser.parse(xmlContent) as Record<string, unknown>;
  } catch (err) {
    throw new SystemInstructionParseError(
      `XML parsing failed: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      undefined,
      err
    );
  }

  const root = parsed.systemInstruction;
  if (!root || typeof root !== "object") {
    throw new SystemInstructionParseError("Missing <systemInstruction> root element");
  }

  const obj = root as Record<string, unknown>;

  // Extract attributes
  const role = obj["@_role"];
  if (!isValidRole(role)) {
    throw new SystemInstructionParseError(`Invalid or missing role attribute: ${role}`);
  }

  const version = obj["@_version"];
  if (!version || typeof version !== "string") {
    throw new SystemInstructionParseError("Missing or invalid version attribute", role);
  }

  const schemaVersion = obj["@_schemaVersion"];
  if (!schemaVersion || typeof schemaVersion !== "string") {
    throw new SystemInstructionParseError("Missing or invalid schemaVersion attribute", role);
  }

  // Parse sections
  const purpose = parsePurpose(obj.purpose, role);
  const prohibitions = parseProhibitions(obj.prohibitions, role);
  const escalationRules = parseEscalationRules(obj.escalationRules, role);
  const memoryRules = parseMemoryRules(obj.memoryRules, role);

  // Acknowledgement required (default true)
  const acknowledgementRequired = obj.acknowledgementRequired !== false && obj.acknowledgementRequired !== "false";

  return {
    role,
    version,
    schemaVersion,
    purpose,
    prohibitions,
    escalationRules,
    memoryRules,
    acknowledgementRequired
  };
}

/**
 * Validate that a SystemInstruction matches expected role constraints.
 *
 * @param instruction - Parsed instruction
 * @param expectedRole - Role this instruction should be for
 * @returns true if valid, throws on mismatch
 */
export function validateSystemInstruction(instruction: SystemInstruction, expectedRole: RoleType): boolean {
  if (instruction.role !== expectedRole) {
    throw new SystemInstructionParseError(
      `Role mismatch: expected ${expectedRole}, got ${instruction.role}`,
      instruction.role
    );
  }

  // Validate role-specific constraints
  switch (expectedRole) {
    case "supervisor":
      // Supervisor can approve escalations
      if (!instruction.escalationRules.canApproveEscalation) {
        throw new SystemInstructionParseError(
          "Supervisor must have canApproveEscalation=true",
          expectedRole
        );
      }
      // Supervisor cannot write memory
      if (instruction.memoryRules.canWrite) {
        throw new SystemInstructionParseError(
          "Supervisor cannot have canWrite=true",
          expectedRole
        );
      }
      break;

    case "planner":
      // Planner cannot write memory
      if (instruction.memoryRules.canWrite) {
        throw new SystemInstructionParseError(
          "Planner cannot have canWrite=true",
          expectedRole
        );
      }
      // Planner cannot approve escalations
      if (instruction.escalationRules.canApproveEscalation) {
        throw new SystemInstructionParseError(
          "Planner cannot have canApproveEscalation=true",
          expectedRole
        );
      }
      break;

    case "specialist":
      // Specialist cannot approve escalations
      if (instruction.escalationRules.canApproveEscalation) {
        throw new SystemInstructionParseError(
          "Specialist cannot have canApproveEscalation=true",
          expectedRole
        );
      }
      // Specialist cannot validate memory (only verifier can)
      if (instruction.memoryRules.canValidate) {
        throw new SystemInstructionParseError(
          "Specialist cannot have canValidate=true",
          expectedRole
        );
      }
      break;

    case "verifier":
      // Verifier cannot write memory
      if (instruction.memoryRules.canWrite) {
        throw new SystemInstructionParseError(
          "Verifier cannot have canWrite=true",
          expectedRole
        );
      }
      // Verifier cannot approve escalations
      if (instruction.escalationRules.canApproveEscalation) {
        throw new SystemInstructionParseError(
          "Verifier cannot have canApproveEscalation=true",
          expectedRole
        );
      }
      // Verifier CAN validate memory (unique to this role)
      if (!instruction.memoryRules.canValidate) {
        throw new SystemInstructionParseError(
          "Verifier must have canValidate=true",
          expectedRole
        );
      }
      break;
  }

  return true;
}
