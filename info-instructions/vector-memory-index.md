VECTOR MEMORY INDEX — DESIGN SPECIFICATION

Authoritative, Forward-Compatible

1. PURPOSE & NON-GOALS
Purpose

The Vector Memory Index exists to:

Improve retrieval speed and relevance

Surface prior lessons, errors, and patterns

Reduce repeated mistakes across repos

Support grounding during uncertainty

Non-Goals (Explicitly Locked)

Memory does not grant authority

Memory does not trigger actions

Memory does not override skills, plans, or policy

Memory does not self-persist without approval

2. MEMORY IS AN ADVISORY SYSTEM

Memory results are:

Suggestions

Contextual hints

Historical signals

They are never:

Commands

Instructions

Capabilities

Preconditions for execution

This aligns with your “safest default” stance.

3. MEMORY TYPES (FIRST-CLASS)
MemoryType =
  | "lesson_learned"
  | "error_pattern"
  | "best_practice"
  | "design_decision"
  | "verification_outcome"


These are semantic categories, not roles.

4. MEMORY RECORD SHAPE (CANONICAL)
VectorMemoryRecord {
  id: string
  embedding: number[]
  content: string

  type: MemoryType

  provenance: {
    repoId: string
    workspaceId: string
    taskId?: string
    stepId?: string
    agentRole: RoleType
  }

  trust: {
    confidence: number        // 0.0–1.0
    validated: boolean
    verifierTaskId?: string
  }

  decay: {
    ttl: number               // milliseconds
    createdAt: ISODate
    lastAccessedAt?: ISODate
  }

  scope: "workspace" | "repo" | "global"
}

5. VECTOR MEMORY INDEX INTERFACE (CORE)
interface VectorMemoryIndex {
  // Insert (policy-gated)
  upsert(record: VectorMemoryRecord): Promise<void>

  // Advisory retrieval
  query(params: {
    embedding: number[]
    topK: number
    filters?: {
      repoId?: string
      workspaceId?: string
      type?: MemoryType[]
      minConfidence?: number
    }
  }): Promise<VectorMemoryRecord[]>

  // Maintenance
  decay(now: Date): Promise<number>  // returns pruned count
  stats(): Promise<MemoryStats>
}

6. RETRIEVAL WEIGHTING (CRITICAL)

Final relevance score =

similarityScore
× scopeWeight
× trustWeight
× freshnessWeight

Scope Weights (Locked)
Scope	Weight
workspace	1.0
repo	0.8
global	0.4
Trust Weight
trustWeight = validated ? 1.0 : confidence

Freshness Weight
freshnessWeight = max(0.2, 1 - age / ttl)


This ensures:

Local memory dominates

Old memories fade

Unverified memory is soft-signal only

7. MEMORY DECAY RULES

Decay is mandatory, not optional.

A record is eligible for removal if:

now > createdAt + ttl

Decay should:

Run lazily on read/write

Or on a scheduled sweep

No resurrection of expired memory.

8. MEMORY WRITE GOVERNANCE (POLICY-BOUND)

A memory write requires:

Policy approval

Explicit scope

Declared memory intent

Memory is never written:

Automatically

From planner output

From unverified errors

Recommended writers:

Verifier agent

Supervisor (explicit)

9. ROLE-BASED MEMORY ACCESS (READ)
Role	Read Access
Supervisor	All scopes
Planner	Repo + workspace
Specialist	Workspace + repo
Verifier	All scopes

Still advisory.

10. STORAGE BACKEND (PHASED)
Phase 1 — Safe Default

SQLite

Embeddings stored as BLOB or FLOAT ARRAY

Cosine similarity computed in JS

Pros:

Zero native dependencies

Deterministic

Portable

Phase 2 — Optional Acceleration

SQLite + vector extension or

External store (FAISS, LanceDB, pgvector)

Backend is replaceable behind interface.

11. FAILURE MODES (SAFE BY DESIGN)
Failure	Behavior
Index unavailable	Continue without memory
Query timeout	Return empty set
Corrupt record	Skip + log
Embedding failure	Abort memory use only

Memory can never block execution.

12. TEST REQUIREMENTS FOR OPUS

Opus must implement tests for:

Scope weighting correctness

Decay enforcement

Confidence impact

Advisory-only guarantees

Policy-blocked writes

13. WHY VECTOR MEMORY IS WORTH IT

You are correct — this unlocks:

Faster grounding

Smaller prompt windows

Fewer regressions

Cross-repo institutional learning

Without sacrificing control.

RECOMMENDED NEXT IMPLEMENTATION STEP

For Opus:

Implement VectorMemoryIndex interface

Back with SQLite (no extensions)

Stub embedding provider

Wire reads into Planner + Specialist (advisory only)

Gate writes via Policy Engine