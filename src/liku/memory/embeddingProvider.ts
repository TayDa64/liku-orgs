/**
 * Embedding Provider Implementations (VM-04)
 *
 * Provides concrete implementations of the EmbeddingProvider interface.
 *
 * ARCHITECTURE GUARDRAILS:
 * - Default providers make NO external API calls
 * - External providers (OpenAI, etc.) are opt-in via BYOK configuration
 * - Embeddings are for ADVISORY memory only (never policy inputs)
 *
 * @see info-instructions/vector-memory-index.md
 */

import { createHash } from "node:crypto";
import type { EmbeddingProvider } from "./vectorMemoryTypes.js";
import { DEFAULT_EMBEDDING_DIMENSIONS } from "./vectorMemoryTypes.js";

// =============================================================================
// NOOP EMBEDDING PROVIDER
// =============================================================================

/**
 * A no-operation embedding provider that returns zero vectors.
 *
 * Use cases:
 * - Disabling embedding functionality without code changes
 * - Placeholder when no embedding is needed
 * - Testing code paths that don't depend on embedding values
 *
 * All vectors returned are zeros with the specified dimensions.
 * Cosine similarity between any two Noop embeddings is undefined (0/0).
 */
export class NoopEmbeddingProvider implements EmbeddingProvider {
  readonly providerId = "noop";
  readonly dimensions: number;

  private readonly zeroVector: readonly number[];

  constructor(dimensions: number = DEFAULT_EMBEDDING_DIMENSIONS) {
    if (dimensions <= 0 || !Number.isInteger(dimensions)) {
      throw new Error(`Dimensions must be a positive integer, got: ${dimensions}`);
    }
    this.dimensions = dimensions;
    this.zeroVector = Object.freeze(new Array(dimensions).fill(0));
  }

  /**
   * Returns a zero vector.
   *
   * Note: Cosine similarity is undefined for zero vectors.
   */
  async embed(_text: string): Promise<readonly number[]> {
    return this.zeroVector;
  }
}

// =============================================================================
// HASH EMBEDDING PROVIDER
// =============================================================================

/**
 * A deterministic embedding provider using cryptographic hashing.
 *
 * Use cases:
 * - Testing with predictable, reproducible embeddings
 * - Development without external API dependencies
 * - Generating embeddings offline
 *
 * Properties:
 * - **Deterministic**: Same input always produces same output
 * - **Fast**: No network calls, pure computation
 * - **Pseudo-semantic**: Similar texts may have some correlation due to
 *   hash properties, but this is NOT true semantic similarity
 * - **Normalized**: Output vectors are unit-normalized for cosine similarity
 *
 * Algorithm:
 * 1. Hash the input text with SHA-512
 * 2. Expand hash bytes to fill required dimensions
 * 3. Convert bytes to floats in [-1, 1] range
 * 4. Normalize to unit vector (L2 norm = 1)
 *
 * WARNING: This is NOT a semantic embedding provider. It does not understand
 * meaning. Use only for testing and development.
 */
export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly providerId = "hash";
  readonly dimensions: number;

  private readonly seed: string;

  /**
   * Create a hash-based embedding provider.
   *
   * @param dimensions - Output vector dimensions (default: 128)
   * @param seed - Optional seed for hash variation (default: empty)
   */
  constructor(
    dimensions: number = DEFAULT_EMBEDDING_DIMENSIONS,
    seed: string = ""
  ) {
    if (dimensions <= 0 || !Number.isInteger(dimensions)) {
      throw new Error(`Dimensions must be a positive integer, got: ${dimensions}`);
    }
    this.dimensions = dimensions;
    this.seed = seed;
  }

  /**
   * Generate a deterministic embedding from text.
   *
   * The embedding is:
   * - Deterministic: same text → same vector
   * - Normalized: ||vector|| = 1 (unit length)
   * - Bounded: all values in [-1, 1]
   */
  async embed(text: string): Promise<readonly number[]> {
    // Combine seed and text for hashing
    const input = this.seed + text;

    // Generate enough hash bytes to fill dimensions
    // Each float needs 1 byte, so we need `dimensions` bytes minimum
    const hashBytes = this.generateHashBytes(input, this.dimensions);

    // Convert bytes to floats in [-1, 1] range
    const rawVector = new Array<number>(this.dimensions);
    for (let i = 0; i < this.dimensions; i++) {
      // Convert byte (0-255) to float (-1 to 1)
      rawVector[i] = (hashBytes[i]! / 127.5) - 1;
    }

    // Normalize to unit vector
    const normalized = this.normalize(rawVector);

    return Object.freeze(normalized);
  }

  /**
   * Generate enough hash bytes to fill the required length.
   *
   * Uses SHA-512 with chaining if more than 64 bytes needed.
   */
  private generateHashBytes(input: string, length: number): Uint8Array {
    const result = new Uint8Array(length);
    let offset = 0;
    let counter = 0;

    while (offset < length) {
      // Hash with counter to get different blocks
      const hashInput = counter === 0 ? input : `${counter}:${input}`;
      const hash = createHash("sha512").update(hashInput).digest();

      // Copy as many bytes as we need
      const bytesToCopy = Math.min(hash.length, length - offset);
      result.set(hash.subarray(0, bytesToCopy), offset);

      offset += bytesToCopy;
      counter++;
    }

    return result;
  }

  /**
   * Normalize a vector to unit length (L2 norm = 1).
   *
   * If the vector is all zeros, returns the zero vector unchanged.
   */
  private normalize(vector: number[]): number[] {
    // Calculate L2 norm (Euclidean length)
    let sumSquares = 0;
    for (const v of vector) {
      sumSquares += v * v;
    }
    const norm = Math.sqrt(sumSquares);

    // Handle zero vector (avoid division by zero)
    if (norm === 0) {
      return vector;
    }

    // Normalize
    return vector.map((v) => v / norm);
  }
}

