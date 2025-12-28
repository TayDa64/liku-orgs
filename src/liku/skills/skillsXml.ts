import fs from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import type { 
  LikuSkill, 
  Privilege, 
  CapabilityType, 
  RoleType,
  EscalationReasonType,
  MemoryAccess,
  EscalationPolicy
} from "./types.js";
import { 
  isValidCapability, 
  isValidRole, 
  isValidEscalationReason 
} from "./types.js";

// =============================================================================
// PARSED XML TYPES (from fast-xml-parser)
// =============================================================================

type ParsedRole = {
  "#text"?: string;
} | string;

type ParsedCapability = {
  "#text"?: string;
} | string;

type ParsedTool = {
  "#text"?: string;
} | string;

type ParsedEscalationOn = {
  "#text"?: string;
} | string;

type ParsedAllowedRoles = {
  role?: ParsedRole | ParsedRole[];
};

type ParsedRequiredCapabilities = {
  capability?: ParsedCapability | ParsedCapability[];
};

type ParsedAllowedTools = {
  tool?: ParsedTool | ParsedTool[];
};

type ParsedEscalationPolicy = {
  on?: ParsedEscalationOn | ParsedEscalationOn[];
};

type ParsedMemoryAccess = {
  read?: string | boolean;
  write?: string | boolean;
};

type ParsedSkill = {
  // Attributes
  id?: string;
  version?: string;
  
  // Elements
  description?: string | { "#text"?: string };
  extends?: string | { "#text"?: string };
  allowedRoles?: ParsedAllowedRoles;
  requiredCapabilities?: ParsedRequiredCapabilities;
  allowedTools?: ParsedAllowedTools;
  escalationPolicy?: ParsedEscalationPolicy;
  memoryAccess?: ParsedMemoryAccess;
  
  // Legacy attributes (backward compatibility)
  privilege?: Privilege;
  requires?: string;
  escalateIfMissing?: string | boolean;
};

type ParsedSkillsDoc = {
  skills?: {
    schemaVersion?: string;
    skill?: ParsedSkill[] | ParsedSkill;
  };
};

// =============================================================================
// PARSER CONFIGURATION
// =============================================================================

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  allowBooleanAttributes: true,
  trimValues: true,
  // Handle text content in elements
  textNodeName: "#text"
});

// =============================================================================
// NORMALIZATION HELPERS
// =============================================================================

function normalizePrivilege(raw: unknown): Privilege {
  if (raw === "root" || raw === "specialist" || raw === "user") return raw;
  return "user";
}

function normalizeBoolean(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  if (raw === "true" || raw === "1") return true;
  return false;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function extractText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && "#text" in value) {
    const text = (value as { "#text"?: string })["#text"];
    return typeof text === "string" ? text.trim() : undefined;
  }
  return undefined;
}

function parseRoles(parsed: ParsedAllowedRoles | undefined): RoleType[] {
  if (!parsed?.role) return [];
  const roles = toArray(parsed.role);
  return roles
    .map(r => extractText(r))
    .filter((r): r is string => r !== undefined)
    .filter(isValidRole);
}

function parseCapabilities(parsed: ParsedRequiredCapabilities | undefined): CapabilityType[] {
  if (!parsed?.capability) return [];
  const caps = toArray(parsed.capability);
  return caps
    .map(c => extractText(c))
    .filter((c): c is string => c !== undefined)
    .filter(isValidCapability);
}

function parseTools(parsed: ParsedAllowedTools | undefined): string[] {
  if (!parsed?.tool) return [];
  const tools = toArray(parsed.tool);
  return tools
    .map(t => extractText(t))
    .filter((t): t is string => t !== undefined && t.length > 0);
}

function parseEscalationPolicy(parsed: ParsedEscalationPolicy | undefined): EscalationPolicy | undefined {
  if (!parsed?.on) return undefined;
  const reasons = toArray(parsed.on);
  const validReasons = reasons
    .map(r => extractText(r))
    .filter((r): r is string => r !== undefined)
    .filter(isValidEscalationReason);
  
  if (validReasons.length === 0) return undefined;
  return { on: validReasons };
}

function parseMemoryAccess(parsed: ParsedMemoryAccess | undefined): MemoryAccess | undefined {
  if (!parsed) return undefined;
  const read = normalizeBoolean(parsed.read);
  const write = normalizeBoolean(parsed.write);
  // Only return if at least one is true (matches XSD default="false")
  if (!read && !write) return undefined;
  return { read, write };
}

