/**
 * SQLite Vector Memory Index (VM-03)
 *
 * Implements the VectorMemoryIndex interface using SQLite for storage.
 *
 * ARCHITECTURE GUARDRAILS:
 * - Memory is ADVISORY ONLY (never commands, instructions, or capabilities)
 * - Policy approval required for writes (caller responsibility)
 * - Fail-open on query errors (return empty array)
 * - No policy logic inside this class
 * - Cosine similarity computed in JS (no SQLite extensions)
 *
 * @see info-instructions/vector-memory-index.md
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import type {
  VectorMemoryIndex,
  VectorMemoryRecord,
  MemoryQueryParams,
  MemoryQueryResult,
  MemoryStats,
  MemoryType,
  MemoryScope,
  MemoryDecay,
  MemoryProvenance,
  MemoryTrust
} from "./vectorMemoryTypes.js";
import {
  SCOPE_WEIGHTS,
  calculateRelevanceScore,
  isExpired,
  MEMORY_TYPES
} from "./vectorMemoryTypes.js";
import {
  migrateVectorMemory,
  serializeEmbedding,
  deserializeEmbedding,
  UPSERT_VECTOR_MEMORY,
  DELETE_EXPIRED,
  UPDATE_LAST_ACCESSED,
  type VectorMemoryRow
} from "./vectorMemorySchema.js";
import type { RoleType } from "../skills/types.js";

// =============================================================================
// SQL.JS INITIALIZATION HELPERS
// =============================================================================

type SqlJsBundle = {
  SQL: SqlJsStatic;
  db: Database;
};

/**
 * Attempts to locate sql-wasm.wasm in multiple candidate locations.
 */
function locateSqlWasm(filename: string): string {
  // 1. Check adjacent to the running JS file (for bundled dist/)
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const localCandidate = path.join(here, filename);
    if (fs.existsSync(localCandidate)) return localCandidate;
  } catch {
    // import.meta.url may not resolve in all contexts
  }

  // 2. Check node_modules relative to cwd
  const nodeModulesCandidate = path.resolve(
    process.cwd(),
    "node_modules",
    "sql.js",
    "dist",
    filename
  );
  if (fs.existsSync(nodeModulesCandidate)) return nodeModulesCandidate;

  // 3. Try require.resolve from this file's location
  try {
    const require = createRequire(import.meta.url);
    const resolved = require.resolve(`sql.js/dist/${filename}`);
    if (fs.existsSync(resolved)) return resolved;
  } catch {
    // May fail if sql.js is not resolvable from here
  }

  // 4. Try require.resolve from cwd (npx/global installs)
  try {
    const require = createRequire(path.join(process.cwd(), "package.json"));
    const resolved = require.resolve(`sql.js/dist/${filename}`);
    if (fs.existsSync(resolved)) return resolved;
  } catch {
    // May fail
  }

  // 5. Fallback: return the node_modules path
  return nodeModulesCandidate;
}

/**
 * Open or create a SQLite database.
 */
async function openDb(dbPath: string): Promise<SqlJsBundle> {
  const SQL = await initSqlJs({
    locateFile: (filename: string) => locateSqlWasm(filename)
  });

  if (fs.existsSync(dbPath)) {
    const bytes = fs.readFileSync(dbPath);
    const db = new SQL.Database(bytes);
    return { SQL, db };
  }

  const db = new SQL.Database();
  return { SQL, db };
}

// =============================================================================
// COSINE SIMILARITY (COMPUTED IN JS)
// =============================================================================

/**
 * Calculate cosine similarity between two vectors.
 *
 * Formula: (A · B) / (||A|| × ||B||)
 *
 * Returns value between -1 and 1 for normalized vectors.
 * We clamp to [0, 1] for relevance scoring.
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Cosine similarity clamped to [0, 1]
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const aVal = a[i]!;
    const bVal = b[i]!;
    dotProduct += aVal * bVal;
    normA += aVal * aVal;
    normB += bVal * bVal;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  const similarity = dotProduct / denominator;
  // Clamp to [0, 1] - negative similarity treated as 0 for relevance
  return Math.max(0, Math.min(1, similarity));
}

// =============================================================================
// SQLite VECTOR MEMORY INDEX IMPLEMENTATION
// =============================================================================

/**
 * Options for creating a SQLiteVectorMemoryIndex.
 */
export interface SQLiteVectorMemoryIndexOptions {
  /** Path to the SQLite database file */
  readonly dbPath: string;
  
