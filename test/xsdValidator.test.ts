/**
 * Tests for XSD-Based Skill Validator (Phase 1.3)
 *
 * Covers:
 * - Valid skill passes validation
 * - Invalid role fails validation
 * - Missing required attributes fails
 * - Circular extends detection
 * - Unknown capability rejection
 * - Duplicate ID detection
 * - Schema version handling
 */

import { describe, it, expect } from "vitest";
import {
  XsdSkillValidator,
  validateSkillsXsd,
  validateLikuSkillXsd,
  formatValidationResult,
  type RawParsedSkill,
  type RawParsedSkills,
  type ValidationError
} from "../src/liku/skills/xsdValidator.js";
import type { LikuSkill } from "../src/liku/skills/types.js";

// ============================================================================
// TEST FIXTURES
// ============================================================================

function createValidRawSkill(overrides: Partial<RawParsedSkill> = {}): RawParsedSkill {
  return {
    "@_id": "test-skill",
    "@_version": "1.0.0",
    description: "A test skill",
    allowedRoles: {
      role: ["specialist"]
    },
    requiredCapabilities: {
      capability: ["read_repo"]
    },
    ...overrides
  };
}

function createValidRawSkills(skills: RawParsedSkill[] = [createValidRawSkill()]): RawParsedSkills {
  return {
    "@_schemaVersion": "1.0",
    skill: skills
  };
}

function createValidLikuSkill(overrides: Partial<LikuSkill> = {}): LikuSkill {
  return {
    id: "test-skill",
    version: "1.0.0",
    description: "A test skill",
    allowedRoles: ["specialist"],
    requiredCapabilities: ["read_repo"],
    ...overrides
  } as LikuSkill;
}

// ============================================================================
// VALID SKILLS TESTS
// ============================================================================

describe("XSD Validator - Valid Skills", () => {
  it("validates a minimal valid skill", () => {
    const result = validateSkillsXsd(createValidRawSkills());

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.schemaVersion).toBe("1.0");
    expect(result.skillCount).toBe(1);
  });

  it("validates a skill with all optional elements", () => {
    const skill = createValidRawSkill({
      extends: "base-skill",
      allowedTools: {
        tool: ["file_read", "file_write"]
      },
      escalationPolicy: {
        on: ["missing_capability", "ambiguous_requirement"]
      },
      memoryAccess: {
        "@_read": "true",
        "@_write": "false"
      }
    });

    // Add base-skill to avoid unknown extends warning
    const skills = createValidRawSkills([
      createValidRawSkill({ "@_id": "base-skill" }),
      skill
    ]);

    const result = validateSkillsXsd(skills);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.skillCount).toBe(2);
  });

  it("validates multiple roles", () => {
    const skill = createValidRawSkill({
      allowedRoles: {
        role: ["specialist", "verifier"]
      }
    });

    const result = validateSkillsXsd(createValidRawSkills([skill]));

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("validates multiple capabilities", () => {
    const skill = createValidRawSkill({
      requiredCapabilities: {
        capability: ["read_repo", "write_repo", "execute_code"]
      }
    });

    const result = validateSkillsXsd(createValidRawSkills([skill]));

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("validates all role types", () => {
    const skill = createValidRawSkill({
      allowedRoles: {
        role: ["supervisor", "planner", "specialist", "verifier"]
      }
    });

    const result = validateSkillsXsd(createValidRawSkills([skill]));

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("validates all capability types", () => {
    const skill = createValidRawSkill({
      requiredCapabilities: {
        capability: [
          "read_repo",
          "write_repo",
          "execute_code",
          "network_access",
          "memory_read",
          "memory_write",
          "invoke_subagent",
          "escalate"
        ]
      }
    });

    const result = validateSkillsXsd(createValidRawSkills([skill]));

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("validates all escalation reason types", () => {
    const skill = createValidRawSkill({
      escalationPolicy: {
        on: [
          "missing_capability",
          "ambiguous_requirement",
          "framework_uncertainty",
          "malformed_output",
          "policy_conflict"
        ]
      }
    });

    const result = validateSkillsXsd(createValidRawSkills([skill]));

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("validates empty requiredCapabilities", () => {
    const skill = createValidRawSkill({
      requiredCapabilities: {
        capability: []
      }
    });

    const result = validateSkillsXsd(createValidRawSkills([skill]));

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ============================================================================
// INVALID ROLE TESTS
// ============================================================================

describe("XSD Validator - Invalid Roles", () => {
  it("rejects unknown role", () => {
    const skill = createValidRawSkill({
      allowedRoles: {
        role: ["unknown_role" as never]
      }
    });

    const result = validateSkillsXsd(createValidRawSkills([skill]));

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.code).toBe("INVALID_ROLE");
    expect(result.errors[0]!.value).toBe("unknown_role");
  });

  it("rejects mixed valid and invalid roles", () => {
    const skill = createValidRawSkill({
      allowedRoles: {
        role: ["specialist", "bad_role" as never]
      }
    });

    const result = validateSkillsXsd(createValidRawSkills([skill]));

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === "INVALID_ROLE")).toBe(true);
  });

  it("rejects empty roles array", () => {
    const skill = createValidRawSkill({
      allowedRoles: {
        role: []
      }
    });

    const result = validateSkillsXsd(createValidRawSkills([skill]));

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === "EMPTY_COLLECTION")).toBe(true);
  });

  it("rejects missing allowedRoles element", () => {
    const skill = createValidRawSkill();
    delete skill.allowedRoles;

    const result = validateSkillsXsd(createValidRawSkills([skill]));

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === "MISSING_REQUIRED_ELEMENT")).toBe(true);
  });
});

// ============================================================================
// INVALID CAPABILITY TESTS
// ============================================================================

describe("XSD Validator - Invalid Capabilities", () => {
  it("rejects unknown capability", () => {
    const skill = createValidRawSkill({
      requiredCapabilities: {
        capability: ["unknown_cap" as never]
      }
    });

    const result = validateSkillsXsd(createValidRawSkills([skill]));

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.code).toBe("INVALID_CAPABILITY");
    expect(result.errors[0]!.value).toBe("unknown_cap");
  });

  it("rejects mixed valid and invalid capabilities", () => {
    const skill = createValidRawSkill({
      requiredCapabilities: {
        capability: ["read_repo", "bad_cap" as never]
      }
    });

    const result = validateSkillsXsd(createValidRawSkills([skill]));

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === "INVALID_CAPABILITY")).toBe(true);
  });

  it("rejects missing requiredCapabilities element", () => {
    const skill = createValidRawSkill();
    delete skill.requiredCapabilities;

    const result = validateSkillsXsd(createValidRawSkills([skill]));

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === "MISSING_REQUIRED_ELEMENT")).toBe(true);
  });
});

