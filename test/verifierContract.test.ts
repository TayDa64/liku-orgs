/**
 * Tests for verifierContract - Verifier Agent Contract
 * Phase 4.4: Test read-only guarantees, validation, and escalation behavior
 */

import { describe, it, expect } from "vitest";
import {
  verifierContract
} from "../src/liku/agents/verifier/verifierContract.js";
import type {
  VerifierOutput,
  TypedViolation,
  ViolationCategory,
  ViolationSeverity
} from "../src/liku/agents/verifier/verifierTypes.js";
import { VERIFIER_PROHIBITIONS } from "../src/liku/agents/verifier/verifierTypes.js";

describe("Verifier Contract", () => {
  describe("verifierContract.parse", () => {
    it("should parse valid passing verifier output", () => {
      const validOutput: VerifierOutput = {
        verdict: "pass",
        violations: [],
        guidance: "All validation checks passed",
        confidence: 0.95,
        escalationRecommended: false
      };

      const result = verifierContract.parse(validOutput);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.parsed.verdict).toBe("pass");
        expect(result.parsed.violations).toHaveLength(0);
        expect(result.parsed.confidence).toBe(0.95);
      }
    });

    it("should parse valid failing verifier output with violations", () => {
      const violation: TypedViolation = {
        id: "v1",
        category: "missing_field",
        severity: "critical",
        path: "$.output.data",
        message: "Required field 'data' is missing",
        recoverable: true,
        suggestedFix: "Add the 'data' field to the output"
      };

      const validOutput: VerifierOutput = {
        verdict: "fail",
        violations: [violation],
        guidance: "The output is missing required fields",
        confidence: 0.9,
        escalationRecommended: false
      };

      const result = verifierContract.parse(validOutput);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.parsed.verdict).toBe("fail");
        expect(result.parsed.violations).toHaveLength(1);
        expect(result.parsed.violations[0]!.category).toBe("missing_field");
      }
    });

    it("should parse output with all violation categories", () => {
      const categories: ViolationCategory[] = [
        "missing_field",
        "invalid_type",
        "invalid_value",
        "constraint_violation",
        "structure_mismatch",
        "security_violation",
        "policy_violation",
        "format_error"
      ];

      for (const category of categories) {
        const output: VerifierOutput = {
          verdict: "fail",
          violations: [{
            id: `v-${category}`,
            category,
            severity: "major",
            path: "$.test",
            message: `Test ${category}`,
            recoverable: true
          }],
          guidance: "Fix the issue",
          confidence: 0.8,
          escalationRecommended: false
        };

        const result = verifierContract.parse(output);
        expect(result.valid).toBe(true);
      }
    });

    it("should parse output with all severity levels", () => {
      const severities: ViolationSeverity[] = ["critical", "major", "minor", "warning"];

      for (const severity of severities) {
        const output: VerifierOutput = {
          verdict: "fail",
          violations: [{
            id: `v-${severity}`,
            category: "invalid_value",
            severity,
            path: "$.test",
            message: `Test ${severity}`,
            recoverable: true
          }],
          guidance: "Fix the issue",
          confidence: 0.8,
          escalationRecommended: false
        };

        const result = verifierContract.parse(output);
        expect(result.valid).toBe(true);
      }
    });

    it("should reject non-object output", () => {
      const result = verifierContract.parse("not an object");
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.violation.role).toBe("verifier");
        expect(result.violation.recoverable).toBe(true);
      }
    });

    it("should reject null output", () => {
      const result = verifierContract.parse(null);
      expect(result.valid).toBe(false);
    });

    it("should reject output with invalid verdict", () => {
      const result = verifierContract.parse({
        verdict: "maybe",
        violations: [],
        guidance: "test",
        confidence: 0.9,
        escalationRecommended: false
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.violation.expected).toContain("pass");
      }
    });

    it("should reject output without violations array", () => {
      const result = verifierContract.parse({
        verdict: "pass",
        confidence: 0.9,
        escalationRecommended: false
      });
      expect(result.valid).toBe(false);
    });

    it("should reject output with non-array violations", () => {
      const result = verifierContract.parse({
        verdict: "pass",
        violations: "not an array",
        confidence: 0.9,
        escalationRecommended: false
      });
      expect(result.valid).toBe(false);
    });

    it("should reject output with invalid confidence range", () => {
      const resultHigh = verifierContract.parse({
        verdict: "pass",
        violations: [],
        confidence: 1.5,
        escalationRecommended: false
      });
      expect(resultHigh.valid).toBe(false);

      const resultLow = verifierContract.parse({
        verdict: "pass",
        violations: [],
        confidence: -0.1,
        escalationRecommended: false
      });
      expect(resultLow.valid).toBe(false);
    });

    it("should reject output without escalationRecommended", () => {
      const result = verifierContract.parse({
        verdict: "pass",
        violations: [],
        confidence: 0.9
      });
      expect(result.valid).toBe(false);
    });

    it("should reject violation with invalid category", () => {
      const result = verifierContract.parse({
        verdict: "fail",
        violations: [{
          id: "v1",
          category: "unknown_category",
          severity: "major",
          path: "$.test",
          message: "Test",
          recoverable: true
        }],
        confidence: 0.9,
        escalationRecommended: false
      });
      expect(result.valid).toBe(false);
    });

    it("should reject violation with invalid severity", () => {
      const result = verifierContract.parse({
        verdict: "fail",
        violations: [{
          id: "v1",
          category: "missing_field",
          severity: "unknown_severity",
          path: "$.test",
          message: "Test",
          recoverable: true
        }],
        confidence: 0.9,
        escalationRecommended: false
      });
      expect(result.valid).toBe(false);
    });

    it("should reject violation without required fields", () => {
      const result = verifierContract.parse({
        verdict: "fail",
        violations: [{
          id: "v1",
          // missing category, severity, path, message, recoverable
        }],
        confidence: 0.9,
        escalationRecommended: false
      });
      expect(result.valid).toBe(false);
    });
  });

  describe("verifierContract.onViolation", () => {
    const mockViolation = {
      role: "verifier" as const,
      expected: "valid verifier output",
      received: "invalid output",
      recoverable: true,
      suggestedFeedback: "Fix the output format"
    };

    it("should return retry for first violation", () => {
      const action = verifierContract.onViolation(mockViolation, 0);
      expect(action.action).toBe("retry");
      if (action.action === "retry") {
        expect(action.feedback).toBeDefined();
      }
    });

    it("should return escalate_human for second violation (verifier cannot escalate to itself)", () => {
      const action = verifierContract.onViolation(mockViolation, 1);
      // Verifier cannot escalate to verifier (itself), so it goes to human
      expect(action.action).toBe("escalate_human");
    });

    it("should return escalate_human for multiple violations", () => {
      const action = verifierContract.onViolation(mockViolation, 5);
      expect(action.action).toBe("escalate_human");
    });
  });

  describe("prohibition detection (via parse)", () => {
    it("should detect tool call indicators", () => {
      const outputWithTools = {
        verdict: "pass",
        violations: [],
        guidance: "looks good",
        confidence: 0.9,
        escalationRecommended: false,
        toolCalls: [{ name: "writeFile" }]
      };

      const result = verifierContract.parse(outputWithTools);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.violation.recoverable).toBe(false);
      }
    });

    it("should detect artifact modification indicators", () => {
      const outputWithMods = {
        verdict: "pass",
        violations: [],
        guidance: "looks good",
        confidence: 0.9,
        escalationRecommended: false,
        modifiedArtifact: { data: "changed" }
      };

      const result = verifierContract.parse(outputWithMods);
      expect(result.valid).toBe(false);
    });

    it("should detect memory write indicators", () => {
      const outputWithMemWrite = {
        verdict: "pass",
        violations: [],
        guidance: "looks good",
        confidence: 0.9,
        escalationRecommended: false,
        memoryWrites: [{ key: "test", value: "data" }]
      };

      const result = verifierContract.parse(outputWithMemWrite);
      expect(result.valid).toBe(false);
    });

    it("should detect escalation approval indicators", () => {
      const outputWithApproval = {
        verdict: "pass",
        violations: [],
        guidance: "looks good",
        confidence: 0.9,
        escalationRecommended: false,
        approveEscalation: true
      };

      const result = verifierContract.parse(outputWithApproval);
      expect(result.valid).toBe(false);
    });

    it("should detect code execution indicators", () => {
      const outputWithExec = {
        verdict: "pass",
        violations: [],
        guidance: "looks good",
        confidence: 0.9,
        escalationRecommended: false,
        executeCode: "console.log('hi')"
      };

      const result = verifierContract.parse(outputWithExec);
      expect(result.valid).toBe(false);
    });

    it("should allow clean read-only output", () => {
      const cleanOutput: VerifierOutput = {
        verdict: "pass",
        violations: [],
        guidance: "The output looks correct and follows the contract",
        confidence: 0.95,
        escalationRecommended: false
      };

      const result = verifierContract.parse(cleanOutput);
      expect(result.valid).toBe(true);
    });
  });

  describe("TypedViolation validation (via parse)", () => {
    it("should accept a complete violation", () => {
      const output: VerifierOutput = {
        verdict: "fail",
        violations: [{
          id: "v1",
          category: "missing_field",
          severity: "critical",
          path: "$.output.result",
          message: "Required field missing",
          expected: "string",
          received: "undefined",
          recoverable: true,
          suggestedFix: "Add the result field"
        }],
        guidance: "Add missing field",
        confidence: 0.9,
        escalationRecommended: false
      };

      const result = verifierContract.parse(output);
      expect(result.valid).toBe(true);
    });

    it("should reject violation with missing id", () => {
      const output = {
        verdict: "fail",
        violations: [{
          category: "missing_field",
          severity: "critical",
          path: "$.test",
          message: "Test",
          recoverable: true
        }],
        guidance: "Fix it",
        confidence: 0.9,
        escalationRecommended: false
      };

      const result = verifierContract.parse(output);
      expect(result.valid).toBe(false);
    });

    it("should reject violation with invalid category", () => {
      const output = {
        verdict: "fail",
        violations: [{
          id: "v1",
          category: "not_a_category",
          severity: "major",
          path: "$.test",
          message: "Test",
          recoverable: true
        }],
        guidance: "Fix it",
        confidence: 0.9,
        escalationRecommended: false
      };

      const result = verifierContract.parse(output);
      expect(result.valid).toBe(false);
    });

    it("should reject violation with invalid severity", () => {
      const output = {
        verdict: "fail",
        violations: [{
          id: "v1",
          category: "invalid_type",
          severity: "super_critical",
          path: "$.test",
          message: "Test",
          recoverable: true
        }],
        guidance: "Fix it",
        confidence: 0.9,
        escalationRecommended: false
      };

      const result = verifierContract.parse(output);
      expect(result.valid).toBe(false);
    });

    it("should reject violation with non-boolean recoverable", () => {
      const output = {
        verdict: "fail",
        violations: [{
          id: "v1",
          category: "invalid_type",
          severity: "major",
          path: "$.test",
          message: "Test",
          recoverable: "yes"
        }],
        guidance: "Fix it",
        confidence: 0.9,
        escalationRecommended: false
      };

      const result = verifierContract.parse(output);
      expect(result.valid).toBe(false);
    });
  });

  describe("VERIFIER_PROHIBITIONS constant", () => {
    it("should have exactly 5 prohibitions", () => {
      const keys = Object.keys(VERIFIER_PROHIBITIONS);
      expect(keys).toHaveLength(5);
    });

    it("should include NO_TOOL_CALLS prohibition", () => {
      expect(VERIFIER_PROHIBITIONS.NO_TOOL_CALLS).toBeDefined();
      expect(typeof VERIFIER_PROHIBITIONS.NO_TOOL_CALLS).toBe("string");
    });

    it("should include NO_ARTIFACT_MODIFICATION prohibition", () => {
      expect(VERIFIER_PROHIBITIONS.NO_ARTIFACT_MODIFICATION).toBeDefined();
      expect(typeof VERIFIER_PROHIBITIONS.NO_ARTIFACT_MODIFICATION).toBe("string");
    });

    it("should include NO_MEMORY_WRITES prohibition", () => {
      expect(VERIFIER_PROHIBITIONS.NO_MEMORY_WRITES).toBeDefined();
      expect(typeof VERIFIER_PROHIBITIONS.NO_MEMORY_WRITES).toBe("string");
    });

    it("should include NO_ESCALATION_APPROVAL prohibition", () => {
      expect(VERIFIER_PROHIBITIONS.NO_ESCALATION_APPROVAL).toBeDefined();
      expect(typeof VERIFIER_PROHIBITIONS.NO_ESCALATION_APPROVAL).toBe("string");
    });

    it("should include NO_CODE_EXECUTION prohibition", () => {
      expect(VERIFIER_PROHIBITIONS.NO_CODE_EXECUTION).toBeDefined();
      expect(typeof VERIFIER_PROHIBITIONS.NO_CODE_EXECUTION).toBe("string");
    });
  });

  describe("Integration with contract registry", () => {
    it("should have verifier role", () => {
      expect(verifierContract.role).toBe("verifier");
    });

    it("should implement AgentContract interface", () => {
      expect(verifierContract.parse).toBeDefined();
      expect(verifierContract.onViolation).toBeDefined();
      expect(typeof verifierContract.parse).toBe("function");
      expect(typeof verifierContract.onViolation).toBe("function");
    });
  });
});
