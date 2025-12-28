/**
 * Verifier Agent Contract (Phase 4.2)
 *
 * Implements AgentContract<VerifierOutput> for the Verifier role.
 *
 * ARCHITECTURE GUARDRAILS:
 * - Verifier = validation only (no mutation)
 * - Explicit prohibitions enforced:
 *   - No tool calls
 *   - No artifact modification
 *   - No memory writes
 *   - No escalation approval
 * - Violations route back to orchestrator only
 *
 * @see info-instructions/tier-2-implementation-guide.md
 */

import type { AgentContract, ContractValidationResult, ContractViolation, ViolationAction } from "../../orchestrator/contracts.js";
import { DEFAULT_VIOLATION_POLICY } from "../../orchestrator/contracts.js";
import type {
  VerifierOutput,
  TypedViolation,
  ViolationSeverity,
  ViolationCategory
} from "./verifierTypes.js";
import {
  isVerifierVerdict,
  isViolationSeverity,
  isViolationCategory,
  DEFAULT_VERIFIER_CONFIDENCE,
  VERIFIER_PROHIBITIONS
} from "./verifierTypes.js";

// =============================================================================
// VERIFIER CONTRACT
// =============================================================================

/**
 * Contract for the Verifier agent role.
 *
 * The Verifier is a read-only validation agent that:
 * - Validates artifacts against declared contracts
 * - Reports typed violations with severity and category
 * - Provides human-readable guidance for fixes
 * - Recommends escalation when appropriate
 *
 * The Verifier CANNOT:
 * - Make tool calls
 * - Modify artifacts
 * - Write to memory
 * - Approve escalations
 * - Execute code
 */