// ============================================================================
// INVALID ESCALATION REASON TESTS
// ============================================================================

describe("XSD Validator - Invalid Escalation Reasons", () => {
  it("rejects unknown escalation reason", () => {
    const skill = createValidRawSkill({
      escalationPolicy: {
        on: ["unknown_reason" as never]
      }
    });

    const result = validateSkillsXsd(createValidRawSkills([skill]));

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.code).toBe("INVALID_ESCALATION_REASON");
    expect(result.errors[0]!.value).toBe("unknown_reason");
  });
});

// ============================================================================
// MISSING REQUIRED ATTRIBUTES TESTS
// ============================================================================

describe("XSD Validator - Missing Required Attributes", () => {
  it("rejects missing id attribute", () => {
    const skill = createValidRawSkill();
    delete skill["@_id"];

    const result = validateSkillsXsd(createValidRawSkills([skill]));

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === "MISSING_REQUIRED_ATTRIBUTE" && e.message.includes("id"))).toBe(true);
  });

  it("rejects empty id attribute", () => {
    const skill = createValidRawSkill({ "@_id": "" });

    const result = validateSkillsXsd(createValidRawSkills([skill]));

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === "MISSING_REQUIRED_ATTRIBUTE")).toBe(true);
  });

  it("rejects missing version attribute", () => {
    const skill = createValidRawSkill();
    delete skill["@_version"];

    const result = validateSkillsXsd(createValidRawSkills([skill]));

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === "MISSING_REQUIRED_ATTRIBUTE" && e.message.includes("version"))).toBe(true);
  });

  it("rejects missing description element", () => {
    const skill = createValidRawSkill();
    delete skill.description;

    const result = validateSkillsXsd(createValidRawSkills([skill]));

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === "MISSING_REQUIRED_ELEMENT" && e.message.includes("description"))).toBe(true);
  });

  it("rejects missing schemaVersion attribute", () => {
    const skills = createValidRawSkills();
    delete skills["@_schemaVersion"];

    const result = validateSkillsXsd(skills);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === "MISSING_REQUIRED_ATTRIBUTE" && e.message.includes("schemaVersion"))).toBe(true);
  });
});

