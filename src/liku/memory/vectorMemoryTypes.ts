/**
 * Vector Memory Types (VM-01)
 *
 * Defines the core types for the Vector Memory Index system.
 *
 * ARCHITECTURE GUARDRAILS:
 * - Memory is ADVISORY ONLY (never commands, instructions, or capabilities)
 * - Memory does not grant authority or override skills/plans/policy
 * - Memory absence must not break execution (fail-open reads)
 * - Memory writes require policy approval (fail-closed writes)
 * - Only verifier-authored memory may be validated
 *
 * @see info-instructions/vector-memory-index.md
 */

import type { RoleType } from "../skills/types.js";

// ============================================================================
// MEMORY TYPES (FIRST-CLASS)
// ============================================================================

/**
 * Semantic categories for memory records.
 * These are semantic categories, not roles.
 *
 * - `lesson_learned`: Knowledge gained from past experiences
 * - `error_pattern`: Recognized patterns of errors to avoid
 * - `best_practice`: Recommended approaches for common scenarios
 * - `design_decision`: Architectural or design choices with rationale
 * - `verification_outcome`: Results from verifier validation
 */
export type MemoryType =
  | "lesson_learned"
  | "error_pattern"
  | "best_practice"
  | "design_decision"
  | "verification_outcome";

/**
 * All valid memory types as a readonly array (for validation).
 */
export const MEMORY_TYPES: readonly MemoryType[] = [
  "lesson_learned",
  "error_pattern",
  "best_practice",
  "design_decision",
  "verification_outcome"
] as const;

/**
 * Type guard for MemoryType.
 */
export function isMemoryType(value: unknown): value is MemoryType {
  return typeof value === "string" && MEMORY_TYPES.includes(value as MemoryType);
}

// ============================================================================
// MEMORY SCOPE
// ============================================================================

/**
 * Memory scope determines visibility and weighting.
 *
 * Scope Weights (Locked):
 * - workspace: 1.0 (highest priority)
 * - repo: 0.8
 * - global: 0.4 (lowest priority)
 */
export type MemoryScope = "workspace" | "repo" | "global";

/**
 * Scope weights for retrieval ranking.
 * Workspace memory always dominates global.
 */
export const SCOPE_WEIGHTS: Readonly<Record<MemoryScope, number>> = {
  workspace: 1.0,
  repo: 0.8,
  global: 0.4
} as const;

// ============================================================================
// MEMORY RECORD SHAPE (CANONICAL)
// ============================================================================

/**
 * Provenance metadata for a memory record.
 * Tracks where the memory originated.
 */
export interface MemoryProvenance {
  /** Repository identifier */
  readonly repoId: string;

  /** Workspace identifier */
  readonly workspaceId: string;

  /** Task that created this memory (optional) */
  readonly taskId?: string;

  /** Step within the task that created this memory (optional) */
  readonly stepId?: string;

  /** Role of the agent that authored this memory */
  readonly agentRole: RoleType;
}

/**
 * Trust metadata for a memory record.
 * Controls weighting in retrieval.
 */
export interface MemoryTrust {
  /**
   * Confidence score (0.0–1.0).
   * Higher confidence = stronger signal in retrieval.
   */
  readonly confidence: number;

  /**
   * Whether this memory has been validated by a verifier.
   * Only verifier-authored memory may be validated.
   */
  readonly validated: boolean;

  /**
   * Task ID of the verifier that validated this memory (if validated).
   */
  readonly verifierTaskId?: string;
}

/**
 * Decay metadata for a memory record.
 * Controls memory expiration and freshness weighting.
 */
export interface MemoryDecay {
  /**
   * Time-to-live in milliseconds.
   * Record is eligible for removal when: now > createdAt + ttl
   */
  readonly ttl: number;

  /** ISO 8601 timestamp when the record was created */
  readonly createdAt: string;

  /** ISO 8601 timestamp when the record was last accessed (optional) */
  readonly lastAccessedAt?: string;
}

/**
 * Canonical shape for a vector memory record.
 *
 * CRITICAL: Memory records are ADVISORY ONLY.
 * They are suggestions, contextual hints, and historical signals.
 * They are NEVER commands, instructions, capabilities, or preconditions.
 */
export interface VectorMemoryRecord {
  /** Unique identifier for this record */
  readonly id: string;