export const verifierContract: AgentContract<VerifierOutput> = {
  role: "verifier",

  parse(output: unknown): ContractValidationResult<VerifierOutput> {
    // Null/undefined check
    if (output === null || output === undefined) {
      return createViolation(
        "object with verdict, violations, guidance, escalationRecommended",
        "null or undefined",
        "Output must be a JSON object"
      );
    }

    // Type check
    if (typeof output !== "object") {
      return createViolation(
        "object",
        typeof output,
        "Output must be a JSON object"
      );
    }

    const obj = output as Record<string, unknown>;

    // Check for prohibited actions (if somehow encoded in output)
    const prohibitionViolation = checkProhibitions(obj);
    if (prohibitionViolation) {
      return createViolation(
        "no prohibited actions",
        prohibitionViolation,
        `Verifier cannot perform: ${prohibitionViolation}`,
        false // Not recoverable - this is a security concern
      );
    }

    // Validate verdict (required)
    if (!("verdict" in obj)) {
      return createViolation(
        "verdict field",
        "missing",
        "Output must include 'verdict' field with value 'pass' or 'fail'"
      );
    }

    if (!isVerifierVerdict(obj.verdict)) {
      return createViolation(
        "'pass' or 'fail'",
        String(obj.verdict),
        "verdict must be exactly 'pass' or 'fail'"
      );
    }

    // Validate violations array (required, can be empty for pass)
    if (!("violations" in obj)) {
      return createViolation(
        "violations array",
        "missing",
        "Output must include 'violations' array (can be empty for pass)"
      );
    }

    if (!Array.isArray(obj.violations)) {
      return createViolation(
        "array",
        typeof obj.violations,
        "violations must be an array"
      );
    }

    // Validate each violation structure
    const violations: TypedViolation[] = [];
    for (let i = 0; i < obj.violations.length; i++) {
      const v = obj.violations[i];
      if (!v || typeof v !== "object") {
        return createViolation(
          "violation object at index " + i,
          typeof v,
          `violations[${i}] must be an object`
        );
      }

      const vObj = v as Record<string, unknown>;
      const validatedViolation = validateTypedViolation(vObj, i);
      if ("error" in validatedViolation) {
        return validatedViolation.error;
      }
      violations.push(validatedViolation.violation);
    }

    // Cross-validate: fail verdict should have violations, pass should not
    if (obj.verdict === "fail" && violations.length === 0) {
      return createViolation(
        "at least one violation for fail verdict",
        "empty violations array",
        "A 'fail' verdict must include at least one violation"
      );
    }

    if (obj.verdict === "pass" && violations.length > 0) {
      // This is a warning case - we'll accept but note it
      // The verifier might be providing advisory violations with pass
    }

    // Validate guidance (required)
    if (!("guidance" in obj) || typeof obj.guidance !== "string") {
      return createViolation(
        "guidance string",
        obj.guidance === undefined ? "missing" : typeof obj.guidance,
        "Output must include 'guidance' as a non-empty string"
      );
    }

    // Validate escalationRecommended (required)
    if (!("escalationRecommended" in obj) || typeof obj.escalationRecommended !== "boolean") {
      return createViolation(
        "escalationRecommended boolean",
        obj.escalationRecommended === undefined ? "missing" : typeof obj.escalationRecommended,
        "Output must include 'escalationRecommended' as a boolean"
      );
    }

    // Validate confidence (optional, default if missing)
    let confidence = DEFAULT_VERIFIER_CONFIDENCE;
    if ("confidence" in obj) {
      if (typeof obj.confidence !== "number" || obj.confidence < 0 || obj.confidence > 1) {
        return createViolation(
          "number between 0 and 1",
          String(obj.confidence),
          "confidence must be a number between 0.0 and 1.0"
        );
      }
      confidence = obj.confidence;
    }

    // Success - return parsed output
    return {
      valid: true,
      parsed: {
        verdict: obj.verdict,
        violations,
        guidance: obj.guidance,
        escalationRecommended: obj.escalationRecommended,
        confidence
      }
    };
  },

  onViolation(violation: ContractViolation, retryCount: number): ViolationAction {
    // Non-recoverable violations (security concerns) go straight to human
    if (!violation.recoverable) {
      return {
        action: "escalate_human",
        violation
      };
    }

    // Verifier contract is strict - fewer retries than other agents
    if (retryCount < DEFAULT_VIOLATION_POLICY.maxRetries) {
      return {
        action: "retry",
        feedback: violation.suggestedFeedback ?? 
          "Verifier output must conform to VerifierOutput schema: { verdict, violations[], guidance, escalationRecommended }"
      };
    }

    // After retries, escalate to human (verifier is already the escalation target for others)
    // We can't escalate verifier to itself
    return {
      action: "escalate_human",
      violation
    };
  }
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Create a validation failure result.
 */
function createViolation(
  expected: string,
  received: string,
  feedback: string,
  recoverable = true
): ContractValidationResult<VerifierOutput> {
  return {
    valid: false,
    violation: {
      role: "verifier",
      expected,
      received,
      recoverable,
      suggestedFeedback: feedback
    }
  };
}

/**
 * Check if output contains prohibited actions.
 */
function checkProhibitions(obj: Record<string, unknown>): string | null {
  // Check for tool call indicators
  if ("toolCalls" in obj || "tool_calls" in obj || "tools" in obj) {
    return VERIFIER_PROHIBITIONS.NO_TOOL_CALLS;
  }

  // Check for modification indicators
  if ("modifiedArtifact" in obj || "modifications" in obj || "changes" in obj) {
    return VERIFIER_PROHIBITIONS.NO_ARTIFACT_MODIFICATION;
  }

  // Check for memory write indicators
  if ("memoryWrites" in obj || "memory_write" in obj || "writeToMemory" in obj) {
    return VERIFIER_PROHIBITIONS.NO_MEMORY_WRITES;
  }

  // Check for escalation approval indicators
  if ("approveEscalation" in obj || "escalationApproval" in obj) {
    return VERIFIER_PROHIBITIONS.NO_ESCALATION_APPROVAL;
  }

  // Check for code execution indicators
  if ("executeCode" in obj || "code_execution" in obj || "runCode" in obj) {
    return VERIFIER_PROHIBITIONS.NO_CODE_EXECUTION;
  }

  return null;
}

/**
 * Validate a TypedViolation object.
 */
function validateTypedViolation(
  obj: Record<string, unknown>,
  index: number
): { violation: TypedViolation } | { error: ContractValidationResult<VerifierOutput> } {
  
  // Required: id
  if (typeof obj.id !== "string" || obj.id.trim() === "") {
    return {
      error: createViolation(
        "non-empty string id",
        String(obj.id),
        `violations[${index}].id must be a non-empty string`
      )
    };
  }

  // Required: category
  if (!isViolationCategory(obj.category)) {
    return {
      error: createViolation(
        "valid ViolationCategory",
        String(obj.category),
        `violations[${index}].category must be one of: missing_field, invalid_type, invalid_value, constraint_violation, structure_mismatch, security_violation, policy_violation, format_error`
      )
    };
  }

  // Required: severity
  if (!isViolationSeverity(obj.severity)) {
    return {
      error: createViolation(
        "valid ViolationSeverity",
        String(obj.severity),
        `violations[${index}].severity must be one of: critical, major, minor, warning`
      )
    };
  }

  // Required: path
  if (typeof obj.path !== "string") {
    return {
      error: createViolation(
        "string path",
        typeof obj.path,
        `violations[${index}].path must be a string`
      )
    };
  }

  // Required: message
  if (typeof obj.message !== "string" || obj.message.trim() === "") {
    return {
      error: createViolation(
        "non-empty message string",
        String(obj.message),
        `violations[${index}].message must be a non-empty string`
      )
    };
  }

  // Required: recoverable
  if (typeof obj.recoverable !== "boolean") {
    return {
      error: createViolation(
        "boolean recoverable",
        typeof obj.recoverable,
        `violations[${index}].recoverable must be a boolean`
      )
    };
  }

  // Build the violation object (optional fields only if present)
  const violation: TypedViolation = {
    id: obj.id,
    category: obj.category,
    severity: obj.severity,
    path: obj.path,
    message: obj.message,
    recoverable: obj.recoverable
  };

  // Optional: expected
  if (obj.expected !== undefined) {
    if (typeof obj.expected !== "string") {
      return {
        error: createViolation(
          "string expected",
          typeof obj.expected,
          `violations[${index}].expected must be a string if provided`
        )
      };
    }
    (violation as { expected?: string }).expected = obj.expected;
  }

  // Optional: received
  if (obj.received !== undefined) {
    if (typeof obj.received !== "string") {
      return {
        error: createViolation(
          "string received",
          typeof obj.received,
          `violations[${index}].received must be a string if provided`
        )
      };
    }
    (violation as { received?: string }).received = obj.received;
  }

  // Optional: suggestedFix
  if (obj.suggestedFix !== undefined) {
    if (typeof obj.suggestedFix !== "string") {
      return {
        error: createViolation(
          "string suggestedFix",
          typeof obj.suggestedFix,
          `violations[${index}].suggestedFix must be a string if provided`
        )
      };
    }
    (violation as { suggestedFix?: string }).suggestedFix = obj.suggestedFix;
  }

  return { violation };
}