// ============================================================================
// DUPLICATE ID TESTS
// ============================================================================

describe("XSD Validator - Duplicate IDs", () => {
  it("rejects duplicate skill IDs", () => {
    const skill1 = createValidRawSkill({ "@_id": "duplicate-id" });
    const skill2 = createValidRawSkill({ "@_id": "duplicate-id" });

    const result = validateSkillsXsd(createValidRawSkills([skill1, skill2]));

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === "DUPLICATE_ID")).toBe(true);
  });

  it("allows unique skill IDs", () => {
    const skill1 = createValidRawSkill({ "@_id": "skill-1" });
    const skill2 = createValidRawSkill({ "@_id": "skill-2" });

    const result = validateSkillsXsd(createValidRawSkills([skill1, skill2]));

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ============================================================================
// CIRCULAR EXTENDS TESTS
// ============================================================================

describe("XSD Validator - Circular Extends", () => {
  it("detects direct circular extends (A -> A)", () => {
    const skill = createValidRawSkill({
      "@_id": "skill-a",
      extends: "skill-a"
    });

    const result = validateSkillsXsd(createValidRawSkills([skill]));

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === "CIRCULAR_EXTENDS")).toBe(true);
  });

  it("detects indirect circular extends (A -> B -> A)", () => {
    const skillA = createValidRawSkill({
      "@_id": "skill-a",
      extends: "skill-b"
    });
    const skillB = createValidRawSkill({
      "@_id": "skill-b",
      extends: "skill-a"
    });

    const result = validateSkillsXsd(createValidRawSkills([skillA, skillB]));

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === "CIRCULAR_EXTENDS")).toBe(true);
  });

  it("detects longer circular extends (A -> B -> C -> A)", () => {
    const skillA = createValidRawSkill({
      "@_id": "skill-a",
      extends: "skill-b"
    });
    const skillB = createValidRawSkill({
      "@_id": "skill-b",
      extends: "skill-c"
    });
    const skillC = createValidRawSkill({
      "@_id": "skill-c",
      extends: "skill-a"
    });

    const result = validateSkillsXsd(createValidRawSkills([skillA, skillB, skillC]));

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === "CIRCULAR_EXTENDS")).toBe(true);
  });

  it("allows valid extends chain", () => {
    const skillBase = createValidRawSkill({ "@_id": "skill-base" });
    const skillMid = createValidRawSkill({
      "@_id": "skill-mid",
      extends: "skill-base"
    });
    const skillLeaf = createValidRawSkill({
      "@_id": "skill-leaf",
      extends: "skill-mid"
    });

    const result = validateSkillsXsd(createValidRawSkills([skillBase, skillMid, skillLeaf]));

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ============================================================================
// UNKNOWN EXTENDS TESTS
// ============================================================================

describe("XSD Validator - Unknown Extends", () => {
  it("warns on unknown extends reference", () => {
    const skill = createValidRawSkill({
      extends: "nonexistent-skill"
    });

    const result = validateSkillsXsd(createValidRawSkills([skill]));

    // Should be valid (warning only)
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.code === "UNKNOWN_EXTENDS")).toBe(true);
  });
});

// ============================================================================
// SCHEMA VERSION TESTS
// ============================================================================

describe("XSD Validator - Schema Version", () => {
  it("accepts supported schema version 1.0", () => {
    const result = validateSkillsXsd(createValidRawSkills());

    expect(result.valid).toBe(true);
    expect(result.schemaVersion).toBe("1.0");
  });

  it("warns on unsupported schema version", () => {
    const skills = createValidRawSkills();
    skills["@_schemaVersion"] = "2.0";

    const result = validateSkillsXsd(skills);

    // Should still be valid (warning only)
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.code === "SCHEMA_VERSION_MISMATCH")).toBe(true);
  });
});

// ============================================================================
// MEMORY ACCESS TESTS
// ============================================================================

