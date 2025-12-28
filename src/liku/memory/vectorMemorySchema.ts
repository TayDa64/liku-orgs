/**
 * Vector Memory SQLite Schema (VM-02)
 *
 * Defines the database schema for the vector memory index.
 *
 * SCHEMA DESIGN:
 * - Single `vector_memory` table with full provenance
 * - Embedding stored as BLOB (Float64Array serialized)
 * - Composite indexes for efficient scoped queries
 * - No foreign keys (self-contained advisory store)
 *
 * ARCHITECTURE GUARDRAILS:
 * - Memory is advisory only
 * - Policy approval required before writes (enforced by caller)
 * - Fail-open on read errors (return empty)
 * - Fail-closed on write errors (propagate)
 *
 * @see info-instructions/vector-memory-index.md
 */

import type { Database } from "sql.js";

// =============================================================================
// SCHEMA VERSION
// =============================================================================

/**
 * Current schema version.
 * Increment when making breaking schema changes.
 */
export const VECTOR_MEMORY_SCHEMA_VERSION = 1;

// =============================================================================
// TABLE DEFINITIONS
// =============================================================================

/**
 * SQL statements to create the vector_memory table.
 */
export const CREATE_VECTOR_MEMORY_TABLE = `
CREATE TABLE IF NOT EXISTS vector_memory (
  -- Primary identifier
  id TEXT PRIMARY KEY NOT NULL,

  -- Vector embedding (stored as BLOB, Float64Array)
  -- Cosine similarity computed in JS, not SQLite
  embedding BLOB NOT NULL,

  -- Human-readable content
  content TEXT NOT NULL,

  -- Semantic category (lesson_learned, error_pattern, etc.)
  type TEXT NOT NULL CHECK (type IN (
    'lesson_learned',
    'error_pattern',
    'best_practice',
    'design_decision',
    'verification_outcome'
  )),

  -- Visibility scope
  scope TEXT NOT NULL CHECK (scope IN ('workspace', 'repo', 'global')),

  -- === PROVENANCE FIELDS ===
  repo_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  task_id TEXT,
  step_id TEXT,
  agent_role TEXT NOT NULL CHECK (agent_role IN (
    'supervisor',
    'planner',
    'specialist',
    'verifier'
  )),

  -- === TRUST FIELDS ===
  confidence REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
  validated INTEGER NOT NULL DEFAULT 0 CHECK (validated IN (0, 1)),
  verifier_task_id TEXT,

  -- === DECAY FIELDS ===
  ttl INTEGER NOT NULL CHECK (ttl > 0),
  created_at TEXT NOT NULL,
  last_accessed_at TEXT,

  -- === METADATA ===
  -- Embedding dimensions (for validation)
  embedding_dimensions INTEGER NOT NULL CHECK (embedding_dimensions > 0),
  -- Provider that generated the embedding
  embedding_provider TEXT
);
`;

/**
 * SQL statements to create indexes.
 */
export const CREATE_VECTOR_MEMORY_INDEXES = [
  // Primary lookup by scope + repo (most common query pattern)
  `CREATE INDEX IF NOT EXISTS idx_vm_scope_repo
   ON vector_memory(scope, repo_id);`,

  // Workspace-scoped queries
  `CREATE INDEX IF NOT EXISTS idx_vm_workspace
   ON vector_memory(workspace_id);`,

  // Type filtering
  `CREATE INDEX IF NOT EXISTS idx_vm_type
   ON vector_memory(type);`,

  // TTL decay queries (find expired records)
  `CREATE INDEX IF NOT EXISTS idx_vm_created_at
   ON vector_memory(created_at);`,

  // Validated memory lookup
  `CREATE INDEX IF NOT EXISTS idx_vm_validated
   ON vector_memory(validated);`,

  // Agent role queries
  `CREATE INDEX IF NOT EXISTS idx_vm_agent_role
   ON vector_memory(agent_role);`
];

/**
 * SQL to create the schema_version metadata table.
 */
export const CREATE_SCHEMA_VERSION_TABLE = `
CREATE TABLE IF NOT EXISTS schema_version (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL,
  migrated_at TEXT NOT NULL
);
`;

// =============================================================================
// MIGRATION LOGIC
// =============================================================================

/**
 * Check if vector_memory table exists.
 */
