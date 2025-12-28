/**
 * Memory Module Exports
 *
 * Provides SQLite-backed memory storage for the Liku multi-agent system.
 */

// Legacy event logging memory
export { SqliteMemory } from "./sqliteMemory.js";
export type {
  TaskEvent,
  MemorySearchResult,
  MemorySearchOptions,
  LogEventOptions,
  MemoryProvenance as LegacyMemoryProvenance,
  MemoryScope as LegacyMemoryScope
} from "./types.js";

// Vector memory types (VM-01)
export type {
  VectorMemoryIndex,
  VectorMemoryRecord,
  MemoryQueryParams,
  MemoryQueryResult,
  MemoryStats,
  MemoryType,
  MemoryScope,
  MemoryProvenance,
  MemoryTrust,
  MemoryDecay,
  MemoryQueryFilters,
  EmbeddingProvider
} from "./vectorMemoryTypes.js";
export {
  MEMORY_TYPES,
  SCOPE_WEIGHTS,
  ROLE_MEMORY_ACCESS,
  DEFAULT_MEMORY_TTL,
  isMemoryType,
  calculateTrustWeight,
  calculateFreshnessWeight,
  calculateRelevanceScore,
  isExpired,
  canAccessScope
} from "./vectorMemoryTypes.js";

// Vector memory schema (VM-02)
export {
  VECTOR_MEMORY_SCHEMA_VERSION,
  CREATE_VECTOR_MEMORY_TABLE,
  CREATE_VECTOR_MEMORY_INDEXES,
  UPSERT_VECTOR_MEMORY,
  DELETE_EXPIRED,
  UPDATE_LAST_ACCESSED,
  migrateVectorMemory,
  serializeEmbedding,
  deserializeEmbedding,
  isValidMemoryType as schemaIsValidMemoryType,
  isValidScope as schemaIsValidScope,
  isValidRole as schemaIsValidRole
} from "./vectorMemorySchema.js";
export type { VectorMemoryRow } from "./vectorMemorySchema.js";

// SQLite Vector Memory Index (VM-03)
export {
  SQLiteVectorMemoryIndex,
  cosineSimilarity
} from "./sqliteVectorMemoryIndex.js";
export type { SQLiteVectorMemoryIndexOptions } from "./sqliteVectorMemoryIndex.js";

// Embedding Providers (VM-04)
export {
  NoopEmbeddingProvider,
  HashEmbeddingProvider,
  RandomEmbeddingProvider,
  CachingEmbeddingProvider,
  createTestEmbeddingProvider,
  createNoopEmbeddingProvider
} from "./embeddingProvider.js";