function normalizeLegacyCapability(raw: unknown): CapabilityType | undefined {
  if (typeof raw === "string" && isValidCapability(raw)) {
    return raw;
  }
  return undefined;
}

// =============================================================================
// SKILL LOADING
// =============================================================================

/**
 * Load skills from a skills.xml file.
 * Supports both XSD-compliant format and legacy format for backward compatibility.
 */
export function loadSkillsXml(skillsXmlPath: string, residencePath: string): LikuSkill[] {
  if (!fs.existsSync(skillsXmlPath)) return [];
  const xml = fs.readFileSync(skillsXmlPath, "utf8");
  const doc = parser.parse(xml) as ParsedSkillsDoc;

  const skills = toArray(doc.skills?.skill).flatMap((raw): LikuSkill[] => {
    const id = raw.id?.trim();
    if (!id) return [];
    
    // Build skill with XSD fields
    const skill: LikuSkill = {
      id,
      residencePath,
      requiredPrivilege: normalizePrivilege(raw.privilege)
    };
    
    // Version (XSD: required attribute)
    if (raw.version) {
      skill.version = raw.version.trim();
    }
    
    // Description (XSD: element)
    const description = extractText(raw.description);
    if (description) {
      skill.description = description;
    }
    
    // Extends (XSD: optional element for hierarchy)
    const extendsId = extractText(raw.extends);
    if (extendsId) {
      skill.extends = extendsId;
    }
    
    // Allowed Roles (XSD: allowedRoles/role[])
    const allowedRoles = parseRoles(raw.allowedRoles);
    if (allowedRoles.length > 0) {
      skill.allowedRoles = allowedRoles;
    }
    
    // Required Capabilities (XSD: requiredCapabilities/capability[])
    const requiredCapabilities = parseCapabilities(raw.requiredCapabilities);
    if (requiredCapabilities.length > 0) {
      skill.requiredCapabilities = requiredCapabilities;
    }
    
    // Allowed Tools (XSD: allowedTools/tool[])
    const allowedTools = parseTools(raw.allowedTools);
    if (allowedTools.length > 0) {
      skill.allowedTools = allowedTools;
    }
    
    // Escalation Policy (XSD: escalationPolicy/on[])
    const escalationPolicy = parseEscalationPolicy(raw.escalationPolicy);
    if (escalationPolicy) {
      skill.escalationPolicy = escalationPolicy;
    }
    
    // Memory Access (XSD: memoryAccess with read/write attributes)
    const memoryAccess = parseMemoryAccess(raw.memoryAccess);
    if (memoryAccess) {
      skill.memoryAccess = memoryAccess;
    }
    
    // --- Legacy fields for backward compatibility ---
    
    // Legacy: requires (single capability)
    const requires = normalizeLegacyCapability(raw.requires);
    if (requires) {
      skill.requires = requires;
      // Also add to requiredCapabilities if not already present
      if (!skill.requiredCapabilities) {
        skill.requiredCapabilities = [requires];
      } else if (!skill.requiredCapabilities.includes(requires)) {
        skill.requiredCapabilities.push(requires);
      }
    }
    
    // Legacy: escalateIfMissing
    const escalateIfMissing = normalizeBoolean(raw.escalateIfMissing);
    if (escalateIfMissing) {
      skill.escalateIfMissing = escalateIfMissing;
      // Also create escalationPolicy if not present
      if (!skill.escalationPolicy) {
        skill.escalationPolicy = { on: ["missing_capability"] };
      }
    }
    
    return [skill];
  });

  return skills;
}

/**
 * Find all skills.xml files from a directory up to the Liku root.
 * Returns files in order from leaf to root (child files first).
 */
export function findSkillsXmlFiles(fromDir: string, stopAtDir: string): string[] {
  const files: string[] = [];
  let current = path.resolve(fromDir);
  const stop = path.resolve(stopAtDir);

  // Include fromDir, then walk up to stopAtDir (inclusive).
  // Example: Liku/specialist/ts/specific/sprint-001 -> ... -> Liku
  while (true) {
    const candidate = path.join(current, "skills.xml");
    if (fs.existsSync(candidate)) files.push(candidate);
    if (current === stop) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return files;
}

/**
 * Get the schema version from a skills.xml file.
 */
export function getSchemaVersion(skillsXmlPath: string): string | undefined {
  if (!fs.existsSync(skillsXmlPath)) return undefined;
  const xml = fs.readFileSync(skillsXmlPath, "utf8");
  const doc = parser.parse(xml) as ParsedSkillsDoc;
  return doc.skills?.schemaVersion;
}

