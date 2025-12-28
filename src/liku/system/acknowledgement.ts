/**
 * Acknowledgement Protocol
 *
 * Implements the system instruction acknowledgement protocol.
 * Agents must acknowledge receipt of their system instruction before
 * execution proceeds. Failure to acknowledge = hard stop.
 *
 * Per Architecture Guardrails (Hashing Law):
 * - Hash algorithm: SHA-256 truncated to 16 hex chars
 * - System instruction loader computes ack.version
 * - Only this component may generate authoritative instruction hashes
 */

import crypto from "node:crypto";
import type { RoleType } from "../skills/types.js";
import type {
  SystemInstruction,
  SystemInstructionAck,
  AckValidationResult,
  ProhibitionCheckResult,
  SystemProhibition
} from "./systemInstructionTypes.js";

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Hash algorithm and output format per Hashing Law.
 * SHA-256 truncated to 16 hex chars (64 bits).
 */
const HASH_ALGORITHM = "sha256";
const HASH_LENGTH = 16;

// ============================================================================
// HASH COMPUTATION
// ============================================================================

/**
 * Compute the version hash for a system instruction.
 * This is used in the acknowledgement protocol.
 *
 * Per Hashing Law:
 * - Hash inputs: instruction role, version, schemaVersion, all prohibitions
 * - Output: SHA-256 truncated to 16 hex chars
 *
 * @param instruction - The system instruction to hash
 * @returns 16-character hex hash string
 */
export function computeInstructionHash(instruction: SystemInstruction): string {
  // Build deterministic hash input from instruction content
  const hashInput = JSON.stringify({
    role: instruction.role,
    version: instruction.version,
    schemaVersion: instruction.schemaVersion,
    prohibitionIds: instruction.prohibitions.prohibitions
      .map(p => p.id)
      .sort(),
    prohibitionActions: instruction.prohibitions.prohibitions
      .map(p => p.action)
      .sort(),
    escalationRules: {
      canEscalate: instruction.escalationRules.canEscalate,
      canApproveEscalation: instruction.escalationRules.canApproveEscalation,
      escalationBehavior: instruction.escalationRules.escalationBehavior
    },
    memoryRules: {
      canRead: instruction.memoryRules.canRead,
      canWrite: instruction.memoryRules.canWrite,
      canValidate: instruction.memoryRules.canValidate,
      advisoryOnly: instruction.memoryRules.advisoryOnly
    }
  });

  return crypto
    .createHash(HASH_ALGORITHM)
    .update(hashInput)
    .digest("hex")
    .slice(0, HASH_LENGTH);
}

// ============================================================================
// ACKNOWLEDGEMENT CREATION
// ============================================================================

/**
 * Create an acknowledgement for a system instruction.
 * The agent calls this after receiving and parsing the instruction.
 *
 * @param instruction - The system instruction received
 * @param accepted - Whether the agent accepts the instruction
 * @param taskId - Optional task ID for audit trail
 * @returns SystemInstructionAck object
 */
export function createAcknowledgement(
  instruction: SystemInstruction,
  accepted: boolean,
  taskId?: string
): SystemInstructionAck {
  const ack: SystemInstructionAck = {
    role: instruction.role,
    version: computeInstructionHash(instruction),
    accepted,
    timestamp: new Date().toISOString()
  };

  if (taskId !== undefined) {
    ack.taskId = taskId;
  }

  return ack;
}

// ============================================================================
// ACKNOWLEDGEMENT VALIDATION
// ============================================================================

/**
 * Validate an acknowledgement against the expected system instruction.
 *
 * Validation checks:
 * 1. Role matches
 * 2. Version hash matches
 * 3. Accepted is true
 *
 * @param ack - The acknowledgement to validate
 * @param instruction - The expected system instruction
 * @returns Validation result with reason if invalid
 */
export function validateAcknowledgement(
  ack: SystemInstructionAck,
  instruction: SystemInstruction
): AckValidationResult {
  // Check role match
  if (ack.role !== instruction.role) {
    return {
      valid: false,
      reason: `Role mismatch: expected ${instruction.role}, got ${ack.role}`
    };
  }

  // Compute expected hash
  const expectedHash = computeInstructionHash(instruction);

  // Check version hash match
  if (ack.version !== expectedHash) {
    return {
      valid: false,
      reason: "Version hash mismatch",
      expectedVersion: expectedHash,
      receivedVersion: ack.version
    };
  }

  // Check acceptance
  if (!ack.accepted) {
    return {
      valid: false,
      reason: "Acknowledgement rejected by agent"
    };
  }

  return { valid: true };
}