export function tableExists(db: Database, tableName: string): boolean {
  const stmt = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?;`
  );
  stmt.bind([tableName]);
  const exists = stmt.step();
  stmt.free();
  return exists;
}

/**
 * Get current schema version from database.
 * Returns 0 if no version table exists.
 */
export function getSchemaVersion(db: Database): number {
  if (!tableExists(db, "schema_version")) {
    return 0;
  }

  const stmt = db.prepare(`SELECT version FROM schema_version WHERE id = 1;`);
  let version = 0;
  if (stmt.step()) {
    const row = stmt.getAsObject() as { version?: number };
    version = row.version ?? 0;
  }
  stmt.free();
  return version;
}

/**
 * Set schema version in database.
 */
export function setSchemaVersion(db: Database, version: number): void {
  db.run(CREATE_SCHEMA_VERSION_TABLE);
  db.run(
    `INSERT OR REPLACE INTO schema_version (id, version, migrated_at) VALUES (1, ?, ?);`,
    [version, new Date().toISOString()]
  );
}

/**
 * Run all migrations to bring database to current schema version.
 *
 * Migration strategy:
 * - v0 → v1: Initial schema creation
 * - Future versions: Add ALTER TABLE or new tables
 *
 * @param db - SQLite database instance
 * @returns true if migrations were applied, false if already up-to-date
 */
export function migrateVectorMemory(db: Database): boolean {
  const currentVersion = getSchemaVersion(db);

  if (currentVersion >= VECTOR_MEMORY_SCHEMA_VERSION) {
    // Already up to date
    return false;
  }

  // v0 → v1: Create initial schema
  if (currentVersion < 1) {
    db.run(CREATE_VECTOR_MEMORY_TABLE);
    for (const indexSql of CREATE_VECTOR_MEMORY_INDEXES) {
      db.run(indexSql);
    }
  }

  // Future migrations would go here:
  // if (currentVersion < 2) { ... }

  // Update version
  setSchemaVersion(db, VECTOR_MEMORY_SCHEMA_VERSION);
  return true;
}

// =============================================================================
// EMBEDDING SERIALIZATION
// =============================================================================

/**
 * Serialize a number array to a BLOB for SQLite storage.
 * Uses Float64Array for full precision.
 *
 * @param embedding - Array of numbers
 * @returns Buffer suitable for BLOB storage
 */
export function serializeEmbedding(embedding: readonly number[]): Uint8Array {
  const float64Array = new Float64Array(embedding);
  return new Uint8Array(float64Array.buffer);
}

/**
 * Deserialize a BLOB from SQLite to a number array.
 *
 * @param blob - Uint8Array from SQLite BLOB
 * @returns Array of numbers
 */
export function deserializeEmbedding(blob: Uint8Array): number[] {
  // Ensure proper alignment by copying to a new ArrayBuffer
  const buffer = new ArrayBuffer(blob.length);
  const view = new Uint8Array(buffer);
  view.set(blob);
  const float64Array = new Float64Array(buffer);
  return Array.from(float64Array);
}

// =============================================================================
// ROW MAPPING TYPES
// =============================================================================

/**
 * Raw row shape from SQLite query.
 */
export interface VectorMemoryRow {
  id: string;
  embedding: Uint8Array;
  content: string;
  type: string;
  scope: string;
  repo_id: string;
  workspace_id: string;
  task_id: string | null;
  step_id: string | null;
  agent_role: string;
  confidence: number;
  validated: number;
  verifier_task_id: string | null;
  ttl: number;
  created_at: string;
  last_accessed_at: string | null;
  embedding_dimensions: number;
  embedding_provider: string | null;
}

// =============================================================================
// SQL STATEMENTS FOR CRUD OPERATIONS
// =============================================================================

/**
 * SQL for inserting/updating a record.
 */
export const UPSERT_VECTOR_MEMORY = `
INSERT OR REPLACE INTO vector_memory (
  id, embedding, content, type, scope,
  repo_id, workspace_id, task_id, step_id, agent_role,
  confidence, validated, verifier_task_id,
  ttl, created_at, last_accessed_at,
  embedding_dimensions, embedding_provider
) VALUES (
  ?, ?, ?, ?, ?,
  ?, ?, ?, ?, ?,
  ?, ?, ?,
  ?, ?, ?,
  ?, ?
);
`;

/**
 * SQL for querying records with scope/repo filter.
 * Actual similarity scoring done in JS after fetch.
 */
export const QUERY_VECTOR_MEMORY_BASE = `
SELECT * FROM vector_memory
WHERE 1=1
`;

/**
 * SQL for counting expired records.
 */
export const COUNT_EXPIRED = `
SELECT COUNT(*) as count FROM vector_memory
WHERE datetime(created_at, '+' || (ttl / 1000) || ' seconds') < datetime(?);
`;

/**
 * SQL for deleting expired records.
 */
export const DELETE_EXPIRED = `
DELETE FROM vector_memory
WHERE datetime(created_at, '+' || (ttl / 1000) || ' seconds') < datetime(?);
`;

/**
 * SQL for updating last_accessed_at on read.
 */
export const UPDATE_LAST_ACCESSED = `
UPDATE vector_memory SET last_accessed_at = ? WHERE id = ?;
`;

/**
 * SQL for getting statistics.
 */
export const STATS_QUERIES = {
  totalRecords: `SELECT COUNT(*) as count FROM vector_memory;`,
  byType: `SELECT type, COUNT(*) as count FROM vector_memory GROUP BY type;`,
  byScope: `SELECT scope, COUNT(*) as count FROM vector_memory GROUP BY scope;`,
  validatedCount: `SELECT COUNT(*) as count FROM vector_memory WHERE validated = 1;`,
  expiredCount: (now: string) =>
    `SELECT COUNT(*) as count FROM vector_memory WHERE datetime(created_at, '+' || (ttl / 1000) || ' seconds') < datetime('${now}');`,
  averageConfidence: `SELECT AVG(confidence) as avg FROM vector_memory;`
};

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Validate that an embedding has the expected dimensions.
 */
export function validateEmbeddingDimensions(
  embedding: readonly number[],
  expectedDimensions: number
): boolean {
  return embedding.length === expectedDimensions;
}

/**
 * Validate a memory type string.
 */
export function isValidMemoryType(type: string): boolean {
  return [
    "lesson_learned",
    "error_pattern",
    "best_practice",
    "design_decision",
    "verification_outcome"
  ].includes(type);
}

/**
 * Validate a scope string.
 */
export function isValidScope(scope: string): boolean {
  return ["workspace", "repo", "global"].includes(scope);
}

/**
 * Validate a role string.
 */
export function isValidRole(role: string): boolean {
  return ["supervisor", "planner", "specialist", "verifier"].includes(role);
}
