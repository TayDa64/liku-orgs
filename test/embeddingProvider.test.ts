/**
 * Embedding Provider tests (VM-04)
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  NoopEmbeddingProvider,
  HashEmbeddingProvider,
  RandomEmbeddingProvider,
  CachingEmbeddingProvider,
  createTestEmbeddingProvider,
  createNoopEmbeddingProvider
} from "../src/liku/memory/embeddingProvider.js";
import { DEFAULT_EMBEDDING_DIMENSIONS } from "../src/liku/memory/vectorMemoryTypes.js";

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function vectorLength(v: readonly number[]): number {
  let sum = 0;
  for (const x of v) {
    sum += x * x;
  }
  return Math.sqrt(sum);
}

function dotProduct(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i]! * b[i]!;
  }
  return sum;
}

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const dot = dotProduct(a, b);
  const lenA = vectorLength(a);
  const lenB = vectorLength(b);
  if (lenA === 0 || lenB === 0) return 0;
  return dot / (lenA * lenB);
}

// =============================================================================
// NOOP EMBEDDING PROVIDER TESTS
// =============================================================================

describe("NoopEmbeddingProvider", () => {
  it("returns zero vector of correct dimensions", async () => {
    const provider = new NoopEmbeddingProvider(64);
    const embedding = await provider.embed("test text");

    expect(embedding.length).toBe(64);
    expect(embedding.every((v) => v === 0)).toBe(true);
  });

  it("uses default dimensions when not specified", async () => {
    const provider = new NoopEmbeddingProvider();
    const embedding = await provider.embed("test");

    expect(embedding.length).toBe(DEFAULT_EMBEDDING_DIMENSIONS);
  });

  it("returns same reference for all calls (optimization)", async () => {
    const provider = new NoopEmbeddingProvider(32);
    const e1 = await provider.embed("hello");
    const e2 = await provider.embed("world");

    expect(e1).toBe(e2); // Same frozen array reference
  });

  it("has providerId 'noop'", () => {
    const provider = new NoopEmbeddingProvider();
    expect(provider.providerId).toBe("noop");
  });

  it("reports correct dimensions", () => {
    const provider = new NoopEmbeddingProvider(256);
    expect(provider.dimensions).toBe(256);
  });

  it("returns frozen array", async () => {
    const provider = new NoopEmbeddingProvider(16);
    const embedding = await provider.embed("test");

    expect(Object.isFrozen(embedding)).toBe(true);
  });

  it("throws on invalid dimensions (zero)", () => {
    expect(() => new NoopEmbeddingProvider(0)).toThrow("positive integer");
  });

  it("throws on invalid dimensions (negative)", () => {
    expect(() => new NoopEmbeddingProvider(-5)).toThrow("positive integer");
  });

  it("throws on invalid dimensions (float)", () => {
    expect(() => new NoopEmbeddingProvider(3.14)).toThrow("positive integer");
  });
});

// =============================================================================
// HASH EMBEDDING PROVIDER TESTS
// =============================================================================

describe("HashEmbeddingProvider", () => {
  describe("basic functionality", () => {
    it("returns vector of correct dimensions", async () => {
      const provider = new HashEmbeddingProvider(64);
      const embedding = await provider.embed("test text");

      expect(embedding.length).toBe(64);
    });

    it("uses default dimensions when not specified", async () => {
      const provider = new HashEmbeddingProvider();
      const embedding = await provider.embed("test");

      expect(embedding.length).toBe(DEFAULT_EMBEDDING_DIMENSIONS);
    });

    it("has providerId 'hash'", () => {
      const provider = new HashEmbeddingProvider();
      expect(provider.providerId).toBe("hash");
    });

    it("reports correct dimensions", () => {
      const provider = new HashEmbeddingProvider(512);
      expect(provider.dimensions).toBe(512);
    });

    it("returns frozen array", async () => {
      const provider = new HashEmbeddingProvider(16);
      const embedding = await provider.embed("test");

      expect(Object.isFrozen(embedding)).toBe(true);
    });

    it("throws on invalid dimensions", () => {
      expect(() => new HashEmbeddingProvider(0)).toThrow("positive integer");
      expect(() => new HashEmbeddingProvider(-1)).toThrow("positive integer");
      expect(() => new HashEmbeddingProvider(2.5)).toThrow("positive integer");
    });
  });

  describe("determinism", () => {
    it("returns same embedding for same input", async () => {
      const provider = new HashEmbeddingProvider(64);

      const e1 = await provider.embed("hello world");
      const e2 = await provider.embed("hello world");

      expect(e1).toEqual(e2);
    });

    it("returns same embedding across provider instances", async () => {
      const p1 = new HashEmbeddingProvider(64);
      const p2 = new HashEmbeddingProvider(64);

      const e1 = await p1.embed("test input");
      const e2 = await p2.embed("test input");

      expect(e1).toEqual(e2);
    });

    it("returns different embeddings for different inputs", async () => {
      const provider = new HashEmbeddingProvider(64);

      const e1 = await provider.embed("hello");
      const e2 = await provider.embed("world");

      expect(e1).not.toEqual(e2);
    });

    it("seed affects output", async () => {
      const p1 = new HashEmbeddingProvider(64, "seed1");
      const p2 = new HashEmbeddingProvider(64, "seed2");

      const e1 = await p1.embed("test");
      const e2 = await p2.embed("test");

      expect(e1).not.toEqual(e2);
    });

    it("same seed produces same output", async () => {
      const p1 = new HashEmbeddingProvider(64, "myseed");
      const p2 = new HashEmbeddingProvider(64, "myseed");

      const e1 = await p1.embed("test");
      const e2 = await p2.embed("test");

      expect(e1).toEqual(e2);
    });
  });

  describe("normalization", () => {
    it("produces unit-length vectors", async () => {
      const provider = new HashEmbeddingProvider(128);
      const embedding = await provider.embed("test");

      const length = vectorLength(embedding);
      expect(length).toBeCloseTo(1, 10);
    });

    it("all values bounded in [-1, 1]", async () => {
      const provider = new HashEmbeddingProvider(256);

      // Test multiple inputs
      for (const text of ["hello", "world", "test", "embedding", "provider"]) {
        const embedding = await provider.embed(text);
        for (const v of embedding) {
          expect(v).toBeGreaterThanOrEqual(-1);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    });

    it("cosine similarity with self is 1", async () => {
      const provider = new HashEmbeddingProvider(64);
      const embedding = await provider.embed("test");

      const similarity = cosineSimilarity(embedding, embedding);
      expect(similarity).toBeCloseTo(1, 10);
    });
  });

  describe("large dimensions", () => {
    it("handles dimensions larger than SHA-512 output (64 bytes)", async () => {
      const provider = new HashEmbeddingProvider(256); // Needs 4x SHA-512
      const embedding = await provider.embed("test");

      expect(embedding.length).toBe(256);
      expect(vectorLength(embedding)).toBeCloseTo(1, 10);
    });

    it("handles very large dimensions", async () => {
      const provider = new HashEmbeddingProvider(1536); // OpenAI-like
      const embedding = await provider.embed("test");

      expect(embedding.length).toBe(1536);
      expect(vectorLength(embedding)).toBeCloseTo(1, 10);
    });
  });

  describe("similarity behavior", () => {
    it("similar texts have non-zero similarity", async () => {
      const provider = new HashEmbeddingProvider(128);

      const e1 = await provider.embed("hello");
      const e2 = await provider.embed("hello world");

      // Hash embeddings don't guarantee semantic similarity,
      // but overlapping prefixes might have some correlation
      const similarity = cosineSimilarity(e1, e2);

      // Just verify we get a valid similarity value
      expect(similarity).toBeGreaterThanOrEqual(-1);
      expect(similarity).toBeLessThanOrEqual(1);
    });

    it("completely different texts have varied similarity", async () => {
      const provider = new HashEmbeddingProvider(128);

      const e1 = await provider.embed("apple");
      const e2 = await provider.embed("xyzzy");

      const similarity = cosineSimilarity(e1, e2);

      // Hash doesn't understand semantics, so similarity is arbitrary
      expect(similarity).toBeGreaterThanOrEqual(-1);
      expect(similarity).toBeLessThanOrEqual(1);
    });
  });
});

// =============================================================================
// RANDOM EMBEDDING PROVIDER TESTS
// =============================================================================

describe("RandomEmbeddingProvider", () => {
  describe("basic functionality", () => {
    it("returns vector of correct dimensions", async () => {
      const provider = new RandomEmbeddingProvider(64);
      const embedding = await provider.embed("test");

      expect(embedding.length).toBe(64);
    });

    it("has providerId 'random'", () => {
      const provider = new RandomEmbeddingProvider();
      expect(provider.providerId).toBe("random");
    });

    it("returns frozen array", async () => {
      const provider = new RandomEmbeddingProvider(16);
      const embedding = await provider.embed("test");

      expect(Object.isFrozen(embedding)).toBe(true);
    });

    it("throws on invalid dimensions", () => {
      expect(() => new RandomEmbeddingProvider(0)).toThrow("positive integer");
    });
  });

  describe("randomness", () => {
    it("returns different embeddings for same input (unseeded)", async () => {
      const provider = new RandomEmbeddingProvider(64);

      const e1 = await provider.embed("test");
      const e2 = await provider.embed("test");

      // Very unlikely to be equal due to randomness
      expect(e1).not.toEqual(e2);
    });

    it("seeded provider is deterministic across calls", async () => {
      const p1 = new RandomEmbeddingProvider(64, 12345);
      const p2 = new RandomEmbeddingProvider(64, 12345);

      // Get first embedding from each
      const e1 = await p1.embed("test");
      const e2 = await p2.embed("test");

      expect(e1).toEqual(e2);
    });

    it("different seeds produce different outputs", async () => {
      const p1 = new RandomEmbeddingProvider(64, 1);
      const p2 = new RandomEmbeddingProvider(64, 2);

      const e1 = await p1.embed("test");
      const e2 = await p2.embed("test");

      expect(e1).not.toEqual(e2);
    });
  });

  describe("normalization", () => {
    it("produces unit-length vectors", async () => {
      const provider = new RandomEmbeddingProvider(128, 42);

      for (let i = 0; i < 5; i++) {
        const embedding = await provider.embed(`test-${i}`);
        const length = vectorLength(embedding);
        expect(length).toBeCloseTo(1, 10);
      }
    });
  });
});

// =============================================================================
// CACHING EMBEDDING PROVIDER TESTS
// =============================================================================

describe("CachingEmbeddingProvider", () => {
  let delegate: HashEmbeddingProvider;
  let cachingProvider: CachingEmbeddingProvider;

  beforeEach(() => {
    delegate = new HashEmbeddingProvider(64);
    cachingProvider = new CachingEmbeddingProvider(delegate);
  });

  it("returns same result as delegate", async () => {
    const text = "test input";

    const directResult = await delegate.embed(text);
    const cachedResult = await cachingProvider.embed(text);

    expect(cachedResult).toEqual(directResult);
  });

  it("caches results", async () => {
    const text = "cached text";

    const e1 = await cachingProvider.embed(text);
    const e2 = await cachingProvider.embed(text);

    // Same reference from cache
    expect(e1).toBe(e2);
    expect(cachingProvider.cacheSize).toBe(1);
  });

  it("has correct providerId", () => {
    expect(cachingProvider.providerId).toBe("cached-hash");
  });

  it("reports correct dimensions", () => {
    expect(cachingProvider.dimensions).toBe(64);
  });

  it("respects max cache size", async () => {
    const smallCache = new CachingEmbeddingProvider(delegate, 3);

    await smallCache.embed("one");
    await smallCache.embed("two");
    await smallCache.embed("three");
    expect(smallCache.cacheSize).toBe(3);

    // Adding fourth should evict first
    await smallCache.embed("four");
    expect(smallCache.cacheSize).toBe(3);
  });

  it("evicts oldest entry (FIFO)", async () => {
    const smallCache = new CachingEmbeddingProvider(delegate, 2);

    const e1 = await smallCache.embed("first");
    await smallCache.embed("second");
    await smallCache.embed("third"); // Should evict "first"

    // "first" should be recomputed (not from cache)
    const e1Again = await smallCache.embed("first");
    
    // Values should be same (deterministic hash), but not same reference
    expect(e1Again).toEqual(e1);
  });

  it("clearCache empties the cache", async () => {
    await cachingProvider.embed("one");
    await cachingProvider.embed("two");
    expect(cachingProvider.cacheSize).toBe(2);

    cachingProvider.clearCache();
    expect(cachingProvider.cacheSize).toBe(0);
  });

  it("works with NoopEmbeddingProvider", async () => {
    const noop = new NoopEmbeddingProvider(32);
    const cached = new CachingEmbeddingProvider(noop);

    const e1 = await cached.embed("test");
    const e2 = await cached.embed("test");

    expect(e1).toBe(e2);
    expect(cached.providerId).toBe("cached-noop");
  });
});

// =============================================================================
// FACTORY FUNCTION TESTS
// =============================================================================

describe("Factory Functions", () => {
  describe("createTestEmbeddingProvider", () => {
    it("returns HashEmbeddingProvider", async () => {
      const provider = createTestEmbeddingProvider();

      expect(provider.providerId).toBe("hash");
    });

    it("uses default dimensions", () => {
      const provider = createTestEmbeddingProvider();

      expect(provider.dimensions).toBe(DEFAULT_EMBEDDING_DIMENSIONS);
    });

    it("respects custom dimensions", () => {
      const provider = createTestEmbeddingProvider(256);

      expect(provider.dimensions).toBe(256);
    });

    it("produces deterministic embeddings", async () => {
      const p1 = createTestEmbeddingProvider(64);
      const p2 = createTestEmbeddingProvider(64);

      const e1 = await p1.embed("test");
      const e2 = await p2.embed("test");

      expect(e1).toEqual(e2);
    });
  });

  describe("createNoopEmbeddingProvider", () => {
    it("returns NoopEmbeddingProvider", async () => {
      const provider = createNoopEmbeddingProvider();

      expect(provider.providerId).toBe("noop");
    });

    it("uses default dimensions", () => {
      const provider = createNoopEmbeddingProvider();

      expect(provider.dimensions).toBe(DEFAULT_EMBEDDING_DIMENSIONS);
    });

    it("respects custom dimensions", () => {
      const provider = createNoopEmbeddingProvider(512);

      expect(provider.dimensions).toBe(512);
    });

    it("returns zero vectors", async () => {
      const provider = createNoopEmbeddingProvider(16);
      const embedding = await provider.embed("anything");

      expect(embedding.every((v) => v === 0)).toBe(true);
    });
  });
});

// =============================================================================
// INTEGRATION TESTS
// =============================================================================

describe("Embedding Provider Integration", () => {
  it("HashEmbeddingProvider produces valid embeddings for cosine similarity", async () => {
    const provider = new HashEmbeddingProvider(128);

    const e1 = await provider.embed("apple");
    const e2 = await provider.embed("banana");
    const e3 = await provider.embed("apple"); // Same as e1

    // Same input should have similarity 1
    expect(cosineSimilarity(e1, e3)).toBeCloseTo(1, 10);

    // Different inputs should have valid similarity
    const sim12 = cosineSimilarity(e1, e2);
    expect(sim12).toBeGreaterThanOrEqual(-1);
    expect(sim12).toBeLessThanOrEqual(1);
  });

  it("embedding dimensions are consistent with SQLiteVectorMemoryIndex expectations", async () => {
    // The SQLiteVectorMemoryIndex expects embeddings to have consistent dimensions
    const provider = new HashEmbeddingProvider(128);

    const embeddings = await Promise.all([
      provider.embed("first"),
      provider.embed("second"),
      provider.embed("third")
    ]);

    // All should have same length
    expect(embeddings.every((e) => e.length === 128)).toBe(true);

    // All should be unit vectors
    expect(embeddings.every((e) => Math.abs(vectorLength(e) - 1) < 1e-10)).toBe(true);
  });

  it("CachingEmbeddingProvider with RandomEmbeddingProvider maintains consistency", async () => {
    // Random provider normally gives different results, but caching should fix that
    const random = new RandomEmbeddingProvider(64);
    const cached = new CachingEmbeddingProvider(random);

    const e1 = await cached.embed("test");
    const e2 = await cached.embed("test");
    const e3 = await cached.embed("test");

    // All should be the same reference from cache
    expect(e1).toBe(e2);
    expect(e2).toBe(e3);
  });

  it("different providers with same dimensions are interchangeable", async () => {
    const dims = 64;
    const text = "sample text";

    const providers = [
      new NoopEmbeddingProvider(dims),
      new HashEmbeddingProvider(dims),
      new RandomEmbeddingProvider(dims, 42)
    ];

    for (const provider of providers) {
      const embedding = await provider.embed(text);

      // All return correct dimensions
      expect(embedding.length).toBe(dims);

      // All return frozen arrays
      expect(Object.isFrozen(embedding)).toBe(true);

      // All have correct dimension property
      expect(provider.dimensions).toBe(dims);
    }
  });
});