// ============================================================================
// PROHIBITION CHECKING
// ============================================================================

/**
 * Check if an action is prohibited by the system instruction.
 *
 * @param instruction - The system instruction
 * @param action - The action to check
 * @returns Prohibition check result
 */
export function checkProhibition(
  instruction: SystemInstruction,
  action: string
): ProhibitionCheckResult {
  const prohibition = instruction.prohibitions.prohibitions.find(
    p => p.action === action
  );

  if (prohibition) {
    return {
      prohibited: true,
      prohibition,
      action: prohibition.onViolation
    };
  }

  return { prohibited: false };
}

/**
 * Get all prohibitions for a role.
 *
 * @param instruction - The system instruction
 * @returns Array of prohibitions
 */
export function getProhibitions(instruction: SystemInstruction): SystemProhibition[] {
  return [...instruction.prohibitions.prohibitions];
}

/**
 * Check if a capability is allowed by the system instruction.
 *
 * @param instruction - The system instruction
 * @param capability - The capability to check
 * @returns true if allowed, false otherwise
 */
export function isCapabilityAllowed(
  instruction: SystemInstruction,
  capability: string
): boolean {
  const allowedCaps = instruction.purpose.allowedCapabilities;
  if (!allowedCaps || allowedCaps.length === 0) {
    return false;
  }
  return allowedCaps.includes(capability as never);
}

// ============================================================================
// MEMORY RULE CHECKING
// ============================================================================

/**
 * Check if memory read is allowed by the system instruction.
 */
export function canReadMemory(instruction: SystemInstruction): boolean {
  return instruction.memoryRules.canRead;
}

/**
 * Check if memory write is allowed by the system instruction.
 * Note: This checks the instruction, not the Policy Engine.
 * Actual writes still require Policy Engine approval.
 */
export function canWriteMemory(instruction: SystemInstruction): boolean {
  return instruction.memoryRules.canWrite;
}

/**
 * Check if this role can validate memory.
 * Only verifier role should return true.
 */
export function canValidateMemory(instruction: SystemInstruction): boolean {
  return instruction.memoryRules.canValidate;
}

// ============================================================================
// ESCALATION CHECKING
// ============================================================================

/**
 * Check if this role can initiate escalation.
 */
export function canEscalate(instruction: SystemInstruction): boolean {
  return instruction.escalationRules.canEscalate;
}

/**
 * Check if this role can approve escalations.
 * Only supervisor should return true.
 */
export function canApproveEscalation(instruction: SystemInstruction): boolean {
  return instruction.escalationRules.canApproveEscalation;
}

// ============================================================================
// INSTRUCTION CACHE
// ============================================================================

/**
 * In-memory cache for loaded system instructions.
 * Avoids re-parsing XML on every agent invocation.
 */
const instructionCache = new Map<RoleType, {
  instruction: SystemInstruction;
  hash: string;
}>();

/**
 * Cache a loaded system instruction.
 */
export function cacheInstruction(instruction: SystemInstruction): void {
  const hash = computeInstructionHash(instruction);
  instructionCache.set(instruction.role, { instruction, hash });
}

/**
 * Get a cached instruction by role.
 */
export function getCachedInstruction(role: RoleType): SystemInstruction | undefined {
  return instructionCache.get(role)?.instruction;
}

/**
 * Get the hash of a cached instruction.
 */
export function getCachedHash(role: RoleType): string | undefined {
  return instructionCache.get(role)?.hash;
}

/**
 * Clear the instruction cache.
 */
export function clearInstructionCache(): void {
  instructionCache.clear();
}

/**
 * Get all cached instructions.
 */
export function getAllCachedInstructions(): Map<RoleType, SystemInstruction> {
  const result = new Map<RoleType, SystemInstruction>();
  for (const [role, cached] of instructionCache) {
    result.set(role, cached.instruction);
  }
  return result;
}