// =============================================================================
// RANDOM EMBEDDING PROVIDER (FOR TESTING VARIANCE)
// =============================================================================

/**
 * A random embedding provider for testing scenarios requiring variation.
 *
 * Use cases:
 * - Testing with diverse embeddings
 * - Simulating real embedding variance
 * - Stress testing similarity calculations
 *
 * Properties:
 * - **Non-deterministic**: Same input produces different outputs
 * - **Normalized**: Output vectors are unit-normalized
 * - **Configurable seed**: Use seed for reproducible randomness in tests
 *
 * WARNING: For deterministic tests, use HashEmbeddingProvider instead.
 */
export class RandomEmbeddingProvider implements EmbeddingProvider {
  readonly providerId = "random";
  readonly dimensions: number;

  private readonly rng: () => number;

  /**
   * Create a random embedding provider.
   *
   * @param dimensions - Output vector dimensions
   * @param seed - Optional seed for reproducible randomness (uses simple LCG)
   */
  constructor(
    dimensions: number = DEFAULT_EMBEDDING_DIMENSIONS,
    seed?: number
  ) {
    if (dimensions <= 0 || !Number.isInteger(dimensions)) {
      throw new Error(`Dimensions must be a positive integer, got: ${dimensions}`);
    }
    this.dimensions = dimensions;

    // Use seeded RNG if seed provided, otherwise Math.random
    if (seed !== undefined) {
      this.rng = this.createSeededRng(seed);
    } else {
      this.rng = Math.random;
    }
  }

  /**
   * Generate a random normalized embedding.
   */
  async embed(_text: string): Promise<readonly number[]> {
    // Generate random values in [-1, 1]
    const rawVector = new Array<number>(this.dimensions);
    for (let i = 0; i < this.dimensions; i++) {
      rawVector[i] = (this.rng() * 2) - 1;
    }

    // Normalize to unit vector
    const normalized = this.normalize(rawVector);

    return Object.freeze(normalized);
  }

  /**
   * Create a seeded pseudo-random number generator using LCG algorithm.
   *
   * Linear Congruential Generator with parameters from Numerical Recipes.
   */
  private createSeededRng(seed: number): () => number {
    let state = seed >>> 0; // Ensure unsigned 32-bit

    return () => {
      // LCG: state = (a * state + c) mod m
      // Using parameters from Numerical Recipes
      state = ((state * 1664525) + 1013904223) >>> 0;
      return state / 4294967296; // Normalize to [0, 1)
    };
  }

  /**
   * Normalize a vector to unit length.
   */
  private normalize(vector: number[]): number[] {
    let sumSquares = 0;
    for (const v of vector) {
      sumSquares += v * v;
    }
    const norm = Math.sqrt(sumSquares);

    if (norm === 0) {
      return vector;
    }

    return vector.map((v) => v / norm);
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a default embedding provider for testing.
 *
 * Uses HashEmbeddingProvider with default dimensions.
 */
export function createTestEmbeddingProvider(
  dimensions: number = DEFAULT_EMBEDDING_DIMENSIONS
): EmbeddingProvider {
  return new HashEmbeddingProvider(dimensions);
}

/**
 * Create a noop embedding provider that returns zero vectors.
 */
export function createNoopEmbeddingProvider(
  dimensions: number = DEFAULT_EMBEDDING_DIMENSIONS
): EmbeddingProvider {
  return new NoopEmbeddingProvider(dimensions);
}

// =============================================================================
// COMPOSITE EMBEDDING PROVIDER
// =============================================================================

/**
 * A composite embedding provider that caches embeddings in memory.
 *
 * Wraps another provider and caches results to avoid recomputation.
 * Useful for testing scenarios where the same text is embedded multiple times.
 */
export class CachingEmbeddingProvider implements EmbeddingProvider {
  readonly providerId: string;
  readonly dimensions: number;

  private readonly delegate: EmbeddingProvider;
  private readonly cache: Map<string, readonly number[]>;
  private readonly maxCacheSize: number;

  /**
   * Create a caching wrapper around another embedding provider.
   *
   * @param delegate - The underlying provider to cache
   * @param maxCacheSize - Maximum cache entries (default: 1000)
   */
  constructor(delegate: EmbeddingProvider, maxCacheSize: number = 1000) {
    this.delegate = delegate;
    this.dimensions = delegate.dimensions;
    this.providerId = `cached-${delegate.providerId}`;
    this.cache = new Map();
    this.maxCacheSize = maxCacheSize;
  }

  /**
   * Get embedding from cache or delegate.
   */
  async embed(text: string): Promise<readonly number[]> {
    const cached = this.cache.get(text);
    if (cached !== undefined) {
      return cached;
    }

    const embedding = await this.delegate.embed(text);

    // Evict oldest entry if cache is full (simple FIFO)
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(text, embedding);
    return embedding;
  }

  /**
   * Get current cache size.
   */
  get cacheSize(): number {
    return this.cache.size;
  }

  /**
   * Clear the cache.
   */
  clearCache(): void {
    this.cache.clear();
  }
}
