/**
 * XSD-Based Skill Validator (Phase 1.3)
 *
 * Validates skills.xml files against the skills-schema.xsd specification.
 * This is a programmatic validator that implements the XSD constraints
 * without requiring external XML validation libraries.
 *
 * ARCHITECTURE GUARDRAILS:
 * - Fail fast on invalid structure
 * - Report specific validation errors with context
 * - No silent degradation
 *
 * @see info-instructions/skills-schema.xsd
 */

import type {
  RoleType,
  CapabilityType,
  EscalationReasonType,
  LikuSkill
} from "./types.js";
import {
  VALID_ROLES as ROLE_TYPES,
  VALID_CAPABILITIES as CAPABILITY_TYPES,
  VALID_ESCALATION_REASONS as ESCALATION_REASON_TYPES,
  isValidRole as isRoleType,
  isValidCapability as isCapabilityType,
  isValidEscalationReason as isEscalationReasonType
} from "./types.js";

// ============================================================================
// VALIDATION ERROR TYPES
// ============================================================================

/**
 * Severity of a validation error.
 */
export type ValidationSeverity = "error" | "warning";

/**
 * A validation error or warning.
 */
export interface ValidationError {
  /** Severity level */
  readonly severity: ValidationSeverity;

  /** Error code for programmatic handling */
  readonly code: XsdValidationErrorCode;

  /** Human-readable error message */
  readonly message: string;

  /** Path to the element with the error (e.g., "skills[0].allowedRoles") */
  readonly path: string;

  /** The actual value that caused the error */
  readonly value?: unknown;

  /** Expected values or constraints */
  readonly expected?: string;
}

/**
 * Error codes for XSD validation.
 */
export type XsdValidationErrorCode =
  | "MISSING_REQUIRED_ATTRIBUTE"
  | "MISSING_REQUIRED_ELEMENT"
  | "INVALID_ROLE"
  | "INVALID_CAPABILITY"
  | "INVALID_ESCALATION_REASON"
  | "INVALID_TYPE"
  | "EMPTY_COLLECTION"
  | "DUPLICATE_ID"
  | "CIRCULAR_EXTENDS"
  | "UNKNOWN_EXTENDS"
  | "SCHEMA_VERSION_MISMATCH"
  | "INVALID_STRUCTURE";

/**
 * Result of XSD validation.
 */
export interface XsdValidationResult {
  /** Whether validation passed (no errors, warnings allowed) */
  readonly valid: boolean;

  /** All validation errors (severity: error) */
  readonly errors: readonly ValidationError[];

  /** All validation warnings (severity: warning) */
  readonly warnings: readonly ValidationError[];

  /** Schema version detected */
  readonly schemaVersion?: string;

  /** Number of skills validated */
  readonly skillCount: number;
}

// ============================================================================
// RAW PARSED SKILL STRUCTURE
// ============================================================================

/**
 * Raw parsed skill from XML (before validation).
 * This represents what fast-xml-parser might return.
 */
export interface RawParsedSkill {
  "@_id"?: string;
  "@_version"?: string;
  description?: string | { "#text": string };
  extends?: string | { "#text": string };
  allowedRoles?: {
    role?: string | string[] | { "#text": string }[];
  };
  requiredCapabilities?: {
    capability?: string | string[] | { "#text": string }[];
  };
  allowedTools?: {
    tool?: string | string[] | { "#text": string }[];
  };
  escalationPolicy?: {
    on?: string | string[] | { "#text": string }[];
  };
  memoryAccess?: {
    "@_read"?: string | boolean;
    "@_write"?: string | boolean;
  };
}

/**
 * Raw parsed skills root from XML.
 */
export interface RawParsedSkills {
  "@_schemaVersion"?: string;
  skill?: RawParsedSkill | RawParsedSkill[];
}

// ============================================================================
// VALIDATOR CLASS
// ============================================================================

/**
 * XSD-based skill validator.
 *
 * Validates parsed XML against the skills-schema.xsd specification.
 */
export class XsdSkillValidator {
  private errors: ValidationError[] = [];
  private warnings: ValidationError[] = [];
  private seenIds = new Set<string>();
  private skillsById = new Map<string, RawParsedSkill>();

  /**
   * Current supported schema version.
   */
  static readonly SUPPORTED_SCHEMA_VERSION = "1.0";

