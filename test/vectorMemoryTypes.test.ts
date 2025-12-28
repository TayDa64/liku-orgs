/**
 * Tests for Vector Memory Types (VM-01)
 *
 * Covers:
 * - Type guards
 * - Scope weight correctness
 * - Trust weight calculation
 * - Freshness weight calculation
 * - Relevance score calculation
 * - Role-based access rules
 * - Expiration detection
 */

import { describe, it, expect } from "vitest";
import {
  isMemoryType,
  MEMORY_TYPES,
  SCOPE_WEIGHTS,
  ROLE_MEMORY_ACCESS,
  canAccessScope,
  calculateTrustWeight,
  calculateFreshnessWeight,
  calculateRelevanceScore,
  isExpired,
  DEFAULT_MEMORY_TTL,
  DEFAULT_MEMORY_CONFIDENCE,
  type MemoryType,
  type MemoryScope,
  type MemoryTrust,
  type MemoryDecay,
  type VectorMemoryRecord,
  type MemoryProvenance
} from "../src/liku/memory/vectorMemoryTypes.js";

// ============================================================================
// TEST FIXTURES
// ============================================================================

function createTestProvenance(overrides: Partial<MemoryProvenance> = {}): MemoryProvenance {
  return {
    repoId: "test-repo",
    workspaceId: "test-workspace",
    agentRole: "specialist",
    ...overrides
  };
}

function createTestTrust(overrides: Partial<MemoryTrust> = {}): MemoryTrust {
  return {
    confidence: 0.7,
    validated: false,
    ...overrides
  };
}

function createTestDecay(overrides: Partial<MemoryDecay> = {}): MemoryDecay {
  const now = new Date();
  return {
    ttl: DEFAULT_MEMORY_TTL,
    createdAt: now.toISOString(),
    ...overrides
  };
}

function createTestRecord(overrides: Partial<VectorMemoryRecord> = {}): VectorMemoryRecord {
  return {
    id: "test-record-1",
    embedding: [0.1, 0.2, 0.3],
    content: "Test memory content",
    type: "lesson_learned",
    provenance: createTestProvenance(),
    trust: createTestTrust(),
    decay: createTestDecay(),
    scope: "workspace",
    ...overrides
  };
}

// ============================================================================
// TYPE GUARD TESTS
// ============================================================================

describe("isMemoryType", () => {
  it("returns true for valid memory types", () => {
    expect(isMemoryType("lesson_learned")).toBe(true);
    expect(isMemoryType("error_pattern")).toBe(true);
    expect(isMemoryType("best_practice")).toBe(true);
    expect(isMemoryType("design_decision")).toBe(true);
    expect(isMemoryType("verification_outcome")).toBe(true);
  });

  it("returns false for invalid memory types", () => {
    expect(isMemoryType("invalid")).toBe(false);
    expect(isMemoryType("")).toBe(false);
    expect(isMemoryType(null)).toBe(false);
    expect(isMemoryType(undefined)).toBe(false);
    expect(isMemoryType(123)).toBe(false);
    expect(isMemoryType({})).toBe(false);
  });

  it("covers all defined MEMORY_TYPES", () => {
    expect(MEMORY_TYPES).toHaveLength(5);
    for (const type of MEMORY_TYPES) {
      expect(isMemoryType(type)).toBe(true);
    }
  });
});

// ============================================================================
// SCOPE WEIGHT TESTS
// ============================================================================

describe("SCOPE_WEIGHTS", () => {
  it("has correct weight for workspace (highest priority)", () => {
    expect(SCOPE_WEIGHTS.workspace).toBe(1.0);
  });

  it("has correct weight for repo", () => {
    expect(SCOPE_WEIGHTS.repo).toBe(0.8);
  });

  it("has correct weight for global (lowest priority)", () => {
    expect(SCOPE_WEIGHTS.global).toBe(0.4);
  });

  it("ensures workspace > repo > global ordering", () => {
    expect(SCOPE_WEIGHTS.workspace).toBeGreaterThan(SCOPE_WEIGHTS.repo);
    expect(SCOPE_WEIGHTS.repo).toBeGreaterThan(SCOPE_WEIGHTS.global);
  });
});

// ============================================================================
// ROLE-BASED ACCESS TESTS
// ============================================================================