  /** Vector embedding for similarity search */
  readonly embedding: readonly number[];

  /** Human-readable content */
  readonly content: string;

  /** Semantic category of this memory */
  readonly type: MemoryType;

  /** Origin metadata */
  readonly provenance: MemoryProvenance;

  /** Trust and validation metadata */
  readonly trust: MemoryTrust;

  /** Expiration and freshness metadata */
  readonly decay: MemoryDecay;

  /** Visibility scope */
  readonly scope: MemoryScope;
}

// ============================================================================
// QUERY PARAMETERS
// ============================================================================

/**
 * Filters for memory queries.
 */
export interface MemoryQueryFilters {
  /** Filter by repository */
  readonly repoId?: string;

  /** Filter by workspace */
  readonly workspaceId?: string;

  /** Filter by memory types */
  readonly type?: readonly MemoryType[];

  /** Minimum confidence threshold */
  readonly minConfidence?: number;

  /** Filter by scope */
  readonly scope?: MemoryScope;

  /** Include only validated memories */
  readonly validatedOnly?: boolean;
}

/**
 * Parameters for memory queries.
 */
export interface MemoryQueryParams {
  /** Query embedding vector */
  readonly embedding: readonly number[];

  /** Maximum number of results to return */
  readonly topK: number;

  /** Optional filters */
  readonly filters?: MemoryQueryFilters;
}

// ============================================================================
// MEMORY STATISTICS
// ============================================================================

/**
 * Statistics about the memory index.
 */
export interface MemoryStats {
  /** Total number of records */
  readonly totalRecords: number;

  /** Records by type */
  readonly byType: Readonly<Record<MemoryType, number>>;

  /** Records by scope */
  readonly byScope: Readonly<Record<MemoryScope, number>>;

  /** Count of validated records */
  readonly validatedCount: number;

  /** Count of expired (but not yet pruned) records */
  readonly expiredCount: number;

  /** Average confidence across all records */
  readonly averageConfidence: number;

  /** Timestamp of last decay run */
  readonly lastDecayRun?: string;
}

// ============================================================================
// VECTOR MEMORY INDEX INTERFACE (CORE)
// ============================================================================

/**
 * Result from a memory query with computed relevance score.
 */
export interface MemoryQueryResult {
  /** The memory record */
  readonly record: VectorMemoryRecord;

  /** Raw cosine similarity score (0.0–1.0) */
  readonly similarityScore: number;

  /**
   * Final relevance score after weighting.
   * Formula: similarityScore × scopeWeight × trustWeight × freshnessWeight
   */
  readonly relevanceScore: number;
}

/**
 * Vector Memory Index interface.
 *
 * ARCHITECTURE GUARDRAILS:
 * - Memory is advisory only
 * - Policy approval required for writes (call Policy Engine before upsert)
 * - Fail-open on query errors (return empty set)
 * - Memory can never block execution
 *
 * @see info-instructions/vector-memory-index.md
 */
export interface VectorMemoryIndex {
  /**
   * Insert or update a memory record.
   *
   * CRITICAL: This method must be gated by Policy Engine approval.
   * The caller is responsible for checking policy BEFORE calling upsert.
   *
   * @param record - The memory record to insert/update
   * @throws Error if insert fails (caller should handle gracefully)
   */
  upsert(record: VectorMemoryRecord): Promise<void>;

  /**
   * Query for similar memories.
   *
   * Returns advisory results only. These are:
   * - Suggestions
   * - Contextual hints
   * - Historical signals
   *
   * They are NEVER:
   * - Commands
   * - Instructions
   * - Capabilities
   * - Preconditions for execution
   *
   * FAIL-OPEN: On any error, returns empty array.
   *
   * @param params - Query parameters including embedding and filters
   * @returns Array of results sorted by relevance score (highest first)
   */
  query(params: MemoryQueryParams): Promise<readonly MemoryQueryResult[]>;

  /**
   * Remove expired records based on TTL.
   *
   * A record is eligible for removal if: now > createdAt + ttl
   *
   * No resurrection of expired memory is allowed.
   *
   * @param now - Current timestamp for TTL comparison
   * @returns Number of records pruned
   */
  decay(now: Date): Promise<number>;

  /**
   * Get statistics about the memory index.
   *
   * @returns Memory statistics
   */
  stats(): Promise<MemoryStats>;
}