  /**
   * Validate a parsed skills document.
   *
   * @param parsed - Raw parsed XML from fast-xml-parser
   * @returns Validation result
   */
  validate(parsed: RawParsedSkills | undefined): XsdValidationResult {
    // Reset state
    this.errors = [];
    this.warnings = [];
    this.seenIds.clear();
    this.skillsById.clear();

    if (!parsed) {
      this.addError("INVALID_STRUCTURE", "skills", "Parsed skills document is undefined");
      return this.buildResult(undefined, 0);
    }

    // Validate schema version
    const schemaVersion = parsed["@_schemaVersion"];
    if (!schemaVersion) {
      this.addError(
        "MISSING_REQUIRED_ATTRIBUTE",
        "skills",
        "Missing required attribute: schemaVersion",
        undefined,
        "schemaVersion attribute"
      );
    } else if (schemaVersion !== XsdSkillValidator.SUPPORTED_SCHEMA_VERSION) {
      this.addWarning(
        "SCHEMA_VERSION_MISMATCH",
        "skills",
        `Schema version "${schemaVersion}" may not be fully supported. Expected: ${XsdSkillValidator.SUPPORTED_SCHEMA_VERSION}`,
        schemaVersion,
        XsdSkillValidator.SUPPORTED_SCHEMA_VERSION
      );
    }

    // Normalize skills to array
    const rawSkills = this.normalizeToArray(parsed.skill);
    if (rawSkills.length === 0) {
      this.addWarning(
        "EMPTY_COLLECTION",
        "skills",
        "No skills defined in document"
      );
    }

    // First pass: collect all skill IDs for extends validation
    for (const skill of rawSkills) {
      const id = skill["@_id"];
      if (id) {
        this.skillsById.set(id, skill);
      }
    }

    // Second pass: validate each skill
    for (let i = 0; i < rawSkills.length; i++) {
      const rawSkill = rawSkills[i];
      if (rawSkill) {
        this.validateSkill(rawSkill, `skills.skill[${i}]`);
      }
    }

    // Third pass: check for circular extends
    for (const skill of rawSkills) {
      const id = skill["@_id"];
      if (id) {
        this.checkCircularExtends(id, `skills.skill[${this.getSkillIndex(rawSkills, id)}]`);
      }
    }

    return this.buildResult(schemaVersion, rawSkills.length);
  }

