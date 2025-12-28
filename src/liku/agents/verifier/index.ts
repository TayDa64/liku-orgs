/**
 * Verifier Agent Module Public API
 *
 * Exports all verifier-related types and the verifier contract.
 */

// Types
export type {
  VerifierInput,
  VerifierOutput,
  VerifierVerdict,
  VerifierAttempt,
  TypedViolation,
  ViolationSeverity,
  ViolationCategory,
  VerifierProhibition
} from "./verifierTypes.js";

export {
  VERIFIER_PROHIBITIONS,
  isVerifierVerdict,
  isViolationSeverity,
  isViolationCategory,
  createViolationId,
  DEFAULT_VERIFIER_CONFIDENCE,
  MIN_RELIABLE_CONFIDENCE
} from "./verifierTypes.js";

// Contract
export { verifierContract } from "./verifierContract.js";