describe("ROLE_MEMORY_ACCESS", () => {
  it("supervisor can access all scopes", () => {
    expect(ROLE_MEMORY_ACCESS.supervisor).toContain("workspace");
    expect(ROLE_MEMORY_ACCESS.supervisor).toContain("repo");
    expect(ROLE_MEMORY_ACCESS.supervisor).toContain("global");
    expect(ROLE_MEMORY_ACCESS.supervisor).toHaveLength(3);
  });

  it("planner can access workspace and repo only", () => {
    expect(ROLE_MEMORY_ACCESS.planner).toContain("workspace");
    expect(ROLE_MEMORY_ACCESS.planner).toContain("repo");
    expect(ROLE_MEMORY_ACCESS.planner).not.toContain("global");
    expect(ROLE_MEMORY_ACCESS.planner).toHaveLength(2);
  });

  it("specialist can access workspace and repo only", () => {
    expect(ROLE_MEMORY_ACCESS.specialist).toContain("workspace");
    expect(ROLE_MEMORY_ACCESS.specialist).toContain("repo");
    expect(ROLE_MEMORY_ACCESS.specialist).not.toContain("global");
    expect(ROLE_MEMORY_ACCESS.specialist).toHaveLength(2);
  });

  it("verifier can access all scopes", () => {
    expect(ROLE_MEMORY_ACCESS.verifier).toContain("workspace");
    expect(ROLE_MEMORY_ACCESS.verifier).toContain("repo");
    expect(ROLE_MEMORY_ACCESS.verifier).toContain("global");
    expect(ROLE_MEMORY_ACCESS.verifier).toHaveLength(3);
  });
});

describe("canAccessScope", () => {
  it("supervisor can access any scope", () => {
    expect(canAccessScope("supervisor", "workspace")).toBe(true);
    expect(canAccessScope("supervisor", "repo")).toBe(true);
    expect(canAccessScope("supervisor", "global")).toBe(true);
  });

  it("planner cannot access global scope", () => {
    expect(canAccessScope("planner", "workspace")).toBe(true);
    expect(canAccessScope("planner", "repo")).toBe(true);
    expect(canAccessScope("planner", "global")).toBe(false);
  });

  it("specialist cannot access global scope", () => {
    expect(canAccessScope("specialist", "workspace")).toBe(true);
    expect(canAccessScope("specialist", "repo")).toBe(true);
    expect(canAccessScope("specialist", "global")).toBe(false);
  });

  it("verifier can access any scope", () => {
    expect(canAccessScope("verifier", "workspace")).toBe(true);
    expect(canAccessScope("verifier", "repo")).toBe(true);
    expect(canAccessScope("verifier", "global")).toBe(true);
  });
});

// ============================================================================
// TRUST WEIGHT TESTS
// ============================================================================

describe("calculateTrustWeight", () => {
  it("returns 1.0 for validated memories", () => {
    const trust = createTestTrust({ validated: true, confidence: 0.5 });
    expect(calculateTrustWeight(trust)).toBe(1.0);
  });

  it("returns confidence for unvalidated memories", () => {
    const trust = createTestTrust({ validated: false, confidence: 0.7 });
    expect(calculateTrustWeight(trust)).toBe(0.7);
  });

  it("validation overrides confidence", () => {
    const lowConfidenceValidated = createTestTrust({ validated: true, confidence: 0.1 });
    const highConfidenceUnvalidated = createTestTrust({ validated: false, confidence: 0.9 });

    expect(calculateTrustWeight(lowConfidenceValidated)).toBe(1.0);
    expect(calculateTrustWeight(highConfidenceUnvalidated)).toBe(0.9);
    expect(calculateTrustWeight(lowConfidenceValidated)).toBeGreaterThan(
      calculateTrustWeight(highConfidenceUnvalidated)
    );
  });

  it("handles edge case confidence values", () => {
    expect(calculateTrustWeight(createTestTrust({ validated: false, confidence: 0 }))).toBe(0);
    expect(calculateTrustWeight(createTestTrust({ validated: false, confidence: 1 }))).toBe(1);
  });
});

// ============================================================================
// FRESHNESS WEIGHT TESTS
// ============================================================================