  /**
   * Validate a LikuSkill object directly (post-parse validation).
   *
   * @param skill - Parsed LikuSkill object
   * @param path - Path for error reporting
   */
  validateLikuSkill(skill: LikuSkill, path: string = "skill"): ValidationError[] {
    this.errors = [];
    this.warnings = [];

    // Required: id
    if (!skill.id || skill.id.trim() === "") {
      this.addError("MISSING_REQUIRED_ATTRIBUTE", path, "Skill id is required and cannot be empty");
    }

    // Required: version
    if (!skill.version || skill.version.trim() === "") {
      this.addError("MISSING_REQUIRED_ATTRIBUTE", path, "Skill version is required and cannot be empty");
    }

    // Required: description
    if (!skill.description || skill.description.trim() === "") {
      this.addError("MISSING_REQUIRED_ELEMENT", path, "Skill description is required and cannot be empty");
    }

    // Required: allowedRoles (must have at least one)
    if (!skill.allowedRoles || skill.allowedRoles.length === 0) {
      this.addError("EMPTY_COLLECTION", `${path}.allowedRoles`, "At least one allowed role is required");
    } else {
      for (const role of skill.allowedRoles) {
        if (!isRoleType(role)) {
          this.addError(
            "INVALID_ROLE",
            `${path}.allowedRoles`,
            `Invalid role: "${role}"`,
            role,
            ROLE_TYPES.join(", ")
          );
        }
      }
    }

    // Required: requiredCapabilities (can be empty array, but must exist)
    if (skill.requiredCapabilities) {
      for (const cap of skill.requiredCapabilities) {
        if (!isCapabilityType(cap)) {
          this.addError(
            "INVALID_CAPABILITY",
            `${path}.requiredCapabilities`,
            `Invalid capability: "${cap}"`,
            cap,
            CAPABILITY_TYPES.join(", ")
          );
        }
      }
    }

    // Optional: escalationPolicy
    if (skill.escalationPolicy?.on) {
      for (const reason of skill.escalationPolicy.on) {
        if (!isEscalationReasonType(reason)) {
          this.addError(
            "INVALID_ESCALATION_REASON",
            `${path}.escalationPolicy.reasons`,
            `Invalid escalation reason: "${reason}"`,
            reason,
            ESCALATION_REASON_TYPES.join(", ")
          );
        }
      }
    }

    return this.errors;
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  private validateSkill(skill: RawParsedSkill, path: string): void {
    // Required: id attribute
    const id = skill["@_id"];
    if (!id || id.trim() === "") {
      this.addError("MISSING_REQUIRED_ATTRIBUTE", path, "Skill id is required", id, "non-empty string");
    } else {
      // Check for duplicate IDs
      if (this.seenIds.has(id)) {
        this.addError("DUPLICATE_ID", path, `Duplicate skill id: "${id}"`, id);
      }
      this.seenIds.add(id);
    }

    // Required: version attribute
    const version = skill["@_version"];
    if (!version || version.trim() === "") {
      this.addError("MISSING_REQUIRED_ATTRIBUTE", path, "Skill version is required", version, "non-empty string");
    }

    // Required: description element
    const description = this.extractText(skill.description);
    if (!description || description.trim() === "") {
      this.addError("MISSING_REQUIRED_ELEMENT", path, "Skill description is required", description, "non-empty string");
    }

    // Optional: extends element (validate reference exists)
    const extendsSkill = this.extractText(skill.extends);
    if (extendsSkill && extendsSkill.trim() !== "") {
      if (!this.skillsById.has(extendsSkill) && !this.seenIds.has(extendsSkill)) {
        this.addWarning(
          "UNKNOWN_EXTENDS",
          `${path}.extends`,
          `Skill extends unknown skill: "${extendsSkill}"`,
          extendsSkill
        );
      }
    }

    // Required: allowedRoles element with at least one role
    this.validateAllowedRoles(skill.allowedRoles, `${path}.allowedRoles`);

    // Required: requiredCapabilities element (can be empty but must exist structurally)
    this.validateRequiredCapabilities(skill.requiredCapabilities, `${path}.requiredCapabilities`);

    // Optional: allowedTools
    if (skill.allowedTools) {
      this.validateAllowedTools(skill.allowedTools, `${path}.allowedTools`);
    }

    // Optional: escalationPolicy
    if (skill.escalationPolicy) {
      this.validateEscalationPolicy(skill.escalationPolicy, `${path}.escalationPolicy`);
    }

    // Optional: memoryAccess (attributes are booleans)
    if (skill.memoryAccess) {
      this.validateMemoryAccess(skill.memoryAccess, `${path}.memoryAccess`);
    }
  }

  private validateAllowedRoles(
    allowedRoles: RawParsedSkill["allowedRoles"],
    path: string
  ): void {
    if (!allowedRoles) {
      this.addError("MISSING_REQUIRED_ELEMENT", path, "allowedRoles element is required");
      return;
    }

    const roles = this.normalizeStringArray(allowedRoles.role);
    if (roles.length === 0) {
      this.addError("EMPTY_COLLECTION", path, "At least one role is required in allowedRoles");
      return;
    }

    for (const role of roles) {
      if (!isRoleType(role)) {
        this.addError(
          "INVALID_ROLE",
          `${path}.role`,
          `Invalid role value: "${role}"`,
          role,
          ROLE_TYPES.join(", ")
        );
      }
    }
  }

  private validateRequiredCapabilities(
    requiredCapabilities: RawParsedSkill["requiredCapabilities"],
    path: string
  ): void {
    if (!requiredCapabilities) {
      this.addError("MISSING_REQUIRED_ELEMENT", path, "requiredCapabilities element is required");
      return;
    }

    const capabilities = this.normalizeStringArray(requiredCapabilities.capability);
    // Empty is allowed, just validate the ones present
    for (const cap of capabilities) {
      if (!isCapabilityType(cap)) {
        this.addError(
          "INVALID_CAPABILITY",
          `${path}.capability`,
          `Invalid capability value: "${cap}"`,
          cap,
          CAPABILITY_TYPES.join(", ")
        );
      }
    }
  }

  private validateAllowedTools(
    allowedTools: NonNullable<RawParsedSkill["allowedTools"]>,
    path: string
  ): void {
    const tools = this.normalizeStringArray(allowedTools.tool);
    // Tools can be any string, just ensure they're non-empty
    for (let i = 0; i < tools.length; i++) {
      const tool = tools[i];
      if (tool && tool.trim() === "") {
        this.addWarning(
          "INVALID_TYPE",
          `${path}.tool[${i}]`,
          "Empty tool name is not recommended"
        );
      }
    }
  }

  private validateEscalationPolicy(
    escalationPolicy: NonNullable<RawParsedSkill["escalationPolicy"]>,
    path: string
  ): void {
    const reasons = this.normalizeStringArray(escalationPolicy.on);
    if (reasons.length === 0) {
      this.addWarning("EMPTY_COLLECTION", path, "Escalation policy has no reasons defined");
      return;
    }

    for (const reason of reasons) {
      if (!isEscalationReasonType(reason)) {
        this.addError(
          "INVALID_ESCALATION_REASON",
          `${path}.on`,
          `Invalid escalation reason: "${reason}"`,
          reason,
          ESCALATION_REASON_TYPES.join(", ")
        );
      }
    }
  }

  private validateMemoryAccess(
    memoryAccess: NonNullable<RawParsedSkill["memoryAccess"]>,
    path: string
  ): void {
    // Attributes should be booleans or "true"/"false" strings
    const read = memoryAccess["@_read"];
    if (read !== undefined && !this.isBooleany(read)) {
      this.addError(
        "INVALID_TYPE",
        `${path}/@read`,
        `Invalid boolean value for read: "${read}"`,
        read,
        "true or false"
      );
    }

    const write = memoryAccess["@_write"];
    if (write !== undefined && !this.isBooleany(write)) {
      this.addError(
        "INVALID_TYPE",
        `${path}/@write`,
        `Invalid boolean value for write: "${write}"`,
        write,
        "true or false"
      );
    }
  }

  private checkCircularExtends(skillId: string, path: string): void {
    const visited = new Set<string>();
    let current: string | undefined = skillId;

    while (current) {
      if (visited.has(current)) {
        this.addError(
          "CIRCULAR_EXTENDS",
          path,
          `Circular extends detected: ${Array.from(visited).join(" -> ")} -> ${current}`,
          skillId
        );
        return;
      }

      visited.add(current);
      const skill = this.skillsById.get(current);
      current = skill ? this.extractText(skill.extends) : undefined;
    }
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  private normalizeToArray<T>(value: T | T[] | undefined): T[] {
    if (value === undefined) return [];
    return Array.isArray(value) ? value : [value];
  }

  private normalizeStringArray(value: string | string[] | { "#text": string }[] | undefined): string[] {
    if (value === undefined) return [];
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) {
      return value.map(v => typeof v === "string" ? v : v["#text"] ?? "");
    }
    return [];
  }

  private extractText(value: string | { "#text": string } | undefined): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value === "string") return value;
    return value["#text"];
  }

  private isBooleany(value: unknown): boolean {
    if (typeof value === "boolean") return true;
    if (typeof value === "string") {
      return value === "true" || value === "false";
    }
    return false;
  }

  private getSkillIndex(skills: RawParsedSkill[], id: string): number {
    return skills.findIndex(s => s["@_id"] === id);
  }

  private addError(
    code: XsdValidationErrorCode,
    path: string,
    message: string,
    value?: unknown,
    expected?: string
  ): void {
    const error: ValidationError = {
      severity: "error",
      code,
      message,
      path,
      value
    };
    if (expected !== undefined) {
      (error as { expected?: string }).expected = expected;
    }
    this.errors.push(error);
  }

  private addWarning(
    code: XsdValidationErrorCode,
    path: string,
    message: string,
    value?: unknown,
    expected?: string
  ): void {
    const warning: ValidationError = {
      severity: "warning",
      code,
      message,
      path,
      value
    };
    if (expected !== undefined) {
      (warning as { expected?: string }).expected = expected;
    }
    this.warnings.push(warning);
  }

  private buildResult(schemaVersion: string | undefined, skillCount: number): XsdValidationResult {
    const result: XsdValidationResult = {
      valid: this.errors.length === 0,
      errors: [...this.errors],
      warnings: [...this.warnings],
      skillCount
    };
    if (schemaVersion !== undefined) {
      (result as { schemaVersion?: string }).schemaVersion = schemaVersion;
    }
    return result;
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Validate parsed skills against XSD schema.
 *
 * @param parsed - Raw parsed XML from fast-xml-parser
 * @returns Validation result
 */
export function validateSkillsXsd(parsed: RawParsedSkills | undefined): XsdValidationResult {
  const validator = new XsdSkillValidator();
  return validator.validate(parsed);
}

/**
 * Validate a single LikuSkill object.
 *
 * @param skill - Parsed LikuSkill
 * @returns Array of validation errors (empty if valid)
 */
export function validateLikuSkillXsd(skill: LikuSkill): ValidationError[] {
  const validator = new XsdSkillValidator();
  return validator.validateLikuSkill(skill);
}

/**
 * Format validation errors for display.
 *
 * @param result - Validation result
 * @returns Formatted string
 */
export function formatValidationResult(result: XsdValidationResult): string {
  const lines: string[] = [];

  lines.push(`XSD Validation ${result.valid ? "PASSED" : "FAILED"}`);
  lines.push(`Schema Version: ${result.schemaVersion ?? "unknown"}`);
  lines.push(`Skills Validated: ${result.skillCount}`);
  lines.push("");

  if (result.errors.length > 0) {
    lines.push(`Errors (${result.errors.length}):`);
    for (const err of result.errors) {
      lines.push(`  [${err.code}] ${err.path}: ${err.message}`);
      if (err.expected) {
        lines.push(`    Expected: ${err.expected}`);
      }
    }
    lines.push("");
  }

  if (result.warnings.length > 0) {
    lines.push(`Warnings (${result.warnings.length}):`);
    for (const warn of result.warnings) {
      lines.push(`  [${warn.code}] ${warn.path}: ${warn.message}`);
    }
  }

  return lines.join("\n");
}
