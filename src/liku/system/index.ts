/**
 * System Module - Per-Role System Instructions
 *
 * This module provides:
 * - System instruction types (systemInstructionTypes.ts)
 * - XML parsing for system instructions (systemInstructionLoader.ts)
 * - Acknowledgement protocol (acknowledgement.ts)
 *
 * Per Architecture Guardrails:
 * - System instructions are LOCKED and non-negotiable
 * - Agents must acknowledge receipt before execution
 * - Failure to acknowledge = hard stop
 */

// Types
export type {
  SeverityType,
  ViolationAction,
  EscalationBehavior,
  SystemPurpose,
  SystemProhibition,
  SystemProhibitions,
  EscalationTrigger,
  SystemEscalationRules,
  MemoryScopePriority,
  SystemMemoryRules,
  SystemInstruction,
  SystemInstructionAck,
  AckValidationResult,
  ProhibitionCheckResult,
  ProhibitedAction
} from "./systemInstructionTypes.js";

export { PROHIBITED_ACTIONS } from "./systemInstructionTypes.js";

// Loader
export {
  parseSystemInstructionXml,
  validateSystemInstruction,
  SystemInstructionParseError
} from "./systemInstructionLoader.js";

// Acknowledgement Protocol
export {
  computeInstructionHash,
  createAcknowledgement,
  validateAcknowledgement,
  checkProhibition,
  getProhibitions,
  isCapabilityAllowed,
  canReadMemory,
  canWriteMemory,
  canValidateMemory,
  canEscalate,
  canApproveEscalation,
  cacheInstruction,
  getCachedInstruction,
  getCachedHash,
  clearInstructionCache,
  getAllCachedInstructions
} from "./acknowledgement.js";