describe("XSD Validator - Memory Access", () => {
  it("validates boolean string values", () => {
    const skill = createValidRawSkill({
      memoryAccess: {
        "@_read": "true",
        "@_write": "false"
      }
    });

    const result = validateSkillsXsd(createValidRawSkills([skill]));

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("validates boolean values", () => {
    const skill = createValidRawSkill({
      memoryAccess: {
        "@_read": true,
        "@_write": false
      }
    });

    const result = validateSkillsXsd(createValidRawSkills([skill]));

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects invalid boolean values", () => {
    const skill = createValidRawSkill({
      memoryAccess: {
        "@_read": "yes" as never,
        "@_write": "no" as never
      }
    });

    const result = validateSkillsXsd(createValidRawSkills([skill]));

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === "INVALID_TYPE")).toBe(true);
  });
});

// ============================================================================
// LIKU SKILL VALIDATION TESTS
// ============================================================================

describe("XSD Validator - LikuSkill Validation", () => {
  it("validates a valid LikuSkill", () => {
    const errors = validateLikuSkillXsd(createValidLikuSkill());

    expect(errors).toHaveLength(0);
  });

  it("rejects LikuSkill with invalid role", () => {
    const skill = createValidLikuSkill({
      allowedRoles: ["invalid_role" as never]
    });

    const errors = validateLikuSkillXsd(skill);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.code === "INVALID_ROLE")).toBe(true);
  });

  it("rejects LikuSkill with empty id", () => {
    const skill = createValidLikuSkill({ id: "" });

    const errors = validateLikuSkillXsd(skill);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.code === "MISSING_REQUIRED_ATTRIBUTE")).toBe(true);
  });

  it("rejects LikuSkill with empty allowedRoles", () => {
    const skill = createValidLikuSkill({ allowedRoles: [] });

    const errors = validateLikuSkillXsd(skill);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.code === "EMPTY_COLLECTION")).toBe(true);
  });
});

// ============================================================================
// FORMAT OUTPUT TESTS
// ============================================================================

describe("formatValidationResult", () => {
  it("formats valid result", () => {
    const result = validateSkillsXsd(createValidRawSkills());
    const output = formatValidationResult(result);

    expect(output).toContain("PASSED");
    expect(output).toContain("Schema Version: 1.0");
    expect(output).toContain("Skills Validated: 1");
  });

  it("formats invalid result with errors", () => {
    const skill = createValidRawSkill();
    delete skill["@_id"];
    const result = validateSkillsXsd(createValidRawSkills([skill]));
    const output = formatValidationResult(result);

    expect(output).toContain("FAILED");
    expect(output).toContain("Errors");
    expect(output).toContain("MISSING_REQUIRED_ATTRIBUTE");
  });

  it("formats result with warnings", () => {
    const skill = createValidRawSkill({ extends: "unknown" });
    const result = validateSkillsXsd(createValidRawSkills([skill]));
    const output = formatValidationResult(result);

    expect(output).toContain("PASSED"); // Warnings don't fail
    expect(output).toContain("Warnings");
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe("XSD Validator - Edge Cases", () => {
  it("handles undefined input", () => {
    const result = validateSkillsXsd(undefined);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.code).toBe("INVALID_STRUCTURE");
  });

  it("handles empty skills array", () => {
    const result = validateSkillsXsd(createValidRawSkills([]));

    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.code === "EMPTY_COLLECTION")).toBe(true);
    expect(result.skillCount).toBe(0);
  });

  it("handles single skill (not array)", () => {
    const skills: RawParsedSkills = {
      "@_schemaVersion": "1.0",
      skill: createValidRawSkill() // Single skill, not array
    };

    const result = validateSkillsXsd(skills);

    expect(result.valid).toBe(true);
    expect(result.skillCount).toBe(1);
  });

  it("handles text nodes in parsed XML", () => {
    const skill: RawParsedSkill = {
      "@_id": "test",
      "@_version": "1.0",
      description: { "#text": "A description" },
      allowedRoles: {
        role: [{ "#text": "specialist" }]
      },
      requiredCapabilities: {
        capability: [{ "#text": "read_repo" }]
      }
    };

    const result = validateSkillsXsd(createValidRawSkills([skill]));

    expect(result.valid).toBe(true);
  });

  it("validates XsdSkillValidator class directly", () => {
    const validator = new XsdSkillValidator();
    const result = validator.validate(createValidRawSkills());

    expect(result.valid).toBe(true);
    expect(XsdSkillValidator.SUPPORTED_SCHEMA_VERSION).toBe("1.0");
  });
});
