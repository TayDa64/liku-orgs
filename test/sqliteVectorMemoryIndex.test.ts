/**
 * SQLiteVectorMemoryIndex tests (VM-03)
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SQLiteVectorMemoryIndex,
  cosineSimilarity
} from "../src/liku/memory/sqliteVectorMemoryIndex.js";
import type {
  VectorMemoryRecord,
  MemoryQueryParams
} from "../src/liku/memory/vectorMemoryTypes.js";

// =============================================================================
// TEST HELPERS
// =============================================================================

function createTempDbPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "liku-vector-test-"));
  return path.join(tmpDir, "test-vector-memory.db");
}

function cleanupTempDb(dbPath: string): void {
  const dir = path.dirname(dbPath);
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors
  }
}

const DIMENSIONS = 4;

function createTestEmbedding(values: number[]): readonly number[] {
  if (values.length !== DIMENSIONS) {
    throw new Error(`Expected ${DIMENSIONS} dimensions, got ${values.length}`);
  }
  return values;
}

function createTestRecord(overrides: Partial<VectorMemoryRecord> = {}): VectorMemoryRecord {
  return {
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    embedding: createTestEmbedding([0.5, 0.5, 0.5, 0.5]),
    content: "Test memory content",
    type: "lesson_learned",
    scope: "workspace",
    provenance: {
      repoId: "test-repo",
      workspaceId: "test-workspace",
      agentRole: "specialist"
    },
    trust: {
      confidence: 0.8,
      validated: false
    },
    decay: {
      ttl: 86400000, // 24 hours
      createdAt: new Date().toISOString()
    },
    ...overrides
  };
}

// =============================================================================
// COSINE SIMILARITY TESTS
// =============================================================================

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const v = [0.5, 0.5, 0.5, 0.5];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    const a = [1, 0, 0, 0];
    const b = [0, 1, 0, 0];
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it("returns 0 for opposite vectors (clamped from -1)", () => {
    const a = [1, 0, 0, 0];
    const b = [-1, 0, 0, 0];
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it("returns high similarity for similar vectors", () => {
    const a = [0.9, 0.1, 0.0, 0.0];
    const b = [0.8, 0.2, 0.0, 0.0];
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.9);
  });

  it("handles normalized unit vectors", () => {
    const a = [1 / Math.sqrt(2), 1 / Math.sqrt(2), 0, 0];
    const b = [1 / Math.sqrt(2), 1 / Math.sqrt(2), 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1);
  });

  it("returns 0 for empty vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("returns 0 for mismatched dimensions", () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
  });

  it("returns 0 for zero vectors", () => {
    expect(cosineSimilarity([0, 0, 0, 0], [0, 0, 0, 0])).toBe(0);
  });

  it("returns 0 when one vector is zero", () => {
    expect(cosineSimilarity([1, 0, 0, 0], [0, 0, 0, 0])).toBe(0);
  });
});

// =============================================================================
// SQLiteVectorMemoryIndex INITIALIZATION TESTS
// =============================================================================

describe("SQLiteVectorMemoryIndex", () => {
  let dbPath: string;
  let index: SQLiteVectorMemoryIndex;

  beforeEach(() => {
    dbPath = createTempDbPath();
    index = new SQLiteVectorMemoryIndex({
      dbPath,
      dimensions: DIMENSIONS,
      providerId: "test-provider"
    });
  });

  afterEach(() => {
    try {
      index.close();
    } catch {
      // Ignore
    }
    cleanupTempDb(dbPath);
  });

  describe("initialization", () => {
    it("creates database file on init", async () => {
      expect(fs.existsSync(dbPath)).toBe(false);
      await index.init();
      expect(fs.existsSync(dbPath)).toBe(true);
    });

    it("can be initialized only once", async () => {
      await index.init();
      expect(index.isInitialized).toBe(true);
      await index.init(); // Should not throw
      expect(index.isInitialized).toBe(true);
    });

    it("creates parent directories", async () => {
      const nestedPath = path.join(dbPath, "..", "nested", "dir", "db.sqlite");
      const nestedIndex = new SQLiteVectorMemoryIndex({
        dbPath: nestedPath,
        dimensions: DIMENSIONS
      });

      await nestedIndex.init();
      expect(fs.existsSync(nestedPath)).toBe(true);
      nestedIndex.close();
      cleanupTempDb(nestedPath);
    });

    it("reports correct embedding dimensions", () => {
      expect(index.embeddingDimensions).toBe(DIMENSIONS);
    });

    it("throws on operations before init", async () => {
      const record = createTestRecord();
      await expect(index.upsert(record)).rejects.toThrow("not initialized");
    });
  });

  // ===========================================================================
  // UPSERT TESTS
  // ===========================================================================

  describe("upsert", () => {
    beforeEach(async () => {
      await index.init();
    });

    it("inserts a new record", async () => {
      const record = createTestRecord({ id: "insert-test" });
      await index.upsert(record);

      const retrieved = await index.get("insert-test");
      expect(retrieved).toBeDefined();
      expect(retrieved!.content).toBe(record.content);
    });

    it("updates an existing record", async () => {
      const record = createTestRecord({ id: "update-test" });
      await index.upsert(record);

      const updated = { ...record, content: "Updated content" };
      await index.upsert(updated);

      const retrieved = await index.get("update-test");
      expect(retrieved!.content).toBe("Updated content");
    });

    it("preserves embedding with full precision", async () => {
      const embedding = createTestEmbedding([0.123456789, 0.987654321, 0.111111111, 0.999999999]);
      const record = createTestRecord({ id: "precision-test", embedding });
      await index.upsert(record);

      const retrieved = await index.get("precision-test");
      expect(retrieved!.embedding[0]).toBeCloseTo(0.123456789, 9);
      expect(retrieved!.embedding[1]).toBeCloseTo(0.987654321, 9);
    });

    it("rejects wrong embedding dimensions", async () => {
      const record = createTestRecord({
        embedding: [0.5, 0.5] as readonly number[] // Wrong dimensions
      });

      await expect(index.upsert(record)).rejects.toThrow("dimension mismatch");
    });

    it("stores all provenance fields", async () => {
      const record = createTestRecord({
        id: "provenance-test",
        provenance: {
          repoId: "my-repo",
          workspaceId: "my-workspace",
          taskId: "task-123",
          stepId: "step-456",
          agentRole: "planner"
        }
      });
      await index.upsert(record);

      const retrieved = await index.get("provenance-test");
      expect(retrieved!.provenance.repoId).toBe("my-repo");
      expect(retrieved!.provenance.workspaceId).toBe("my-workspace");
      expect(retrieved!.provenance.taskId).toBe("task-123");
      expect(retrieved!.provenance.stepId).toBe("step-456");
      expect(retrieved!.provenance.agentRole).toBe("planner");
    });

    it("stores all trust fields", async () => {
      const record = createTestRecord({
        id: "trust-test",
        trust: {
          confidence: 0.95,
          validated: true,
          verifierTaskId: "verifier-789"
        }
      });
      await index.upsert(record);

      const retrieved = await index.get("trust-test");
      expect(retrieved!.trust.confidence).toBe(0.95);
      expect(retrieved!.trust.validated).toBe(true);
      expect(retrieved!.trust.verifierTaskId).toBe("verifier-789");
    });

    it("handles optional fields being absent", async () => {
      const record = createTestRecord({
        id: "optional-test",
        provenance: {
          repoId: "repo",
          workspaceId: "workspace",
          agentRole: "specialist"
          // No taskId, stepId
        },
        trust: {
          confidence: 0.5,
          validated: false
          // No verifierTaskId
        },
        decay: {
          ttl: 1000,
          createdAt: new Date().toISOString()
          // No lastAccessedAt
        }
      });
      await index.upsert(record);

      const retrieved = await index.get("optional-test");
      expect(retrieved!.provenance.taskId).toBeUndefined();
      expect(retrieved!.trust.verifierTaskId).toBeUndefined();
      expect(retrieved!.decay.lastAccessedAt).toBeUndefined();
    });
  });

  // ===========================================================================
  // QUERY TESTS
  // ===========================================================================

  describe("query", () => {
    beforeEach(async () => {
      await index.init();
    });

    it("returns empty array when no records exist", async () => {
      const results = await index.query({
        embedding: createTestEmbedding([0.5, 0.5, 0.5, 0.5]),
        topK: 10
      });
      expect(results).toEqual([]);
    });

    it("finds similar records", async () => {
      // Insert a record
      const record = createTestRecord({
        id: "similar-test",
        embedding: createTestEmbedding([0.9, 0.1, 0.0, 0.0])
      });
      await index.upsert(record);

      // Query with similar embedding
      const results = await index.query({
        embedding: createTestEmbedding([0.8, 0.2, 0.0, 0.0]),
        topK: 5
      });

      expect(results.length).toBe(1);
      expect(results[0]!.record.id).toBe("similar-test");
      expect(results[0]!.similarityScore).toBeGreaterThan(0.9);
    });

    it("returns results sorted by relevance score", async () => {
      // Insert records with different similarities
      const records = [
        createTestRecord({
          id: "far",
          embedding: createTestEmbedding([0.1, 0.9, 0.0, 0.0])
        }),
        createTestRecord({
          id: "close",
          embedding: createTestEmbedding([0.9, 0.1, 0.0, 0.0])
        }),
        createTestRecord({
          id: "medium",
          embedding: createTestEmbedding([0.5, 0.5, 0.0, 0.0])
        })
      ];

      for (const r of records) {
        await index.upsert(r);
      }

      // Query
      const results = await index.query({
        embedding: createTestEmbedding([1.0, 0.0, 0.0, 0.0]),
        topK: 10
      });

      expect(results.length).toBe(3);
      expect(results[0]!.record.id).toBe("close");
      expect(results[1]!.record.id).toBe("medium");
      expect(results[2]!.record.id).toBe("far");
    });

    it("respects topK limit", async () => {
      // Insert 5 records
      for (let i = 0; i < 5; i++) {
        await index.upsert(
          createTestRecord({
            id: `topk-${i}`,
            embedding: createTestEmbedding([0.5 + i * 0.1, 0.5 - i * 0.1, 0, 0])
          })
        );
      }

      const results = await index.query({
        embedding: createTestEmbedding([0.5, 0.5, 0, 0]),
        topK: 2
      });

      expect(results.length).toBe(2);
    });

    it("filters by repoId", async () => {
      await index.upsert(
        createTestRecord({
          id: "repo-a",
          provenance: { repoId: "repo-a", workspaceId: "ws", agentRole: "specialist" }
        })
      );
      await index.upsert(
        createTestRecord({
          id: "repo-b",
          provenance: { repoId: "repo-b", workspaceId: "ws", agentRole: "specialist" }
        })
      );

      const results = await index.query({
        embedding: createTestEmbedding([0.5, 0.5, 0.5, 0.5]),
        topK: 10,
        filters: { repoId: "repo-a" }
      });

      expect(results.length).toBe(1);
      expect(results[0]!.record.provenance.repoId).toBe("repo-a");
    });

    it("filters by workspaceId", async () => {
      await index.upsert(
        createTestRecord({
          id: "ws-a",
          provenance: { repoId: "repo", workspaceId: "ws-a", agentRole: "specialist" }
        })
      );
      await index.upsert(
        createTestRecord({
          id: "ws-b",
          provenance: { repoId: "repo", workspaceId: "ws-b", agentRole: "specialist" }
        })
      );

      const results = await index.query({
        embedding: createTestEmbedding([0.5, 0.5, 0.5, 0.5]),
        topK: 10,
        filters: { workspaceId: "ws-b" }
      });

      expect(results.length).toBe(1);
      expect(results[0]!.record.provenance.workspaceId).toBe("ws-b");
    });

    it("filters by scope", async () => {
      await index.upsert(createTestRecord({ id: "scope-ws", scope: "workspace" }));
      await index.upsert(createTestRecord({ id: "scope-repo", scope: "repo" }));
      await index.upsert(createTestRecord({ id: "scope-global", scope: "global" }));

      const results = await index.query({
        embedding: createTestEmbedding([0.5, 0.5, 0.5, 0.5]),
        topK: 10,
        filters: { scope: "global" }
      });

      expect(results.length).toBe(1);
      expect(results[0]!.record.scope).toBe("global");
    });

    it("filters by type (single)", async () => {
      await index.upsert(createTestRecord({ id: "type-lesson", type: "lesson_learned" }));
      await index.upsert(createTestRecord({ id: "type-error", type: "error_pattern" }));
      await index.upsert(createTestRecord({ id: "type-practice", type: "best_practice" }));

      const results = await index.query({
        embedding: createTestEmbedding([0.5, 0.5, 0.5, 0.5]),
        topK: 10,
        filters: { type: ["error_pattern"] }
      });

      expect(results.length).toBe(1);
      expect(results[0]!.record.type).toBe("error_pattern");
    });

    it("filters by type (multiple)", async () => {
      await index.upsert(createTestRecord({ id: "type-lesson", type: "lesson_learned" }));
      await index.upsert(createTestRecord({ id: "type-error", type: "error_pattern" }));
      await index.upsert(createTestRecord({ id: "type-practice", type: "best_practice" }));

      const results = await index.query({
        embedding: createTestEmbedding([0.5, 0.5, 0.5, 0.5]),
        topK: 10,
        filters: { type: ["lesson_learned", "best_practice"] }
      });

      expect(results.length).toBe(2);
      const types = results.map((r) => r.record.type);
      expect(types).toContain("lesson_learned");
      expect(types).toContain("best_practice");
    });

    it("filters by minConfidence", async () => {
      await index.upsert(
        createTestRecord({
          id: "conf-low",
          trust: { confidence: 0.3, validated: false }
        })
      );
      await index.upsert(
        createTestRecord({
          id: "conf-high",
          trust: { confidence: 0.9, validated: false }
        })
      );

      const results = await index.query({
        embedding: createTestEmbedding([0.5, 0.5, 0.5, 0.5]),
        topK: 10,
        filters: { minConfidence: 0.5 }
      });

      expect(results.length).toBe(1);
      expect(results[0]!.record.trust.confidence).toBe(0.9);
    });

    it("filters by validatedOnly", async () => {
      await index.upsert(
        createTestRecord({
          id: "not-validated",
          trust: { confidence: 0.9, validated: false }
        })
      );
      await index.upsert(
        createTestRecord({
          id: "validated",
          trust: { confidence: 0.5, validated: true }
        })
      );

      const results = await index.query({
        embedding: createTestEmbedding([0.5, 0.5, 0.5, 0.5]),
        topK: 10,
        filters: { validatedOnly: true }
      });

      expect(results.length).toBe(1);
      expect(results[0]!.record.trust.validated).toBe(true);
    });

    it("combines multiple filters", async () => {
      await index.upsert(
        createTestRecord({
          id: "match",
          type: "error_pattern",
          scope: "workspace",
          provenance: { repoId: "target", workspaceId: "ws", agentRole: "specialist" },
          trust: { confidence: 0.9, validated: true }
        })
      );
      await index.upsert(
        createTestRecord({
          id: "wrong-type",
          type: "lesson_learned",
          scope: "workspace",
          provenance: { repoId: "target", workspaceId: "ws", agentRole: "specialist" },
          trust: { confidence: 0.9, validated: true }
        })
      );
      await index.upsert(
        createTestRecord({
          id: "wrong-repo",
          type: "error_pattern",
          scope: "workspace",
          provenance: { repoId: "other", workspaceId: "ws", agentRole: "specialist" },
          trust: { confidence: 0.9, validated: true }
        })
      );

      const results = await index.query({
        embedding: createTestEmbedding([0.5, 0.5, 0.5, 0.5]),
        topK: 10,
        filters: {
          repoId: "target",
          type: ["error_pattern"],
          validatedOnly: true
        }
      });

      expect(results.length).toBe(1);
      expect(results[0]!.record.id).toBe("match");
    });

    it("excludes expired records", async () => {
      const now = new Date();
      const past = new Date(now.getTime() - 100000);

      await index.upsert(
        createTestRecord({
          id: "expired",
          decay: {
            ttl: 1000, // 1 second TTL
            createdAt: past.toISOString() // Created in past
          }
        })
      );
      await index.upsert(
        createTestRecord({
          id: "active",
          decay: {
            ttl: 86400000, // 24 hour TTL
            createdAt: now.toISOString()
          }
        })
      );

      const results = await index.query({
        embedding: createTestEmbedding([0.5, 0.5, 0.5, 0.5]),
        topK: 10
      });

      expect(results.length).toBe(1);
      expect(results[0]!.record.id).toBe("active");
    });

    it("excludes very low similarity records (< 0.1)", async () => {
      await index.upsert(
        createTestRecord({
          id: "orthogonal",
          embedding: createTestEmbedding([0, 0, 1, 0])
        })
      );

      const results = await index.query({
        embedding: createTestEmbedding([1, 0, 0, 0]),
        topK: 10
      });

      expect(results.length).toBe(0);
    });

    it("fails open on error (returns empty array)", async () => {
      // Close database to cause error
      index.close();

      const results = await index.query({
        embedding: createTestEmbedding([0.5, 0.5, 0.5, 0.5]),
        topK: 10
      });

      expect(results).toEqual([]);
    });

    it("calculates relevance score with scope weighting", async () => {
      // Insert records with different scopes but same similarity
      await index.upsert(
        createTestRecord({
          id: "global-scope",
          scope: "global",
          embedding: createTestEmbedding([0.9, 0.1, 0.0, 0.0])
        })
      );
      await index.upsert(
        createTestRecord({
          id: "workspace-scope",
          scope: "workspace",
          embedding: createTestEmbedding([0.9, 0.1, 0.0, 0.0])
        })
      );

      const results = await index.query({
        embedding: createTestEmbedding([0.9, 0.1, 0.0, 0.0]),
        topK: 10
      });

      // Workspace should rank higher due to scope weight
      expect(results[0]!.record.scope).toBe("workspace");
      expect(results[0]!.relevanceScore).toBeGreaterThan(results[1]!.relevanceScore);
    });
  });

  // ===========================================================================
  // DECAY TESTS
  // ===========================================================================

  describe("decay", () => {
    beforeEach(async () => {
      await index.init();
    });

    it("removes expired records", async () => {
      const now = new Date();
      const oldTime = new Date(now.getTime() - 86400000 * 2); // 2 days ago

      await index.upsert(
        createTestRecord({
          id: "expired",
          decay: {
            ttl: 86400000, // 1 day TTL
            createdAt: oldTime.toISOString()
          }
        })
      );
      await index.upsert(
        createTestRecord({
          id: "fresh",
          decay: {
            ttl: 86400000,
            createdAt: now.toISOString()
          }
        })
      );

      const removed = await index.decay(now);
      expect(removed).toBe(1);

      const expired = await index.get("expired");
      const fresh = await index.get("fresh");
      expect(expired).toBeUndefined();
      expect(fresh).toBeDefined();
    });

    it("returns count of removed records", async () => {
      const now = new Date();
      const oldTime = new Date(now.getTime() - 100000);

      for (let i = 0; i < 5; i++) {
        await index.upsert(
          createTestRecord({
            id: `expired-${i}`,
            decay: {
              ttl: 1000,
              createdAt: oldTime.toISOString()
            }
          })
        );
      }

      const removed = await index.decay(now);
      expect(removed).toBe(5);
    });

    it("returns 0 when no records expired", async () => {
      const now = new Date();

      await index.upsert(
        createTestRecord({
          id: "fresh",
          decay: {
            ttl: 86400000,
            createdAt: now.toISOString()
          }
        })
      );

      const removed = await index.decay(now);
      expect(removed).toBe(0);
    });

    it("updates lastDecayRun in stats", async () => {
      const now = new Date();
      await index.decay(now);

      const stats = await index.stats();
      expect(stats.lastDecayRun).toBe(now.toISOString());
    });
  });

  // ===========================================================================
  // STATS TESTS
  // ===========================================================================

  describe("stats", () => {
    beforeEach(async () => {
      await index.init();
    });

    it("returns zero stats for empty database", async () => {
      const stats = await index.stats();
      expect(stats.totalRecords).toBe(0);
      expect(stats.validatedCount).toBe(0);
      expect(stats.expiredCount).toBe(0);
      expect(stats.averageConfidence).toBe(0);
    });

    it("counts total records", async () => {
      for (let i = 0; i < 3; i++) {
        await index.upsert(createTestRecord({ id: `stat-${i}` }));
      }

      const stats = await index.stats();
      expect(stats.totalRecords).toBe(3);
    });

    it("counts records by type", async () => {
      await index.upsert(createTestRecord({ id: "t1", type: "lesson_learned" }));
      await index.upsert(createTestRecord({ id: "t2", type: "lesson_learned" }));
      await index.upsert(createTestRecord({ id: "t3", type: "error_pattern" }));
      await index.upsert(createTestRecord({ id: "t4", type: "best_practice" }));

      const stats = await index.stats();
      expect(stats.byType.lesson_learned).toBe(2);
      expect(stats.byType.error_pattern).toBe(1);
      expect(stats.byType.best_practice).toBe(1);
      expect(stats.byType.design_decision).toBe(0);
      expect(stats.byType.verification_outcome).toBe(0);
    });

    it("counts records by scope", async () => {
      await index.upsert(createTestRecord({ id: "s1", scope: "workspace" }));
      await index.upsert(createTestRecord({ id: "s2", scope: "workspace" }));
      await index.upsert(createTestRecord({ id: "s3", scope: "repo" }));
      await index.upsert(createTestRecord({ id: "s4", scope: "global" }));

      const stats = await index.stats();
      expect(stats.byScope.workspace).toBe(2);
      expect(stats.byScope.repo).toBe(1);
      expect(stats.byScope.global).toBe(1);
    });

    it("counts validated records", async () => {
      await index.upsert(
        createTestRecord({
          id: "v1",
          trust: { confidence: 0.9, validated: true }
        })
      );
      await index.upsert(
        createTestRecord({
          id: "v2",
          trust: { confidence: 0.5, validated: false }
        })
      );
      await index.upsert(
        createTestRecord({
          id: "v3",
          trust: { confidence: 0.8, validated: true }
        })
      );

      const stats = await index.stats();
      expect(stats.validatedCount).toBe(2);
    });

    it("counts expired records", async () => {
      const now = new Date();
      const oldTime = new Date(now.getTime() - 100000);

      await index.upsert(
        createTestRecord({
          id: "exp1",
          decay: { ttl: 1000, createdAt: oldTime.toISOString() }
        })
      );
      await index.upsert(
        createTestRecord({
          id: "fresh",
          decay: { ttl: 86400000, createdAt: now.toISOString() }
        })
      );

      const stats = await index.stats();
      expect(stats.expiredCount).toBe(1);
    });

    it("calculates average confidence", async () => {
      await index.upsert(
        createTestRecord({
          id: "c1",
          trust: { confidence: 0.2, validated: false }
        })
      );
      await index.upsert(
        createTestRecord({
          id: "c2",
          trust: { confidence: 0.4, validated: false }
        })
      );
      await index.upsert(
        createTestRecord({
          id: "c3",
          trust: { confidence: 0.9, validated: false }
        })
      );

      const stats = await index.stats();
      expect(stats.averageConfidence).toBeCloseTo(0.5, 1);
    });
  });

  // ===========================================================================
  // DELETE TESTS
  // ===========================================================================

  describe("delete", () => {
    beforeEach(async () => {
      await index.init();
    });

    it("deletes existing record", async () => {
      await index.upsert(createTestRecord({ id: "delete-me" }));
      const existed = await index.delete("delete-me");

      expect(existed).toBe(true);
      expect(await index.get("delete-me")).toBeUndefined();
    });

    it("returns false for non-existent record", async () => {
      const existed = await index.delete("non-existent");
      expect(existed).toBe(false);
    });
  });

  // ===========================================================================
  // PERSISTENCE TESTS
  // ===========================================================================

  describe("persistence", () => {
    it("persists data across reopens", async () => {
      await index.init();
      await index.upsert(
        createTestRecord({ id: "persist-test", content: "Persisted content" })
      );
      index.close();

      // Reopen with new instance
      const index2 = new SQLiteVectorMemoryIndex({
        dbPath,
        dimensions: DIMENSIONS
      });
      await index2.init();

      const retrieved = await index2.get("persist-test");
      expect(retrieved).toBeDefined();
      expect(retrieved!.content).toBe("Persisted content");

      index2.close();
    });

    it("loads existing database", async () => {
      // Create first instance and add data
      await index.init();
      for (let i = 0; i < 3; i++) {
        await index.upsert(createTestRecord({ id: `persist-${i}` }));
      }
      index.close();

      // Reopen
      const index2 = new SQLiteVectorMemoryIndex({
        dbPath,
        dimensions: DIMENSIONS
      });
      await index2.init();

      const stats = await index2.stats();
      expect(stats.totalRecords).toBe(3);

      index2.close();
    });
  });

  // ===========================================================================
  // CLOSE TESTS
  // ===========================================================================

  describe("close", () => {
    it("marks index as not initialized", async () => {
      await index.init();
      expect(index.isInitialized).toBe(true);

      index.close();
      expect(index.isInitialized).toBe(false);
    });

    it("can be closed multiple times safely", async () => {
      await index.init();
      index.close();
      index.close(); // Should not throw
      expect(index.isInitialized).toBe(false);
    });

    it("can be reinitialized after close", async () => {
      await index.init();
      await index.upsert(createTestRecord({ id: "reinit" }));
      index.close();

      await index.init();
      const retrieved = await index.get("reinit");
      expect(retrieved).toBeDefined();
    });
  });
});