// ============================================================================
// ROLE-BASED MEMORY ACCESS (READ)
// ============================================================================

/**
 * Memory access rules by role.
 * Note: All access is still advisory-only.
 */
export const ROLE_MEMORY_ACCESS: Readonly<Record<RoleType, readonly MemoryScope[]>> = {
  supervisor: ["workspace", "repo", "global"],
  planner: ["workspace", "repo"],
  specialist: ["workspace", "repo"],
  verifier: ["workspace", "repo", "global"]
} as const;

/**
 * Check if a role can access a given scope.
 */
export function canAccessScope(role: RoleType, scope: MemoryScope): boolean {
  const allowedScopes = ROLE_MEMORY_ACCESS[role];
  return allowedScopes.includes(scope);
}

// ============================================================================
// RELEVANCE SCORING UTILITIES
// ============================================================================

/**
 * Calculate trust weight for a memory record.
 * Formula: validated ? 1.0 : confidence
 */
export function calculateTrustWeight(trust: MemoryTrust): number {
  return trust.validated ? 1.0 : trust.confidence;
}

/**
 * Calculate freshness weight for a memory record.
 * Formula: max(0.2, 1 - age / ttl)
 *
 * @param decay - Decay metadata from record
 * @param now - Current timestamp
 * @returns Freshness weight between 0.2 and 1.0
 */
export function calculateFreshnessWeight(decay: MemoryDecay, now: Date): number {
  const createdAt = new Date(decay.createdAt).getTime();
  const age = now.getTime() - createdAt;
  const freshness = 1 - age / decay.ttl;
  return Math.max(0.2, Math.min(1.0, freshness));
}

/**
 * Calculate final relevance score for a memory query result.
 *
 * Formula: similarityScore × scopeWeight × trustWeight × freshnessWeight
 *
 * This ensures:
 * - Local memory dominates (scope weight)
 * - Old memories fade (freshness weight)
 * - Unverified memory is soft-signal only (trust weight)
 * - Workspace memory outranks global at equal similarity
 * - Unvalidated never scores higher than validated
 *
 * @param similarityScore - Raw cosine similarity (0.0–1.0)
 * @param scope - Memory scope
 * @param trust - Trust metadata
 * @param decay - Decay metadata
 * @param now - Current timestamp
 * @returns Final relevance score
 */
export function calculateRelevanceScore(
  similarityScore: number,
  scope: MemoryScope,
  trust: MemoryTrust,
  decay: MemoryDecay,
  now: Date
): number {
  const scopeWeight = SCOPE_WEIGHTS[scope];
  const trustWeight = calculateTrustWeight(trust);
  const freshnessWeight = calculateFreshnessWeight(decay, now);

  return similarityScore * scopeWeight * trustWeight * freshnessWeight;
}

/**
 * Check if a memory record has expired.
 *
 * @param decay - Decay metadata from record
 * @param now - Current timestamp
 * @returns true if record has expired
 */
export function isExpired(decay: MemoryDecay, now: Date): boolean {
  const createdAt = new Date(decay.createdAt).getTime();
  const expiresAt = createdAt + decay.ttl;
  return now.getTime() > expiresAt;
}

// ============================================================================
// EMBEDDING PROVIDER INTERFACE
// ============================================================================

/**
 * Embedding provider interface for generating vector embeddings.
 *
 * The default implementation should not make external API calls.
 * External embedding providers (OpenAI, etc.) are opt-in via BYOK.
 */
export interface EmbeddingProvider {
  /**
   * Generate an embedding vector for the given text.
   *
   * @param text - Text to embed
   * @returns Vector embedding as array of numbers
   */
  embed(text: string): Promise<readonly number[]>;

  /**
   * Get the dimension of embeddings produced by this provider.
   */
  readonly dimensions: number;

  /**
   * Provider identifier for provenance tracking.
   */
  readonly providerId: string;
}

// ============================================================================
// DEFAULT VALUES
// ============================================================================

/**
 * Default TTL for memory records (30 days in milliseconds).
 */
export const DEFAULT_MEMORY_TTL = 30 * 24 * 60 * 60 * 1000;

/**
 * Default confidence for unverified memory.
 */
export const DEFAULT_MEMORY_CONFIDENCE = 0.5;

/**
 * Default embedding dimensions (small for testing).
 */
export const DEFAULT_EMBEDDING_DIMENSIONS = 128;