describe("calculateFreshnessWeight", () => {
  it("returns 1.0 for freshly created memories", () => {
    const now = new Date();
    const decay = createTestDecay({ createdAt: now.toISOString() });
    expect(calculateFreshnessWeight(decay, now)).toBeCloseTo(1.0);
  });

  it("returns ~0.5 for memories at half TTL", () => {
    const now = new Date();
    const createdAt = new Date(now.getTime() - DEFAULT_MEMORY_TTL / 2);
    const decay = createTestDecay({ createdAt: createdAt.toISOString() });
    expect(calculateFreshnessWeight(decay, now)).toBeCloseTo(0.5, 1);
  });

  it("returns 0.2 (minimum) for memories at or past TTL", () => {
    const now = new Date();
    const createdAt = new Date(now.getTime() - DEFAULT_MEMORY_TTL);
    const decay = createTestDecay({ createdAt: createdAt.toISOString() });
    expect(calculateFreshnessWeight(decay, now)).toBe(0.2);
  });

  it("clamps to minimum 0.2 for expired memories", () => {
    const now = new Date();
    const createdAt = new Date(now.getTime() - DEFAULT_MEMORY_TTL * 2);
    const decay = createTestDecay({ createdAt: createdAt.toISOString() });
    expect(calculateFreshnessWeight(decay, now)).toBe(0.2);
  });

  it("never returns more than 1.0", () => {
    const now = new Date();
    // Future createdAt (edge case)
    const createdAt = new Date(now.getTime() + 1000);
    const decay = createTestDecay({ createdAt: createdAt.toISOString() });
    expect(calculateFreshnessWeight(decay, now)).toBeLessThanOrEqual(1.0);
  });
});

// ============================================================================
// RELEVANCE SCORE TESTS
// ============================================================================

describe("calculateRelevanceScore", () => {
  it("combines all weights correctly", () => {
    const now = new Date();
    const trust = createTestTrust({ validated: true, confidence: 0.5 });
    const decay = createTestDecay({ createdAt: now.toISOString() });

    // similarity=1.0, scope=workspace(1.0), trust=validated(1.0), freshness=1.0
    const score = calculateRelevanceScore(1.0, "workspace", trust, decay, now);
    expect(score).toBeCloseTo(1.0);
  });

  it("workspace memory outranks global at equal similarity", () => {
    const now = new Date();
    const trust = createTestTrust({ validated: true });
    const decay = createTestDecay({ createdAt: now.toISOString() });

    const workspaceScore = calculateRelevanceScore(0.8, "workspace", trust, decay, now);
    const globalScore = calculateRelevanceScore(0.8, "global", trust, decay, now);

    expect(workspaceScore).toBeGreaterThan(globalScore);
    expect(workspaceScore / globalScore).toBeCloseTo(SCOPE_WEIGHTS.workspace / SCOPE_WEIGHTS.global);
  });

  it("unvalidated never scores higher than validated", () => {
    const now = new Date();
    const validatedTrust = createTestTrust({ validated: true, confidence: 0.5 });
    const unvalidatedTrust = createTestTrust({ validated: false, confidence: 0.95 });
    const decay = createTestDecay({ createdAt: now.toISOString() });

    const validatedScore = calculateRelevanceScore(0.8, "workspace", validatedTrust, decay, now);
    const unvalidatedScore = calculateRelevanceScore(0.8, "workspace", unvalidatedTrust, decay, now);

    expect(validatedScore).toBeGreaterThan(unvalidatedScore);
  });

  it("old memories fade (freshness impact)", () => {
    const now = new Date();
    const trust = createTestTrust({ validated: true });

    const freshDecay = createTestDecay({ createdAt: now.toISOString() });
    const oldDecay = createTestDecay({
      createdAt: new Date(now.getTime() - DEFAULT_MEMORY_TTL * 0.8).toISOString()
    });

    const freshScore = calculateRelevanceScore(0.8, "workspace", trust, freshDecay, now);
    const oldScore = calculateRelevanceScore(0.8, "workspace", trust, oldDecay, now);

    expect(freshScore).toBeGreaterThan(oldScore);
  });

  it("handles zero similarity", () => {
    const now = new Date();
    const trust = createTestTrust({ validated: true });
    const decay = createTestDecay({ createdAt: now.toISOString() });

    const score = calculateRelevanceScore(0, "workspace", trust, decay, now);
    expect(score).toBe(0);
  });

  it("handles low confidence unvalidated memory", () => {
    const now = new Date();
    const trust = createTestTrust({ validated: false, confidence: 0.2 });
    const decay = createTestDecay({ createdAt: now.toISOString() });

    // Should be reduced by low confidence
    const score = calculateRelevanceScore(1.0, "workspace", trust, decay, now);
    expect(score).toBeCloseTo(0.2); // 1.0 * 1.0 * 0.2 * 1.0
  });
});

