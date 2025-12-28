TICKET VM-01 — Define VectorMemoryIndex Interface

Priority: P0 (Foundational)
Blocks: All other VM tickets

Objective

Introduce the canonical VectorMemoryIndex interface and types without implementation.

Scope

Create memory/vectorMemoryIndex.ts

Export:

VectorMemoryIndex

VectorMemoryRecord

MemoryType

MemoryStats

Acceptance Criteria

Pure TypeScript types/interfaces only

No imports from storage or embeddings

Compiles with no side effects

Tests

Type-level tests only (if applicable)

TICKET VM-02 — SQLite Schema for Vector Memory

Priority: P0
Depends on: VM-01

Objective

Design and create a SQLite schema that can store vector memory records.

Scope

Create migration or initialization SQL defining:

vector_memory table with:

id

embedding (BLOB or JSON)

content

type

scope

provenance fields

confidence

validated

ttl

timestamps

Constraints

No SQLite extensions

Schema must be forward-compatible

Acceptance Criteria

Schema loads on fresh DB

Schema supports indexing on scope + repoId

TICKET VM-03 — SQLiteVectorMemoryIndex (Baseline Implementation)

Priority: P0
Depends on: VM-01, VM-02

Objective

Implement VectorMemoryIndex using SQLite with in-process cosine similarity.

Scope

Create memory/sqliteVectorMemoryIndex.ts

Implement:

upsert()

query()

decay()

stats()

Constraints

Similarity computed in JS

Fail-open on query errors

No policy logic inside this class

Acceptance Criteria

Query returns empty set on failure

Decay physically removes expired rows

TICKET VM-04 — Embedding Provider Interface (Stub)

Priority: P1
Depends on: VM-01

Objective

Abstract embedding generation behind a replaceable interface.

Scope

Create:

interface EmbeddingProvider {
  embed(text: string): Promise<number[]>
  dimensions: number
  provider: string
}


Provide:

NoopEmbeddingProvider (returns zero vectors)

HashEmbeddingProvider (deterministic, test-safe)

Acceptance Criteria

VectorMemoryIndex does not care which provider is used

No external API calls

TICKET VM-05 — Retrieval Weighting & Ranking Logic

Priority: P1
Depends on: VM-03

Objective

Implement deterministic scoring based on locked rules.

Scope

Apply:

finalScore =
  similarity
  × scopeWeight
  × trustWeight
  × freshnessWeight

Acceptance Criteria

Workspace memory always outranks global at equal similarity

Unvalidated memory never scores higher than validated memory

Expired memory is never returned

TICKET VM-06 — Policy-Gated Memory Writes

Priority: P1
Depends on: Policy Engine, VM-03

Objective

Ensure memory writes are impossible without policy approval.

Scope

Add PolicyEngine.evaluate() call before upsert

Enforce:

role eligibility

scope permission

user settings

Acceptance Criteria

Unauthorized writes fail silently (logged, not thrown)

Reads remain unrestricted

TICKET VM-07 — Planner & Specialist Advisory Read Integration

Priority: P2
Depends on: VM-03, VM-05

Objective

Surface memory during reasoning without authority leakage.

Scope

Planner:

Query memory before plan synthesis

Specialist:

Query memory before execution

Constraints

Memory results passed as context only

Must be labeled ADVISORY_CONTEXT

Acceptance Criteria

Removing memory has zero effect on correctness

Execution proceeds if memory unavailable

TICKET VM-08 — Verifier-Authored Memory Writes

Priority: P2
Depends on: VM-06

Objective

Allow verified outcomes to be persisted as memory.

Scope

Verifier may propose memory writes

Supervisor confirms via policy

Memory written with:

validated = true

confidence ≥ 0.8

Acceptance Criteria

Only verifier-origin memory can be validated

Confidence affects ranking

TICKET VM-09 — Memory Decay Scheduler

Priority: P2
Depends on: VM-03

Objective

Ensure memory decay happens even without reads.

Scope

Add lazy decay on:

startup

periodic interval (configurable)

Acceptance Criteria

Expired memory never survives restart

Decay failures do not crash system

TICKET VM-10 — Test Suite & Invariants

Priority: P0 (Non-negotiable)

Required Tests

Scope weighting

Confidence impact

TTL decay

Advisory-only behavior

Policy-blocked writes

Fail-open read behavior

Acceptance Criteria

100% deterministic

No external dependencies

No snapshot-based assertions

WHY THIS TICKET SET WORKS

No ticket requires interpretation

No circular dependencies

Memory can be removed without breaking orchestration

Future vector backends slot in cleanly

This is enterprise-grade, model-agnostic, and future-proof.