  /** Expected embedding dimensions (for validation) */
  readonly dimensions: number;
  
  /** Embedding provider identifier (for provenance) */
  readonly providerId?: string;
}

/**
 * SQLite-backed implementation of VectorMemoryIndex.
 *
 * CRITICAL: This class does NOT enforce policy.
 * The caller MUST check policy before calling upsert().
 */
export class SQLiteVectorMemoryIndex implements VectorMemoryIndex {
  private readonly dbPath: string;
  private readonly dimensions: number;
  private readonly providerId: string;
  private bundle: SqlJsBundle | undefined;
  private _initialized = false;
  private _lastDecayRun: string | undefined;

  constructor(options: SQLiteVectorMemoryIndexOptions) {
    this.dbPath = options.dbPath;
    this.dimensions = options.dimensions;
    this.providerId = options.providerId ?? "unknown";
  }

  /**
   * Initialize the database connection and run migrations.
   */
  async init(): Promise<void> {
    if (this._initialized) return;

    const dir = path.dirname(this.dbPath);
    fs.mkdirSync(dir, { recursive: true });

    this.bundle = await openDb(this.dbPath);
    migrateVectorMemory(this.bundle.db);
    await this.flush();
    this._initialized = true;
  }

  /**
   * Flush database to disk.
   */
  private async flush(): Promise<void> {
    if (!this.bundle) return;
    const data = this.bundle.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  /**
   * Ensure database is initialized.
   */
  private ensureInitialized(): void {
    if (!this._initialized || !this.bundle) {
      throw new Error("SQLiteVectorMemoryIndex not initialized. Call init() first.");
    }
  }

  // ===========================================================================
  // VectorMemoryIndex INTERFACE IMPLEMENTATION
  // ===========================================================================

  /**
   * Insert or update a memory record.
   *
   * CRITICAL: Caller must check policy before calling this method.
   * This method does NOT enforce policy.
   */
  async upsert(record: VectorMemoryRecord): Promise<void> {
    this.ensureInitialized();

    // Validate embedding dimensions
    if (record.embedding.length !== this.dimensions) {
      throw new Error(
        `Embedding dimension mismatch: expected ${this.dimensions}, got ${record.embedding.length}`
      );
    }

    const embedding = serializeEmbedding(record.embedding);

    this.bundle!.db.run(UPSERT_VECTOR_MEMORY, [
      record.id,
      embedding,
      record.content,
      record.type,
      record.scope,
      record.provenance.repoId,
      record.provenance.workspaceId,
      record.provenance.taskId ?? null,
      record.provenance.stepId ?? null,
      record.provenance.agentRole,
      record.trust.confidence,
      record.trust.validated ? 1 : 0,
      record.trust.verifierTaskId ?? null,
      record.decay.ttl,
      record.decay.createdAt,
      record.decay.lastAccessedAt ?? null,
      this.dimensions,
      this.providerId
    ]);

    await this.flush();
  }

  /**
   * Query for similar memories.
   *
   * FAIL-OPEN: Returns empty array on any error.
   *
   * Algorithm:
   * 1. Fetch all non-expired records matching filters
   * 2. Compute cosine similarity for each
   * 3. Calculate relevance score with weighting
   * 4. Sort by relevance and return top K
   */
  async query(params: MemoryQueryParams): Promise<readonly MemoryQueryResult[]> {
    try {
      this.ensureInitialized();

      const now = new Date();
      const { embedding, topK, filters } = params;

      // Build query with filters
      let sql = `SELECT * FROM vector_memory WHERE 1=1`;
      const sqlParams: unknown[] = [];

      if (filters?.repoId) {
        sql += ` AND repo_id = ?`;
        sqlParams.push(filters.repoId);
      }

      if (filters?.workspaceId) {
        sql += ` AND workspace_id = ?`;
        sqlParams.push(filters.workspaceId);
      }

      if (filters?.scope) {
        sql += ` AND scope = ?`;
        sqlParams.push(filters.scope);
      }

      if (filters?.type && filters.type.length > 0) {
        const placeholders = filters.type.map(() => "?").join(", ");
        sql += ` AND type IN (${placeholders})`;
        sqlParams.push(...filters.type);
      }

      if (filters?.minConfidence !== undefined) {
        sql += ` AND confidence >= ?`;
        sqlParams.push(filters.minConfidence);
      }

      if (filters?.validatedOnly) {
        sql += ` AND validated = 1`;
      }

      const stmt = this.bundle!.db.prepare(sql);
      stmt.bind(sqlParams);

      const results: MemoryQueryResult[] = [];

      while (stmt.step()) {
        const row = stmt.getAsObject() as unknown as VectorMemoryRow;

        // Skip expired records (soft filter - decay() does hard removal)
        const recordDecay: MemoryDecay = {
          ttl: row.ttl,
          createdAt: row.created_at,
          ...(row.last_accessed_at != null && { lastAccessedAt: row.last_accessed_at })
        };

        if (isExpired(recordDecay, now)) {
          continue;
        }

        // Deserialize embedding and compute similarity
        const recordEmbedding = deserializeEmbedding(row.embedding);
        const similarityScore = cosineSimilarity(embedding, recordEmbedding);

        // Skip very low similarity matches (optimization)
        if (similarityScore < 0.1) {
          continue;
        }

        // Build the full record
        const provenance: MemoryProvenance = {
          repoId: row.repo_id,
          workspaceId: row.workspace_id,
          agentRole: row.agent_role as RoleType,
          ...(row.task_id != null && { taskId: row.task_id }),
          ...(row.step_id != null && { stepId: row.step_id })
        };

        const trust: MemoryTrust = {
          confidence: row.confidence,
          validated: row.validated === 1,
          ...(row.verifier_task_id != null && { verifierTaskId: row.verifier_task_id })
        };

        const record: VectorMemoryRecord = {
          id: row.id,
          embedding: recordEmbedding,
          content: row.content,
          type: row.type as MemoryType,
          scope: row.scope as MemoryScope,
          provenance,
          trust,
          decay: recordDecay
        };

        // Calculate relevance score with all weights
        const relevanceScore = calculateRelevanceScore(
          similarityScore,
          record.scope,
          record.trust,
          record.decay,
          now
        );

        results.push({
          record,
          similarityScore,
          relevanceScore
        });
      }

      stmt.free();

      // Sort by relevance score (highest first) and take top K
      results.sort((a, b) => b.relevanceScore - a.relevanceScore);
      const topResults = results.slice(0, topK);

      // Update last_accessed_at for returned records
      for (const result of topResults) {
        this.bundle!.db.run(UPDATE_LAST_ACCESSED, [
          now.toISOString(),
          result.record.id
        ]);
      }

      await this.flush();

      return topResults;
    } catch (error) {
      // FAIL-OPEN: Log error and return empty array
      console.error("[VectorMemoryIndex] Query failed (fail-open):", error);
      return [];
    }
  }

  /**
   * Remove expired records based on TTL.
   *
   * A record is eligible for removal if: now > createdAt + ttl
   */
  async decay(now: Date): Promise<number> {
    this.ensureInitialized();

    const nowIso = now.toISOString();

    // Count expired before deletion
    const countStmt = this.bundle!.db.prepare(`
      SELECT COUNT(*) as count FROM vector_memory
      WHERE datetime(created_at, '+' || (ttl / 1000) || ' seconds') < datetime(?)
    `);
    countStmt.bind([nowIso]);
    countStmt.step();
    const countRow = countStmt.getAsObject() as { count: number };
    const expiredCount = countRow.count;
    countStmt.free();

    if (expiredCount > 0) {
      this.bundle!.db.run(DELETE_EXPIRED, [nowIso]);
      await this.flush();
    }

    this._lastDecayRun = nowIso;
    return expiredCount;
  }

  /**
   * Get statistics about the memory index.
   */
  async stats(): Promise<MemoryStats> {
    this.ensureInitialized();

    const now = new Date();
    const nowIso = now.toISOString();

    // Total records
    const totalStmt = this.bundle!.db.prepare(
      `SELECT COUNT(*) as count FROM vector_memory;`
    );
    totalStmt.step();
    const totalRow = totalStmt.getAsObject() as { count: number };
    const totalRecords = totalRow.count;
    totalStmt.free();

    // By type
    const byType: Record<MemoryType, number> = {
      lesson_learned: 0,
      error_pattern: 0,
      best_practice: 0,
      design_decision: 0,
      verification_outcome: 0
    };

    const typeStmt = this.bundle!.db.prepare(
      `SELECT type, COUNT(*) as count FROM vector_memory GROUP BY type;`
    );
    while (typeStmt.step()) {
      const row = typeStmt.getAsObject() as { type: string; count: number };
      if (row.type in byType) {
        byType[row.type as MemoryType] = row.count;
      }
    }
    typeStmt.free();

    // By scope
    const byScope: Record<MemoryScope, number> = {
      workspace: 0,
      repo: 0,
      global: 0
    };

    const scopeStmt = this.bundle!.db.prepare(
      `SELECT scope, COUNT(*) as count FROM vector_memory GROUP BY scope;`
    );
    while (scopeStmt.step()) {
      const row = scopeStmt.getAsObject() as { scope: string; count: number };
      if (row.scope in byScope) {
        byScope[row.scope as MemoryScope] = row.count;
      }
    }
    scopeStmt.free();

    // Validated count
    const validatedStmt = this.bundle!.db.prepare(
      `SELECT COUNT(*) as count FROM vector_memory WHERE validated = 1;`
    );
    validatedStmt.step();
    const validatedRow = validatedStmt.getAsObject() as { count: number };
    const validatedCount = validatedRow.count;
    validatedStmt.free();

    // Expired count
    const expiredStmt = this.bundle!.db.prepare(`
      SELECT COUNT(*) as count FROM vector_memory
      WHERE datetime(created_at, '+' || (ttl / 1000) || ' seconds') < datetime(?)
    `);
    expiredStmt.bind([nowIso]);
    expiredStmt.step();
    const expiredRow = expiredStmt.getAsObject() as { count: number };
    const expiredCount = expiredRow.count;
    expiredStmt.free();

    // Average confidence
    const avgStmt = this.bundle!.db.prepare(
      `SELECT AVG(confidence) as avg FROM vector_memory;`
    );
    avgStmt.step();
    const avgRow = avgStmt.getAsObject() as { avg: number | null };
    const averageConfidence = avgRow.avg ?? 0;
    avgStmt.free();

    const stats: MemoryStats = {
      totalRecords,
      byType,
      byScope,
      validatedCount,
      expiredCount,
      averageConfidence,
      ...(this._lastDecayRun != null && { lastDecayRun: this._lastDecayRun })
    };

    return stats;
  }

  // ===========================================================================
  // ADDITIONAL METHODS
  // ===========================================================================

  /**
   * Close the database connection.
   */
  close(): void {
    if (this.bundle) {
      this.bundle.db.close();
      this.bundle = undefined;
      this._initialized = false;
    }
  }

  /**
   * Check if the index is initialized.
   */
  get isInitialized(): boolean {
    return this._initialized;
  }

  /**
   * Get the configured embedding dimensions.
   */
  get embeddingDimensions(): number {
    return this.dimensions;
  }

  /**
   * Delete a record by ID (for testing/cleanup).
   */
  async delete(id: string): Promise<boolean> {
    this.ensureInitialized();

    const beforeStmt = this.bundle!.db.prepare(
      `SELECT COUNT(*) as count FROM vector_memory WHERE id = ?;`
    );
    beforeStmt.bind([id]);
    beforeStmt.step();
    const beforeRow = beforeStmt.getAsObject() as { count: number };
    const existed = beforeRow.count > 0;
    beforeStmt.free();

    if (existed) {
      this.bundle!.db.run(`DELETE FROM vector_memory WHERE id = ?;`, [id]);
      await this.flush();
    }

    return existed;
  }

  /**
   * Get a record by ID (for testing).
   */
  async get(id: string): Promise<VectorMemoryRecord | undefined> {
    this.ensureInitialized();

    const stmt = this.bundle!.db.prepare(
      `SELECT * FROM vector_memory WHERE id = ?;`
    );
    stmt.bind([id]);

    if (!stmt.step()) {
      stmt.free();
      return undefined;
    }

    const row = stmt.getAsObject() as unknown as VectorMemoryRow;
    stmt.free();

    const recordEmbedding = deserializeEmbedding(row.embedding);

    const provenance: MemoryProvenance = {
      repoId: row.repo_id,
      workspaceId: row.workspace_id,
      agentRole: row.agent_role as RoleType,
      ...(row.task_id != null && { taskId: row.task_id }),
      ...(row.step_id != null && { stepId: row.step_id })
    };

    const trust: MemoryTrust = {
      confidence: row.confidence,
      validated: row.validated === 1,
      ...(row.verifier_task_id != null && { verifierTaskId: row.verifier_task_id })
    };

    const decay: MemoryDecay = {
      ttl: row.ttl,
      createdAt: row.created_at,
      ...(row.last_accessed_at != null && { lastAccessedAt: row.last_accessed_at })
    };

    return {
      id: row.id,
      embedding: recordEmbedding,
      content: row.content,
      type: row.type as MemoryType,
      scope: row.scope as MemoryScope,
      provenance,
      trust,
      decay
    };
  }
}
