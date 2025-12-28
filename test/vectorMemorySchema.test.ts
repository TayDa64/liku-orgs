/**
 * Tests for Vector Memory SQLite Schema (VM-02)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import initSqlJs, { type Database } from "sql.js";
import {
  VECTOR_MEMORY_SCHEMA_VERSION,
  CREATE_VECTOR_MEMORY_TABLE,
  CREATE_VECTOR_MEMORY_INDEXES,
  tableExists,
  getSchemaVersion,
  setSchemaVersion,
  migrateVectorMemory,
  serializeEmbedding,
  deserializeEmbedding,
  validateEmbeddingDimensions,
  isValidMemoryType,
  isValidScope,
  isValidRole,
  UPSERT_VECTOR_MEMORY,
  type VectorMemoryRow
} from "../src/liku/memory/vectorMemorySchema.js";

describe("Vector Memory Schema", () => {
  let db: Database;

  beforeEach(async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();
  });

  afterEach(() => {
    db.close();
  });

  describe("Schema Version", () => {
    it("should have a positive schema version", () => {
      expect(VECTOR_MEMORY_SCHEMA_VERSION).toBeGreaterThan(0);
    });

    it("should return 0 for empty database", () => {
      expect(getSchemaVersion(db)).toBe(0);
    });

    it("should set and get schema version", () => {
      setSchemaVersion(db, 42);
      expect(getSchemaVersion(db)).toBe(42);
    });

    it("should update schema version on subsequent calls", () => {
      setSchemaVersion(db, 1);
      expect(getSchemaVersion(db)).toBe(1);
      setSchemaVersion(db, 2);
      expect(getSchemaVersion(db)).toBe(2);
    });
  });

  describe("Table Creation", () => {
    it("should create vector_memory table", () => {
      db.run(CREATE_VECTOR_MEMORY_TABLE);
      expect(tableExists(db, "vector_memory")).toBe(true);
    });

    it("should create all indexes", () => {
      db.run(CREATE_VECTOR_MEMORY_TABLE);
      for (const indexSql of CREATE_VECTOR_MEMORY_INDEXES) {
        db.run(indexSql);
      }
      
      // Check indexes exist
      const stmt = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='vector_memory';`
      );
      const indexes: string[] = [];
      while (stmt.step()) {
        const row = stmt.getAsObject() as { name: string };
        indexes.push(row.name);
      }
      stmt.free();

      expect(indexes).toContain("idx_vm_scope_repo");
      expect(indexes).toContain("idx_vm_workspace");
      expect(indexes).toContain("idx_vm_type");
      expect(indexes).toContain("idx_vm_created_at");
      expect(indexes).toContain("idx_vm_validated");
      expect(indexes).toContain("idx_vm_agent_role");
    });

    it("should be idempotent (IF NOT EXISTS)", () => {
      db.run(CREATE_VECTOR_MEMORY_TABLE);
      expect(() => db.run(CREATE_VECTOR_MEMORY_TABLE)).not.toThrow();
    });
  });

  describe("Migration", () => {
    it("should migrate empty database to current version", () => {
      const migrated = migrateVectorMemory(db);
      expect(migrated).toBe(true);
      expect(getSchemaVersion(db)).toBe(VECTOR_MEMORY_SCHEMA_VERSION);
      expect(tableExists(db, "vector_memory")).toBe(true);
    });

    it("should not re-migrate if already at current version", () => {
      migrateVectorMemory(db);
      const migratedAgain = migrateVectorMemory(db);
      expect(migratedAgain).toBe(false);
    });

    it("should preserve data during migration", () => {
      migrateVectorMemory(db);

      // Insert a record
      const embedding = serializeEmbedding([0.1, 0.2, 0.3]);
      db.run(UPSERT_VECTOR_MEMORY, [
        "test-id",
        embedding,
        "test content",
        "lesson_learned",
        "workspace",
        "repo-1",
        "ws-1",
        "task-1",
        "step-1",
        "specialist",
        0.8,
        0,
        null,
        86400000,
        new Date().toISOString(),
        null,
        3,
        "test-provider"
      ]);

      // Run migration again (should be no-op)
      migrateVectorMemory(db);

      // Verify data persists
      const stmt = db.prepare(`SELECT * FROM vector_memory WHERE id = ?;`);
      stmt.bind(["test-id"]);
      expect(stmt.step()).toBe(true);
      const row = stmt.getAsObject() as unknown as VectorMemoryRow;
      expect(row.content).toBe("test content");
      stmt.free();
    });
  });

  describe("Table Constraints", () => {
    beforeEach(() => {
      migrateVectorMemory(db);
    });

    it("should enforce type CHECK constraint", () => {
      const embedding = serializeEmbedding([0.1]);
      expect(() =>
        db.run(UPSERT_VECTOR_MEMORY, [
          "id1", embedding, "content", "invalid_type", "workspace",
          "repo", "ws", null, null, "specialist",
          0.5, 0, null, 1000, new Date().toISOString(), null, 1, null
        ])
      ).toThrow();
    });

    it("should enforce scope CHECK constraint", () => {
      const embedding = serializeEmbedding([0.1]);
      expect(() =>
        db.run(UPSERT_VECTOR_MEMORY, [
          "id1", embedding, "content", "lesson_learned", "invalid_scope",
          "repo", "ws", null, null, "specialist",
          0.5, 0, null, 1000, new Date().toISOString(), null, 1, null
        ])
      ).toThrow();
    });

    it("should enforce agent_role CHECK constraint", () => {
      const embedding = serializeEmbedding([0.1]);
      expect(() =>
        db.run(UPSERT_VECTOR_MEMORY, [
          "id1", embedding, "content", "lesson_learned", "workspace",
          "repo", "ws", null, null, "invalid_role",
          0.5, 0, null, 1000, new Date().toISOString(), null, 1, null
        ])
      ).toThrow();
    });

    it("should enforce confidence range CHECK constraint", () => {
      const embedding = serializeEmbedding([0.1]);
      expect(() =>
        db.run(UPSERT_VECTOR_MEMORY, [
          "id1", embedding, "content", "lesson_learned", "workspace",
          "repo", "ws", null, null, "specialist",
          1.5, 0, null, 1000, new Date().toISOString(), null, 1, null
        ])
      ).toThrow();
    });

    it("should enforce validated CHECK constraint (0 or 1)", () => {
      const embedding = serializeEmbedding([0.1]);
      expect(() =>
        db.run(UPSERT_VECTOR_MEMORY, [
          "id1", embedding, "content", "lesson_learned", "workspace",
          "repo", "ws", null, null, "specialist",
          0.5, 2, null, 1000, new Date().toISOString(), null, 1, null
        ])
      ).toThrow();
    });

    it("should enforce ttl positive CHECK constraint", () => {
      const embedding = serializeEmbedding([0.1]);
      expect(() =>
        db.run(UPSERT_VECTOR_MEMORY, [
          "id1", embedding, "content", "lesson_learned", "workspace",
          "repo", "ws", null, null, "specialist",
          0.5, 0, null, 0, new Date().toISOString(), null, 1, null
        ])
      ).toThrow();
    });

    it("should enforce embedding_dimensions positive CHECK constraint", () => {
      const embedding = serializeEmbedding([0.1]);
      expect(() =>
        db.run(UPSERT_VECTOR_MEMORY, [
          "id1", embedding, "content", "lesson_learned", "workspace",
          "repo", "ws", null, null, "specialist",
          0.5, 0, null, 1000, new Date().toISOString(), null, 0, null
        ])
      ).toThrow();
    });

    it("should accept all valid memory types", () => {
      const types = [
        "lesson_learned",
        "error_pattern",
        "best_practice",
        "design_decision",
        "verification_outcome"
      ];

      for (let i = 0; i < types.length; i++) {
        const embedding = serializeEmbedding([0.1]);
        expect(() =>
          db.run(UPSERT_VECTOR_MEMORY, [
            `id-${i}`, embedding, "content", types[i], "workspace",
            "repo", "ws", null, null, "specialist",
            0.5, 0, null, 1000, new Date().toISOString(), null, 1, null
          ])
        ).not.toThrow();
      }
    });

    it("should accept all valid scopes", () => {
      const scopes = ["workspace", "repo", "global"];

      for (let i = 0; i < scopes.length; i++) {
        const embedding = serializeEmbedding([0.1]);
        expect(() =>
          db.run(UPSERT_VECTOR_MEMORY, [
            `scope-${i}`, embedding, "content", "lesson_learned", scopes[i],
            "repo", "ws", null, null, "specialist",
            0.5, 0, null, 1000, new Date().toISOString(), null, 1, null
          ])
        ).not.toThrow();
      }
    });

    it("should accept all valid roles", () => {
      const roles = ["supervisor", "planner", "specialist", "verifier"];

      for (let i = 0; i < roles.length; i++) {
        const embedding = serializeEmbedding([0.1]);
        expect(() =>
          db.run(UPSERT_VECTOR_MEMORY, [
            `role-${i}`, embedding, "content", "lesson_learned", "workspace",
            "repo", "ws", null, null, roles[i],
            0.5, 0, null, 1000, new Date().toISOString(), null, 1, null
          ])
        ).not.toThrow();
      }
    });
  });

  describe("Embedding Serialization", () => {
    it("should round-trip serialize/deserialize embedding", () => {
      const original = [0.1, 0.2, 0.3, -0.5, 0.99999];
      const serialized = serializeEmbedding(original);
      const deserialized = deserializeEmbedding(serialized);

      expect(deserialized).toHaveLength(original.length);
      for (let i = 0; i < original.length; i++) {
        expect(deserialized[i]).toBeCloseTo(original[i]!, 10);
      }
    });

    it("should handle empty embedding", () => {
      const original: number[] = [];
      const serialized = serializeEmbedding(original);
      const deserialized = deserializeEmbedding(serialized);
      expect(deserialized).toHaveLength(0);
    });

    it("should handle large embeddings", () => {
      const original = Array.from({ length: 1536 }, (_, i) => Math.random() * 2 - 1);
      const serialized = serializeEmbedding(original);
      const deserialized = deserializeEmbedding(serialized);

      expect(deserialized).toHaveLength(original.length);
      for (let i = 0; i < original.length; i++) {
        expect(deserialized[i]).toBeCloseTo(original[i]!, 10);
      }
    });

    it("should handle special float values", () => {
      const original = [0, -0, Number.MIN_VALUE, Number.MAX_VALUE];
      const serialized = serializeEmbedding(original);
      const deserialized = deserializeEmbedding(serialized);

      expect(deserialized[0]).toBe(0);
      expect(Object.is(deserialized[1], -0)).toBe(true); // -0 is preserved in Float64Array
      expect(deserialized[2]).toBe(Number.MIN_VALUE);
      expect(deserialized[3]).toBe(Number.MAX_VALUE);
    });

    it("should persist embedding through SQLite", () => {
      migrateVectorMemory(db);

      const original = [0.123456789, -0.987654321, 0.5];
      const serialized = serializeEmbedding(original);

      db.run(UPSERT_VECTOR_MEMORY, [
        "emb-test", serialized, "content", "lesson_learned", "workspace",
        "repo", "ws", null, null, "specialist",
        0.5, 0, null, 1000, new Date().toISOString(), null, 3, null
      ]);

      const stmt = db.prepare(`SELECT embedding FROM vector_memory WHERE id = ?;`);
      stmt.bind(["emb-test"]);
      stmt.step();
      const row = stmt.getAsObject() as { embedding: Uint8Array };
      stmt.free();

      const deserialized = deserializeEmbedding(row.embedding);
      expect(deserialized).toHaveLength(3);
      expect(deserialized[0]).toBeCloseTo(0.123456789, 10);
      expect(deserialized[1]).toBeCloseTo(-0.987654321, 10);
      expect(deserialized[2]).toBeCloseTo(0.5, 10);
    });
  });

  describe("Validation Helpers", () => {
    describe("validateEmbeddingDimensions", () => {
      it("should return true for matching dimensions", () => {
        expect(validateEmbeddingDimensions([1, 2, 3], 3)).toBe(true);
      });

      it("should return false for mismatched dimensions", () => {
        expect(validateEmbeddingDimensions([1, 2, 3], 4)).toBe(false);
      });

      it("should return true for empty array with 0 dimensions", () => {
        expect(validateEmbeddingDimensions([], 0)).toBe(true);
      });
    });

    describe("isValidMemoryType", () => {
      it("should return true for valid types", () => {
        expect(isValidMemoryType("lesson_learned")).toBe(true);
        expect(isValidMemoryType("error_pattern")).toBe(true);
        expect(isValidMemoryType("best_practice")).toBe(true);
        expect(isValidMemoryType("design_decision")).toBe(true);
        expect(isValidMemoryType("verification_outcome")).toBe(true);
      });

      it("should return false for invalid types", () => {
        expect(isValidMemoryType("invalid")).toBe(false);
        expect(isValidMemoryType("")).toBe(false);
        expect(isValidMemoryType("LESSON_LEARNED")).toBe(false);
      });
    });

    describe("isValidScope", () => {
      it("should return true for valid scopes", () => {
        expect(isValidScope("workspace")).toBe(true);
        expect(isValidScope("repo")).toBe(true);
        expect(isValidScope("global")).toBe(true);
      });

      it("should return false for invalid scopes", () => {
        expect(isValidScope("invalid")).toBe(false);
        expect(isValidScope("")).toBe(false);
        expect(isValidScope("WORKSPACE")).toBe(false);
      });
    });

    describe("isValidRole", () => {
      it("should return true for valid roles", () => {
        expect(isValidRole("supervisor")).toBe(true);
        expect(isValidRole("planner")).toBe(true);
        expect(isValidRole("specialist")).toBe(true);
        expect(isValidRole("verifier")).toBe(true);
      });

      it("should return false for invalid roles", () => {
        expect(isValidRole("invalid")).toBe(false);
        expect(isValidRole("")).toBe(false);
        expect(isValidRole("SUPERVISOR")).toBe(false);
      });
    });
  });

  describe("UPSERT Behavior", () => {
    beforeEach(() => {
      migrateVectorMemory(db);
    });

    it("should insert new record", () => {
      const embedding = serializeEmbedding([0.1, 0.2]);
      db.run(UPSERT_VECTOR_MEMORY, [
        "new-id", embedding, "original content", "lesson_learned", "workspace",
        "repo-1", "ws-1", "task-1", "step-1", "specialist",
        0.7, 0, null, 86400000, new Date().toISOString(), null, 2, "test"
      ]);

      const stmt = db.prepare(`SELECT content FROM vector_memory WHERE id = ?;`);
      stmt.bind(["new-id"]);
      stmt.step();
      const row = stmt.getAsObject() as { content: string };
      stmt.free();

      expect(row.content).toBe("original content");
    });

    it("should replace existing record with same id", () => {
      const embedding = serializeEmbedding([0.1, 0.2]);
      const now = new Date().toISOString();

      // Insert original
      db.run(UPSERT_VECTOR_MEMORY, [
        "same-id", embedding, "original content", "lesson_learned", "workspace",
        "repo-1", "ws-1", null, null, "specialist",
        0.5, 0, null, 1000, now, null, 2, null
      ]);

      // Upsert with same id
      db.run(UPSERT_VECTOR_MEMORY, [
        "same-id", embedding, "updated content", "error_pattern", "repo",
        "repo-2", "ws-2", "task-1", "step-1", "verifier",
        0.9, 1, "verifier-task", 2000, now, now, 2, "updated"
      ]);

      const stmt = db.prepare(`SELECT * FROM vector_memory WHERE id = ?;`);
      stmt.bind(["same-id"]);
      stmt.step();
      const row = stmt.getAsObject() as unknown as VectorMemoryRow;
      stmt.free();

      expect(row.content).toBe("updated content");
      expect(row.type).toBe("error_pattern");
      expect(row.scope).toBe("repo");
      expect(row.confidence).toBe(0.9);
      expect(row.validated).toBe(1);
    });
  });

  describe("Query Patterns", () => {
    beforeEach(() => {
      migrateVectorMemory(db);

      // Insert test data
      const testData = [
        { id: "ws-1", scope: "workspace", repoId: "repo-a", wsId: "ws-1", type: "lesson_learned", validated: 0 },
        { id: "ws-2", scope: "workspace", repoId: "repo-a", wsId: "ws-1", type: "error_pattern", validated: 1 },
        { id: "repo-1", scope: "repo", repoId: "repo-a", wsId: "ws-1", type: "best_practice", validated: 0 },
        { id: "global-1", scope: "global", repoId: "repo-b", wsId: "ws-2", type: "design_decision", validated: 1 }
      ];

      for (const data of testData) {
        const embedding = serializeEmbedding([0.5]);
        db.run(UPSERT_VECTOR_MEMORY, [
          data.id, embedding, `content-${data.id}`, data.type, data.scope,
          data.repoId, data.wsId, null, null, "specialist",
          0.7, data.validated, null, 86400000, new Date().toISOString(), null, 1, null
        ]);
      }
    });

    it("should query by scope", () => {
      const stmt = db.prepare(`SELECT id FROM vector_memory WHERE scope = ?;`);
      stmt.bind(["workspace"]);
      const ids: string[] = [];
      while (stmt.step()) {
        const row = stmt.getAsObject() as { id: string };
        ids.push(row.id);
      }
      stmt.free();

      expect(ids).toHaveLength(2);
      expect(ids).toContain("ws-1");
      expect(ids).toContain("ws-2");
    });

    it("should query by scope + repo using index", () => {
      const stmt = db.prepare(`SELECT id FROM vector_memory WHERE scope = ? AND repo_id = ?;`);
      stmt.bind(["workspace", "repo-a"]);
      const ids: string[] = [];
      while (stmt.step()) {
        const row = stmt.getAsObject() as { id: string };
        ids.push(row.id);
      }
      stmt.free();

      expect(ids).toHaveLength(2);
    });

    it("should query validated records", () => {
      const stmt = db.prepare(`SELECT id FROM vector_memory WHERE validated = 1;`);
      const ids: string[] = [];
      while (stmt.step()) {
        const row = stmt.getAsObject() as { id: string };
        ids.push(row.id);
      }
      stmt.free();

      expect(ids).toHaveLength(2);
      expect(ids).toContain("ws-2");
      expect(ids).toContain("global-1");
    });

    it("should query by type", () => {
      const stmt = db.prepare(`SELECT id FROM vector_memory WHERE type = ?;`);
      stmt.bind(["lesson_learned"]);
      const ids: string[] = [];
      while (stmt.step()) {
        const row = stmt.getAsObject() as { id: string };
        ids.push(row.id);
      }
      stmt.free();

      expect(ids).toHaveLength(1);
      expect(ids).toContain("ws-1");
    });
  });
});
