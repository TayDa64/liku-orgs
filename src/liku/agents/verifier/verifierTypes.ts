/**
 * Verifier Agent Types (Phase 4.1)
 *
 * Defines types for the Verifier agent contract.
 *
 * ARCHITECTURE GUARDRAILS (from Tier-1):
 * - Verifier = validation only (no mutation)
 * - No tool calls
 * - No artifact modification
 * - No memory writes
 * - No escalation approval
 * - Violations route back to orchestrator only
 *
 * @see info-instructions/tier-2-implementation-guide.md
 */

import type { RoleType } from "../../skills/types.js";

// =============================================================================
// VERIFIER INPUT
// =============================================================================

/**
 * Input provided to the Verifier agent for validation.
 */
export interface VerifierInput {
  /**
   * The artifact to validate.
   * Can be any structured output from another agent.
   */
  readonly artifact: unknown;

  /**
   * The declared contract the artifact should conform to.
   * E.g., "PlannerOutput", "SupervisorOutput", etc.
   */
  readonly declaredContract: string;

  /**
   * Additional context metadata for validation.
   * May include task ID, step ID, role that produced the artifact, etc.
   */
  readonly contextMetadata: Readonly<Record<string, unknown>>;

  /**
   * The role of the agent that produced the artifact.
   */
  readonly producerRole: RoleType;

  /**
   * Optional: Previous validation attempts and their feedback.
   */
  readonly previousAttempts?: readonly VerifierAttempt[];
}

/**
 * A previous validation attempt (for retry context).
 */
export interface VerifierAttempt {
  /** Attempt number (1-based) */
  readonly attemptNumber: number;

  /** The artifact that was validated */
  readonly artifact: unknown;

  /** The verdict from that attempt */
  readonly verdict: VerifierVerdict;

  /** Violations found in that attempt */
  readonly violations: readonly TypedViolation[];

  /** Feedback provided in that attempt */
  readonly guidance: string;
}

// =============================================================================
// VERIFIER OUTPUT
// =============================================================================

/**
 * Verdict returned by the Verifier.
 */
export type VerifierVerdict = "pass" | "fail";

/**
 * Output from the Verifier agent.
 */
export interface VerifierOutput {
  /**
   * Overall verdict: pass or fail.
   * - "pass": Artifact conforms to declared contract
   * - "fail": Artifact has violations
   */
  readonly verdict: VerifierVerdict;

  /**
   * List of typed violations found (empty if pass).
   */
  readonly violations: readonly TypedViolation[];

  /**
   * Human-readable guidance for fixing violations.
   * Should be grounded in the actual contract requirements.
   */
  readonly guidance: string;

  /**
   * Whether escalation to human/policy layer is recommended.
   * True if violations are severe or unrecoverable.
   */
  readonly escalationRecommended: boolean;

  /**
   * Confidence score for the verification (0.0-1.0).
   * Lower confidence may indicate ambiguous contract requirements.
   */
  readonly confidence: number;
}

// =============================================================================
// TYPED VIOLATIONS
// =============================================================================

/**
 * Violation severity levels.
 */
export type ViolationSeverity = "critical" | "major" | "minor" | "warning";

/**
 * Categories of contract violations.
 */
export type ViolationCategory =
  | "missing_field"          // Required field not present
  | "invalid_type"           // Field has wrong type
  | "invalid_value"          // Field has invalid value
  | "constraint_violation"   // Business rule violated
  | "structure_mismatch"     // Overall structure doesn't match contract
  | "security_violation"     // Security-related violation
  | "policy_violation"       // Policy rule violated
  | "format_error";          // Format/encoding error

/**
 * A typed violation with categorization.
 */
export interface TypedViolation {
  /**
   * Unique identifier for this violation instance.
   */
  readonly id: string;

  /**
   * Category of the violation.
   */
  readonly category: ViolationCategory;

  /**
   * Severity of the violation.
   */
  readonly severity: ViolationSeverity;

  /**
   * Path to the violating element (e.g., "steps[0].agentResidence").
   */
  readonly path: string;

  /**
   * Human-readable description of the violation.
   */
  readonly message: string;

  /**
   * What was expected (from contract).
   */
  readonly expected?: string;

  /**
   * What was actually received.
   */
  readonly received?: string;

  /**
   * Whether this violation is recoverable via retry.
   */
  readonly recoverable: boolean;

  /**
   * Suggested fix for this specific violation.
   */
  readonly suggestedFix?: string;
}

// =============================================================================
// VERIFIER PROHIBITIONS
// =============================================================================

/**
 * Actions the Verifier is explicitly prohibited from taking.
 * These are enforced at the contract level.
 */
export const VERIFIER_PROHIBITIONS = {
  /**
   * Verifier cannot make tool calls.
   */
  NO_TOOL_CALLS: "Verifier cannot invoke tools",

  /**
   * Verifier cannot modify artifacts.
   */
  NO_ARTIFACT_MODIFICATION: "Verifier cannot modify the artifact being validated",

  /**
   * Verifier cannot write to memory.
   */
  NO_MEMORY_WRITES: "Verifier cannot write to memory (read-only access)",

  /**
   * Verifier cannot approve escalations.
   */
  NO_ESCALATION_APPROVAL: "Verifier cannot approve or deny escalations",

  /**
   * Verifier cannot execute code.
   */
  NO_CODE_EXECUTION: "Verifier cannot execute arbitrary code"
} as const;

/**
 * Type for prohibition keys.
 */
export type VerifierProhibition = keyof typeof VERIFIER_PROHIBITIONS;

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Check if a value is a valid VerifierVerdict.
 */
export function isVerifierVerdict(value: unknown): value is VerifierVerdict {
  return value === "pass" || value === "fail";
}

/**
 * Check if a value is a valid ViolationSeverity.
 */
export function isViolationSeverity(value: unknown): value is ViolationSeverity {
  return (
    value === "critical" ||
    value === "major" ||
    value === "minor" ||
    value === "warning"
  );
}

/**
 * Check if a value is a valid ViolationCategory.
 */
export function isViolationCategory(value: unknown): value is ViolationCategory {
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
  return typeof value === "string" && categories.includes(value as ViolationCategory);
}

/**
 * Create a violation ID.
 */
export function createViolationId(category: ViolationCategory, path: string): string {
  const timestamp = Date.now().toString(36);
  const pathHash = path.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0).toString(36);
  return `${category.slice(0, 3)}-${pathHash}-${timestamp}`;
}

// =============================================================================
// DEFAULT VALUES
// =============================================================================

/**
 * Default confidence when verifier is uncertain.
 */
export const DEFAULT_VERIFIER_CONFIDENCE = 0.8;

/**
 * Minimum confidence to consider verification reliable.
 */
export const MIN_RELIABLE_CONFIDENCE = 0.6;