// ============================================================================
// EXPIRATION TESTS
// ============================================================================

describe("isExpired", () => {
  it("returns false for fresh memories", () => {
    const now = new Date();
    const decay = createTestDecay({ createdAt: now.toISOString() });
    expect(isExpired(decay, now)).toBe(false);
  });

  it("returns false for memories before TTL", () => {
    const now = new Date();
    const createdAt = new Date(now.getTime() - DEFAULT_MEMORY_TTL / 2);
    const decay = createTestDecay({ createdAt: createdAt.toISOString() });
    expect(isExpired(decay, now)).toBe(false);
  });

  it("returns false at exactly TTL boundary", () => {
    const now = new Date();
    const createdAt = new Date(now.getTime() - DEFAULT_MEMORY_TTL);
    const decay = createTestDecay({ createdAt: createdAt.toISOString() });
    // At boundary, not expired (> not >=)
    expect(isExpired(decay, now)).toBe(false);
  });

  it("returns true after TTL", () => {
    const now = new Date();
    const createdAt = new Date(now.getTime() - DEFAULT_MEMORY_TTL - 1);
    const decay = createTestDecay({ createdAt: createdAt.toISOString() });
    expect(isExpired(decay, now)).toBe(true);
  });

  it("returns true for long-expired memories", () => {
    const now = new Date();
    const createdAt = new Date(now.getTime() - DEFAULT_MEMORY_TTL * 10);
    const decay = createTestDecay({ createdAt: createdAt.toISOString() });
    expect(isExpired(decay, now)).toBe(true);
  });

  it("handles custom TTL", () => {
    const now = new Date();
    const shortTTL = 1000; // 1 second
    const createdAt = new Date(now.getTime() - 2000); // 2 seconds ago
    const decay: MemoryDecay = {
      ttl: shortTTL,
      createdAt: createdAt.toISOString()
    };
    expect(isExpired(decay, now)).toBe(true);
  });
});

// ============================================================================
// DEFAULT VALUES TESTS
// ============================================================================

describe("DEFAULT_MEMORY_TTL", () => {
  it("is 30 days in milliseconds", () => {
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(DEFAULT_MEMORY_TTL).toBe(thirtyDaysMs);
  });
});

describe("DEFAULT_MEMORY_CONFIDENCE", () => {
  it("is 0.5", () => {
    expect(DEFAULT_MEMORY_CONFIDENCE).toBe(0.5);
  });
});

// ============================================================================
// INVARIANT TESTS
// ============================================================================

describe("Architecture Invariants", () => {
  it("workspace memory always dominates global at equal settings", () => {
    // This ensures the "local context > global noise" principle
    const now = new Date();
    const trust = createTestTrust({ validated: true });
    const decay = createTestDecay({ createdAt: now.toISOString() });

    // Same similarity, trust, freshness - only scope differs
    const workspaceScore = calculateRelevanceScore(1.0, "workspace", trust, decay, now);
    const globalScore = calculateRelevanceScore(1.0, "global", trust, decay, now);

    expect(workspaceScore).toBeGreaterThan(globalScore);
    // Ratio should be scope weight ratio
    expect(workspaceScore / globalScore).toBeCloseTo(2.5); // 1.0 / 0.4
  });

  it("expired memory returns positive freshness (min 0.2)", () => {
    // Ensures even expired memories don't become negative
    const now = new Date();
    const createdAt = new Date(now.getTime() - DEFAULT_MEMORY_TTL * 100);
    const decay = createTestDecay({ createdAt: createdAt.toISOString() });

    const freshness = calculateFreshnessWeight(decay, now);
    expect(freshness).toBe(0.2);
    expect(freshness).toBeGreaterThan(0);
  });

  it("memory types are exhaustive", () => {
    // All types defined in spec
    const expectedTypes: MemoryType[] = [
      "lesson_learned",
      "error_pattern",
      "best_practice",
      "design_decision",
      "verification_outcome"
    ];

    expect(new Set(MEMORY_TYPES)).toEqual(new Set(expectedTypes));
  });
});
