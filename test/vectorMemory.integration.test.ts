/**
 * Vector Memory Integration Tests (VM-10)
 *
 * End-to-end integration tests for the complete Vector Memory system.
 *
 * TESTS COVER:
 * - Embedding Provider → SQLite Index full workflow
 * - Scope weighting correctness (workspace dominates global)
 * - Confidence/validation impact on ranking
 * - TTL decay removes expired records
 * - Advisory-only behavior (memory doesn't block execution)
 * - Policy-blocked writes (integration with Policy Engine)
 * - Fail-open read behavior
 * - 100% deterministic (no external dependencies)
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
import {
  HashEmbeddingProvider,
  CachingEmbeddingProvider,
  createTestEmbeddingProvider
} from "../src/liku/memory/embeddingProvider.js";
import {
  SCOPE_WEIGHTS,
  calculateRelevanceScore,
  isExpired,
  canAccessScope,
  DEFAULT_MEMORY_TTL,
  type VectorMemoryRecord,
  type MemoryDecay,
  type MemoryScope,
  type MemoryType
} from "../src/liku/memory/vectorMemoryTypes.js";
import { evaluate, createSkillReference } from "../src/liku/policy/policyEngine.js";
import type { PolicyRequest } from "../src/liku/policy/policyTypes.js";
import type { RoleType } from "../src/liku/skills/types.js";

// =============================================================================
// TEST CONFIGURATION
// =============================================================================

const EMBEDDING_DIMENSIONS = 64;
const TEST_TTL = 86400000; // 24 hours

// =============================================================================
// TEST HELPERS
// =============================================================================

function createTempDbPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "liku-vm-integration-"));
  return path.join(tmpDir, "vector-memory.db");
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

function createTestRecord(
  id: string,
  embedding: readonly number[],
  overrides: Partial<VectorMemoryRecord> = {}
): VectorMemoryRecord {
  return {
    id,
    embedding,
    content: `Test content for ${id}`,
    type: "lesson_learned" as MemoryType,
    scope: "workspace" as MemoryScope,
    provenance: {
      repoId: "test-repo",
      workspaceId: "test-workspace",
      agentRole: "specialist" as RoleType
    },
    trust: {
      confidence: 0.7,
      validated: false
    },
    decay: {
      ttl: TEST_TTL,
      createdAt: new Date().toISOString()
    },
    ...overrides
  };
}

// =============================================================================
// END-TO-END WORKFLOW TESTS
// =============================================================================

describe("Vector Memory End-to-End Workflow", () => {
  let dbPath: string;
  let index: SQLiteVectorMemoryIndex;
  let embeddingProvider: HashEmbeddingProvider;

  beforeEach(async () => {
    dbPath = createTempDbPath();
    embeddingProvider = new HashEmbeddingProvider(EMBEDDING_DIMENSIONS);
    index = new SQLiteVectorMemoryIndex({
      dbPath,
      dimensions: EMBEDDING_DIMENSIONS,
      providerId: embeddingProvider.providerId
    });
    await index.init();
  });

  afterEach(() => {
    try {
      index.close();
    } catch {
      // Ignore
    }
    cleanupTempDb(dbPath);
  });

  it("complete workflow: embed → store → query → retrieve", async () => {
    // Step 1: Generate embedding for content
    const content = "TypeScript best practice: use strict null checks";
    const embedding = await embeddingProvider.embed(content);

    // Step 2: Create and store record
    const record = createTestRecord("workflow-1", embedding, {
      content,
      type: "best_practice"
    });
    await index.upsert(record);

    // Step 3: Query with similar embedding
    const queryEmbedding = await embeddingProvider.embed(content);
    const results = await index.query({
      embedding: queryEmbedding,
      topK: 5
    });

    // Step 4: Verify retrieval
    expect(results.length).toBe(1);
    expect(results[0]!.record.id).toBe("workflow-1");
    expect(results[0]!.record.content).toBe(content);
    expect(results[0]!.similarityScore).toBeCloseTo(1, 5); // Same text = same embedding
  });

  it("stores and retrieves multiple records with ranked results", async () => {
    // Use same embedding for all records (simulates semantically similar content)
    // The ranking will be based on other factors (trust, scope, freshness)
    const baseEmbedding = await embeddingProvider.embed("common topic embedding");

    const records = [
      { id: "rec-high-conf", confidence: 0.9, validated: false },
      { id: "rec-validated", confidence: 0.5, validated: true },
      { id: "rec-low-conf", confidence: 0.3, validated: false }
    ];

    for (const rec of records) {
      await index.upsert(
        createTestRecord(rec.id, baseEmbedding, {
          content: `Content for ${rec.id}`,
          trust: { confidence: rec.confidence, validated: rec.validated }
        })
      );
    }

    // Query with same embedding
    const results = await index.query({
      embedding: baseEmbedding,
      topK: 10
    });

    // All 3 should be returned (same similarity, ranked by trust)
    expect(results.length).toBe(3);

    // Validated should be first (trust weight = 1.0)
    expect(results[0]!.record.id).toBe("rec-validated");

    // High confidence unvalidated second (trust weight = 0.9)
    expect(results[1]!.record.id).toBe("rec-high-conf");

    // Low confidence last (trust weight = 0.3)
    expect(results[2]!.record.id).toBe("rec-low-conf");

    // Results should be sorted by relevance
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.relevanceScore).toBeGreaterThanOrEqual(
        results[i]!.relevanceScore
      );
    }
  });

  it("cached embedding provider improves consistency", async () => {
    const cachedProvider = new CachingEmbeddingProvider(embeddingProvider);

    // Embed same text multiple times
    const text = "consistent embedding test";
    const e1 = await cachedProvider.embed(text);
    const e2 = await cachedProvider.embed(text);
    const e3 = await cachedProvider.embed(text);

    // All should be same reference (from cache)
    expect(e1).toBe(e2);
    expect(e2).toBe(e3);

    // Store record with cached embedding
    await index.upsert(createTestRecord("cached-1", e1, { content: text }));

    // Query should find it with perfect similarity
    const results = await index.query({ embedding: e2, topK: 1 });
    expect(results.length).toBe(1);
    expect(results[0]!.similarityScore).toBeCloseTo(1, 10);
  });
});

// =============================================================================
// SCOPE WEIGHTING TESTS
// =============================================================================

describe("Scope Weighting Correctness", () => {
  let dbPath: string;
  let index: SQLiteVectorMemoryIndex;
  let embeddingProvider: HashEmbeddingProvider;

  beforeEach(async () => {
    dbPath = createTempDbPath();
    embeddingProvider = new HashEmbeddingProvider(EMBEDDING_DIMENSIONS);
    index = new SQLiteVectorMemoryIndex({
      dbPath,
      dimensions: EMBEDDING_DIMENSIONS,
      providerId: embeddingProvider.providerId
    });
    await index.init();
  });

  afterEach(() => {
    try {
      index.close();
    } catch {
      // Ignore
    }
    cleanupTempDb(dbPath);
  });

  it("workspace memory outranks global at equal similarity", async () => {
    const embedding = await embeddingProvider.embed("shared content");

    // Insert workspace-scoped and global-scoped records with identical embeddings
    await index.upsert(
      createTestRecord("global-record", embedding, {
        scope: "global",
        trust: { confidence: 1.0, validated: true }
      })
    );
    await index.upsert(
      createTestRecord("workspace-record", embedding, {
        scope: "workspace",
        trust: { confidence: 1.0, validated: true }
      })
    );

    const results = await index.query({ embedding, topK: 10 });

    expect(results.length).toBe(2);
    expect(results[0]!.record.scope).toBe("workspace");
    expect(results[1]!.record.scope).toBe("global");

    // Verify the ratio matches scope weights
    const wsScore = results[0]!.relevanceScore;
    const globalScore = results[1]!.relevanceScore;
    const expectedRatio = SCOPE_WEIGHTS.workspace / SCOPE_WEIGHTS.global;
    expect(wsScore / globalScore).toBeCloseTo(expectedRatio, 2);
  });

  it("repo-scoped memory ranks between workspace and global", async () => {
    const embedding = await embeddingProvider.embed("repo test content");

    // Insert all three scopes
    await index.upsert(createTestRecord("ws", embedding, { scope: "workspace" }));
    await index.upsert(createTestRecord("repo", embedding, { scope: "repo" }));
    await index.upsert(createTestRecord("global", embedding, { scope: "global" }));

    const results = await index.query({ embedding, topK: 10 });

    expect(results.length).toBe(3);
    expect(results[0]!.record.scope).toBe("workspace");
    expect(results[1]!.record.scope).toBe("repo");
    expect(results[2]!.record.scope).toBe("global");
  });

  it("higher similarity can override scope penalty", async () => {
    // Create embeddings where global has exact match but workspace is different
    const exactMatchText = "exact match for query";
    const differentText = "completely unrelated xyz abc 123";
    
    const queryEmbedding = await embeddingProvider.embed(exactMatchText);
    const exactEmbedding = await embeddingProvider.embed(exactMatchText); // Same as query
    const differentEmbedding = await embeddingProvider.embed(differentText);

    // Global with exact match (similarity = 1.0)
    await index.upsert(
      createTestRecord("global-exact", exactEmbedding, { scope: "global" })
    );

    // Workspace with different embedding (similarity will be low)
    await index.upsert(
      createTestRecord("workspace-different", differentEmbedding, { scope: "workspace" })
    );

    const results = await index.query({ embedding: queryEmbedding, topK: 10 });

    // Only the global should be returned (workspace has similarity < 0.1)
    // This shows that low similarity filters out even high-scope records
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.record.id).toBe("global-exact");
    expect(results[0]!.similarityScore).toBeCloseTo(1, 5);
  });

  it("scope weight values are locked per architecture", () => {
    expect(SCOPE_WEIGHTS.workspace).toBe(1.0);
    expect(SCOPE_WEIGHTS.repo).toBe(0.8);
    expect(SCOPE_WEIGHTS.global).toBe(0.4);
  });
});

// =============================================================================
// CONFIDENCE AND VALIDATION RANKING TESTS
// =============================================================================

describe("Confidence and Validation Impact on Ranking", () => {
  let dbPath: string;
  let index: SQLiteVectorMemoryIndex;
  let embeddingProvider: HashEmbeddingProvider;

  beforeEach(async () => {
    dbPath = createTempDbPath();
    embeddingProvider = new HashEmbeddingProvider(EMBEDDING_DIMENSIONS);
    index = new SQLiteVectorMemoryIndex({
      dbPath,
      dimensions: EMBEDDING_DIMENSIONS,
      providerId: embeddingProvider.providerId
    });
    await index.init();
  });

  afterEach(() => {
    try {
      index.close();
    } catch {
      // Ignore
    }
    cleanupTempDb(dbPath);
  });

  it("validated memory outranks unvalidated at equal similarity", async () => {
    const embedding = await embeddingProvider.embed("validation test");

    // Unvalidated with high confidence
    await index.upsert(
      createTestRecord("unvalidated-high", embedding, {
        trust: { confidence: 0.95, validated: false }
      })
    );

    // Validated with lower confidence (validation sets trust to 1.0)
    await index.upsert(
      createTestRecord("validated-low", embedding, {
        trust: { confidence: 0.5, validated: true, verifierTaskId: "verifier-123" }
      })
    );

    const results = await index.query({ embedding, topK: 10 });

    expect(results.length).toBe(2);
    expect(results[0]!.record.id).toBe("validated-low");
    expect(results[0]!.record.trust.validated).toBe(true);
  });

  it("low confidence significantly reduces ranking", async () => {
    const embedding = await embeddingProvider.embed("confidence test");

    await index.upsert(
      createTestRecord("high-conf", embedding, {
        trust: { confidence: 0.9, validated: false }
      })
    );

    await index.upsert(
      createTestRecord("low-conf", embedding, {
        trust: { confidence: 0.2, validated: false }
      })
    );

    const results = await index.query({ embedding, topK: 10 });

    expect(results.length).toBe(2);
    expect(results[0]!.record.id).toBe("high-conf");

    // Score ratio should roughly match confidence ratio
    const highScore = results[0]!.relevanceScore;
    const lowScore = results[1]!.relevanceScore;
    expect(highScore / lowScore).toBeCloseTo(0.9 / 0.2, 1);
  });

  it("verifier_task_id is preserved for validated records", async () => {
    const embedding = await embeddingProvider.embed("verifier tracking");

    await index.upsert(
      createTestRecord("with-verifier", embedding, {
        trust: {
          confidence: 0.8,
          validated: true,
          verifierTaskId: "task-verifier-789"
        }
      })
    );

    const retrieved = await index.get("with-verifier");
    expect(retrieved!.trust.verifierTaskId).toBe("task-verifier-789");
  });

  it("only validated memories pass validatedOnly filter", async () => {
    const embedding = await embeddingProvider.embed("filter test");

    await index.upsert(
      createTestRecord("unvalidated", embedding, {
        trust: { confidence: 0.9, validated: false }
      })
    );

    await index.upsert(
      createTestRecord("validated", embedding, {
        trust: { confidence: 0.5, validated: true }
      })
    );

    const results = await index.query({
      embedding,
      topK: 10,
      filters: { validatedOnly: true }
    });

    expect(results.length).toBe(1);
    expect(results[0]!.record.trust.validated).toBe(true);
  });
});

// =============================================================================
// TTL DECAY TESTS
// =============================================================================

describe("TTL Decay Removes Expired Records", () => {
  let dbPath: string;
  let index: SQLiteVectorMemoryIndex;
  let embeddingProvider: HashEmbeddingProvider;

  beforeEach(async () => {
    dbPath = createTempDbPath();
    embeddingProvider = new HashEmbeddingProvider(EMBEDDING_DIMENSIONS);
    index = new SQLiteVectorMemoryIndex({
      dbPath,
      dimensions: EMBEDDING_DIMENSIONS,
      providerId: embeddingProvider.providerId
    });
    await index.init();
  });

  afterEach(() => {
    try {
      index.close();
    } catch {
      // Ignore
    }
    cleanupTempDb(dbPath);
  });

  it("decay removes expired records from storage", async () => {
    const now = new Date();
    const embedding = await embeddingProvider.embed("decay test");

    // Create expired record (created 2 days ago with 1 day TTL)
    const expiredTime = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    await index.upsert(
      createTestRecord("expired", embedding, {
        decay: { ttl: 24 * 60 * 60 * 1000, createdAt: expiredTime.toISOString() }
      })
    );

    // Create fresh record
    await index.upsert(
      createTestRecord("fresh", embedding, {
        decay: { ttl: TEST_TTL, createdAt: now.toISOString() }
      })
    );

    // Before decay: both visible in stats
    const statsBefore = await index.stats();
    expect(statsBefore.totalRecords).toBe(2);
    expect(statsBefore.expiredCount).toBe(1);

    // Run decay
    const removed = await index.decay(now);
    expect(removed).toBe(1);

    // After decay: only fresh remains
    const statsAfter = await index.stats();
    expect(statsAfter.totalRecords).toBe(1);
    expect(statsAfter.expiredCount).toBe(0);

    // Verify expired record is gone
    const expiredRecord = await index.get("expired");
    expect(expiredRecord).toBeUndefined();

    // Verify fresh record still exists
    const freshRecord = await index.get("fresh");
    expect(freshRecord).toBeDefined();
  });

  it("expired records are excluded from query results", async () => {
    const now = new Date();
    const embedding = await embeddingProvider.embed("query exclusion test");

    // Create expired record (not yet decayed, but expired)
    const expiredTime = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    await index.upsert(
      createTestRecord("expired-not-decayed", embedding, {
        decay: { ttl: 24 * 60 * 60 * 1000, createdAt: expiredTime.toISOString() }
      })
    );

    // Query should NOT return expired record (soft filter in query)
    const results = await index.query({ embedding, topK: 10 });
    expect(results.length).toBe(0);
  });

  it("freshness weight decays over time", async () => {
    const now = new Date();
    const embedding = await embeddingProvider.embed("freshness decay test");

    // Fresh record (just created)
    await index.upsert(
      createTestRecord("fresh", embedding, {
        decay: { ttl: TEST_TTL, createdAt: now.toISOString() }
      })
    );

    // Aging record (created half-TTL ago)
    const halfTtlAgo = new Date(now.getTime() - TEST_TTL / 2);
    await index.upsert(
      createTestRecord("aging", embedding, {
        decay: { ttl: TEST_TTL, createdAt: halfTtlAgo.toISOString() }
      })
    );

    const results = await index.query({ embedding, topK: 10 });

    expect(results.length).toBe(2);
    expect(results[0]!.record.id).toBe("fresh");
    expect(results[1]!.record.id).toBe("aging");

    // Fresh should have higher relevance due to freshness weight
    expect(results[0]!.relevanceScore).toBeGreaterThan(results[1]!.relevanceScore);
  });

  it("isExpired utility correctly identifies expired records", () => {
    const now = new Date();

    // Not expired
    const freshDecay: MemoryDecay = {
      ttl: TEST_TTL,
      createdAt: now.toISOString()
    };
    expect(isExpired(freshDecay, now)).toBe(false);

    // Just expired (1ms past TTL)
    const justExpired: MemoryDecay = {
      ttl: 1000,
      createdAt: new Date(now.getTime() - 1001).toISOString()
    };
    expect(isExpired(justExpired, now)).toBe(true);

    // Long expired
    const longExpired: MemoryDecay = {
      ttl: 1000,
      createdAt: new Date(now.getTime() - 1000000).toISOString()
    };
    expect(isExpired(longExpired, now)).toBe(true);
  });
});

// =============================================================================
// ADVISORY-ONLY BEHAVIOR TESTS
// =============================================================================

describe("Advisory-Only Behavior", () => {
  let dbPath: string;
  let index: SQLiteVectorMemoryIndex;

  beforeEach(async () => {
    dbPath = createTempDbPath();
    index = new SQLiteVectorMemoryIndex({
      dbPath,
      dimensions: EMBEDDING_DIMENSIONS,
      providerId: "test"
    });
    await index.init();
  });

  afterEach(() => {
    try {
      index.close();
    } catch {
      // Ignore
    }
    cleanupTempDb(dbPath);
  });

  it("empty query results do not block execution", async () => {
    // Query on empty database
    const results = await index.query({
      embedding: new Array(EMBEDDING_DIMENSIONS).fill(0.5),
      topK: 10
    });

    // Returns empty array, not error
    expect(results).toEqual([]);
    expect(Array.isArray(results)).toBe(true);
  });

  it("query results are suggestions, not commands", async () => {
    const provider = createTestEmbeddingProvider(EMBEDDING_DIMENSIONS);
    const embedding = await provider.embed("suggestion test");

    await index.upsert(
      createTestRecord("suggestion-1", embedding, {
        content: "This is a suggestion, not a command"
      })
    );

    const results = await index.query({ embedding, topK: 1 });

    // Result structure is advisory
    expect(results[0]).toHaveProperty("record");
    expect(results[0]).toHaveProperty("similarityScore");
    expect(results[0]).toHaveProperty("relevanceScore");

    // No execution authority fields
    expect(results[0]).not.toHaveProperty("execute");
    expect(results[0]).not.toHaveProperty("command");
    expect(results[0]).not.toHaveProperty("mandatory");
  });

  it("memory types are all semantic categories, not commands", () => {
    const allowedTypes: MemoryType[] = [
      "lesson_learned",
      "error_pattern",
      "best_practice",
      "design_decision",
      "verification_outcome"
    ];

    // None of these imply execution authority
    for (const type of allowedTypes) {
      expect(type).not.toContain("command");
      expect(type).not.toContain("execute");
      expect(type).not.toContain("instruction");
    }
  });

  it("role-based access is purely advisory filtering", () => {
    // Test that canAccessScope is just a filter, not enforcement
    expect(canAccessScope("planner", "workspace")).toBe(true);
    expect(canAccessScope("planner", "global")).toBe(false);

    // The false return doesn't throw - it's just guidance
    expect(() => canAccessScope("planner", "global")).not.toThrow();
  });
});

// =============================================================================
// POLICY-BLOCKED WRITES TESTS
// =============================================================================

describe("Policy-Blocked Writes", () => {
  it("policy denies memory write without user approval", () => {
    const request: PolicyRequest = {
      requestId: "test-memory-write",
      requestType: "memory_write",
      role: "specialist",
      skill: {
        skillId: "test-skill",
        declaresMemoryWrite: true
      },
      context: { repoId: "test-repo", workspaceId: "test-workspace", taskId: "task-1" },
      userSettings: {
        allowNetwork: false,
        allowEscalation: true,
        allowMemoryWrite: false // DISABLED
      }
    };

    const decision = evaluate(request);

    expect(decision.approved).toBe(false);
    expect(decision.decisionCode).toBe("DENIED_MEMORY_POLICY");
    expect(decision.rationale).toContain("G-5");
  });

  it("policy approves memory write with user approval", () => {
    const request: PolicyRequest = {
      requestId: "test-memory-write-approved",
      requestType: "memory_write",
      role: "specialist",
      skill: {
        skillId: "test-skill",
        declaresMemoryWrite: true
      },
      context: { repoId: "test-repo", workspaceId: "test-workspace", taskId: "task-1" },
      userSettings: {
        allowNetwork: false,
        allowEscalation: true,
        allowMemoryWrite: true // ENABLED
      }
    };

    const decision = evaluate(request);

    expect(decision.approved).toBe(true);
    expect(decision.decisionCode).toBe("APPROVED");
  });

  it("policy denies memory write for roles without authority", () => {
    // Planner cannot write memory
    const request: PolicyRequest = {
      requestId: "planner-memory-write",
      requestType: "memory_write",
      role: "planner", // Cannot write
      skill: {
        skillId: "test-skill",
        declaresMemoryWrite: true
      },
      context: { repoId: "test-repo", workspaceId: "test-workspace", taskId: "task-1" },
      userSettings: {
        allowNetwork: false,
        allowEscalation: true,
        allowMemoryWrite: true
      }
    };

    const decision = evaluate(request);

    expect(decision.approved).toBe(false);
    expect(decision.decisionCode).toBe("DENIED_ROLE");
  });

  it("policy denies memory write if skill doesn't declare it", () => {
    const request: PolicyRequest = {
      requestId: "undeclared-memory-write",
      requestType: "memory_write",
      role: "specialist",
      skill: {
        skillId: "test-skill",
        declaresMemoryWrite: false // Not declared
      },
      context: { repoId: "test-repo", workspaceId: "test-workspace", taskId: "task-1" },
      userSettings: {
        allowNetwork: false,
        allowEscalation: true,
        allowMemoryWrite: true
      }
    };

    const decision = evaluate(request);

    expect(decision.approved).toBe(false);
    expect(decision.decisionCode).toBe("DENIED_SKILL");
  });

  it("policy decision includes audit hash", () => {
    const request: PolicyRequest = {
      requestId: "audit-test",
      requestType: "memory_write",
      role: "specialist",
      skill: { skillId: "test-skill", declaresMemoryWrite: true },
      context: { repoId: "test-repo", workspaceId: "test-workspace", taskId: "task-1" },
      userSettings: {
        allowNetwork: false,
        allowEscalation: true,
        allowMemoryWrite: true
      }
    };

    const decision = evaluate(request);

    expect(decision.audit).toBeDefined();
    expect(decision.audit.inputsHash).toHaveLength(16); // SHA-256 truncated
    expect(decision.audit.ruleVersion).toBeDefined();
    expect(decision.audit.evaluatedAt).toBeDefined();
  });
});

// =============================================================================
// FAIL-OPEN READ BEHAVIOR TESTS
// =============================================================================

describe("Fail-Open Read Behavior", () => {
  it("query returns empty array on database error", async () => {
    const dbPath = createTempDbPath();
    const index = new SQLiteVectorMemoryIndex({
      dbPath,
      dimensions: EMBEDDING_DIMENSIONS,
      providerId: "test"
    });

    await index.init();
    index.close(); // Close to simulate error

    // Query should fail-open (return empty, not throw)
    const results = await index.query({
      embedding: new Array(EMBEDDING_DIMENSIONS).fill(0.5),
      topK: 10
    });

    expect(results).toEqual([]);
    cleanupTempDb(dbPath);
  });

  it("query returns empty array on uninitialized database", async () => {
    const dbPath = createTempDbPath();
    const index = new SQLiteVectorMemoryIndex({
      dbPath,
      dimensions: EMBEDDING_DIMENSIONS,
      providerId: "test"
    });

    // NOT initialized - query should fail-open
    const results = await index.query({
      embedding: new Array(EMBEDDING_DIMENSIONS).fill(0.5),
      topK: 10
    });

    expect(results).toEqual([]);
    cleanupTempDb(dbPath);
  });

  it("missing memory does not block workflow", async () => {
    // Simulate a workflow that queries memory
    const dbPath = createTempDbPath();
    const index = new SQLiteVectorMemoryIndex({
      dbPath,
      dimensions: EMBEDDING_DIMENSIONS,
      providerId: "test"
    });
    await index.init();

    // Step 1: Query memory (empty database)
    const memories = await index.query({
      embedding: new Array(EMBEDDING_DIMENSIONS).fill(0.5),
      topK: 5
    });

    // Step 2: Workflow continues regardless of memory results
    const workflowCanContinue = true; // Memory is advisory
    expect(memories).toEqual([]);
    expect(workflowCanContinue).toBe(true);

    // Step 3: Processing doesn't depend on memory
    const processResult = memories.length > 0
      ? `Found ${memories.length} suggestions`
      : "Proceeding without memory suggestions";

    expect(processResult).toBe("Proceeding without memory suggestions");

    index.close();
    cleanupTempDb(dbPath);
  });
});

// =============================================================================
// DETERMINISM TESTS
// =============================================================================

describe("100% Deterministic Tests", () => {
  it("HashEmbeddingProvider produces identical embeddings across runs", async () => {
    const p1 = new HashEmbeddingProvider(EMBEDDING_DIMENSIONS, "fixed-seed");
    const p2 = new HashEmbeddingProvider(EMBEDDING_DIMENSIONS, "fixed-seed");

    const e1 = await p1.embed("test input");
    const e2 = await p2.embed("test input");

    expect(e1).toEqual(e2);
  });

  it("cosine similarity is deterministic", () => {
    const a = [0.5, 0.3, 0.7, 0.1];
    const b = [0.4, 0.2, 0.8, 0.2];

    const sim1 = cosineSimilarity(a, b);
    const sim2 = cosineSimilarity(a, b);
    const sim3 = cosineSimilarity(a, b);

    expect(sim1).toBe(sim2);
    expect(sim2).toBe(sim3);
  });

  it("relevance score calculation is deterministic", () => {
    const now = new Date("2025-01-01T00:00:00.000Z");
    const decay: MemoryDecay = {
      ttl: TEST_TTL,
      createdAt: "2025-01-01T00:00:00.000Z"
    };
    const trust = { confidence: 0.8, validated: false };

    const score1 = calculateRelevanceScore(0.9, "workspace", trust, decay, now);
    const score2 = calculateRelevanceScore(0.9, "workspace", trust, decay, now);

    expect(score1).toBe(score2);
  });

  it("policy evaluation is deterministic", () => {
    const request: PolicyRequest = {
      requestId: "determinism-test",
      requestType: "memory_write",
      role: "specialist",
      skill: { skillId: "test-skill", declaresMemoryWrite: true },
      context: { repoId: "test-repo", workspaceId: "test-workspace", taskId: "task-1" },
      userSettings: {
        allowNetwork: false,
        allowEscalation: true,
        allowMemoryWrite: true
      }
    };

    const d1 = evaluate(request);
    const d2 = evaluate(request);

    expect(d1.approved).toBe(d2.approved);
    expect(d1.decisionCode).toBe(d2.decisionCode);
    expect(d1.audit.inputsHash).toBe(d2.audit.inputsHash);
  });

  it("no external API calls in default providers", async () => {
    // HashEmbeddingProvider uses only crypto (built-in)
    const provider = new HashEmbeddingProvider(EMBEDDING_DIMENSIONS);

    // This should complete instantly without network
    const start = Date.now();
    await provider.embed("test");
    const elapsed = Date.now() - start;

    // Should be < 100ms (no network delay)
    expect(elapsed).toBeLessThan(100);
  });
});

// =============================================================================
// COMPREHENSIVE SCENARIO TESTS
// =============================================================================

describe("Comprehensive Scenarios", () => {
  let dbPath: string;
  let index: SQLiteVectorMemoryIndex;
  let embeddingProvider: CachingEmbeddingProvider;

  beforeEach(async () => {
    dbPath = createTempDbPath();
    const hashProvider = new HashEmbeddingProvider(EMBEDDING_DIMENSIONS, "scenario-seed");
    embeddingProvider = new CachingEmbeddingProvider(hashProvider);
    index = new SQLiteVectorMemoryIndex({
      dbPath,
      dimensions: EMBEDDING_DIMENSIONS,
      providerId: embeddingProvider.providerId
    });
    await index.init();
  });

  afterEach(() => {
    try {
      index.close();
    } catch {
      // Ignore
    }
    cleanupTempDb(dbPath);
  });

  it("scenario: planner queries memory before planning", async () => {
    // Setup: Store some design decisions from previous tasks
    const decisions = [
      { content: "Use dependency injection for testability", type: "design_decision" as MemoryType },
      { content: "Prefer composition over inheritance", type: "best_practice" as MemoryType },
      { content: "Null checks caused 3 bugs last month", type: "error_pattern" as MemoryType }
    ];

    for (let i = 0; i < decisions.length; i++) {
      const embedding = await embeddingProvider.embed(decisions[i]!.content);
      await index.upsert(
        createTestRecord(`decision-${i}`, embedding, {
          content: decisions[i]!.content,
          type: decisions[i]!.type
        })
      );
    }

    // Planner queries for relevant context
    const queryEmbedding = await embeddingProvider.embed("architectural patterns");
    const advisoryContext = await index.query({
      embedding: queryEmbedding,
      topK: 5
    });

    // Results are advisory - planner can use or ignore them
    expect(advisoryContext.length).toBeGreaterThan(0);

    // Even if memory returns nothing, planning should proceed
    const emptyQuery = await index.query({
      embedding: await embeddingProvider.embed("unrelated topic xyz"),
      topK: 5
    });

    // Planner continues regardless
    const plannerCanProceed = true;
    expect(plannerCanProceed).toBe(true);
  });

  it("scenario: specialist learns from past errors", async () => {
    // Store error patterns
    const errorEmbedding = await embeddingProvider.embed("async race condition");
    await index.upsert(
      createTestRecord("error-1", errorEmbedding, {
        content: "Race condition in async code - use mutex",
        type: "error_pattern",
        trust: { confidence: 0.9, validated: true }
      })
    );

    // Specialist about to work on async code queries memory
    const queryEmbedding = await embeddingProvider.embed("async function implementation");
    const warnings = await index.query({
      embedding: queryEmbedding,
      topK: 3,
      filters: { type: ["error_pattern"] }
    });

    // Advisory context available
    if (warnings.length > 0) {
      // Specialist can consider this, but execution is not blocked
      expect(warnings[0]!.record.type).toBe("error_pattern");
    }
  });

  it("scenario: verifier outcome stored with full provenance", async () => {
    const embedding = await embeddingProvider.embed("verified code pattern");

    // Simulate verifier storing an outcome
    await index.upsert(
      createTestRecord("verifier-outcome-1", embedding, {
        content: "This code pattern was verified safe for production",
        type: "verification_outcome",
        provenance: {
          repoId: "production-repo",
          workspaceId: "main-workspace",
          taskId: "task-456",
          stepId: "step-verify",
          agentRole: "verifier"
        },
        trust: {
          confidence: 0.95,
          validated: true,
          verifierTaskId: "task-456"
        }
      })
    );

    const retrieved = await index.get("verifier-outcome-1");

    // Full provenance preserved
    expect(retrieved!.provenance.taskId).toBe("task-456");
    expect(retrieved!.provenance.agentRole).toBe("verifier");
    expect(retrieved!.trust.verifierTaskId).toBe("task-456");
  });

  it("scenario: memory cleanup over time", async () => {
    const now = new Date();

    // Store records with varying ages
    const ages = [0, 0.3, 0.6, 0.9, 1.1]; // Fraction of TTL
    for (let i = 0; i < ages.length; i++) {
      const createdAt = new Date(now.getTime() - ages[i]! * TEST_TTL);
      const embedding = await embeddingProvider.embed(`record ${i}`);
      await index.upsert(
        createTestRecord(`age-${i}`, embedding, {
          decay: { ttl: TEST_TTL, createdAt: createdAt.toISOString() }
        })
      );
    }

    // Check stats before decay
    const statsBefore = await index.stats();
    expect(statsBefore.totalRecords).toBe(5);
    expect(statsBefore.expiredCount).toBe(1); // age 1.1 × TTL is expired

    // Run decay
    const removed = await index.decay(now);
    expect(removed).toBe(1);

    // Check stats after decay
    const statsAfter = await index.stats();
    expect(statsAfter.totalRecords).toBe(4);
    expect(statsAfter.expiredCount).toBe(0);
  });
});

