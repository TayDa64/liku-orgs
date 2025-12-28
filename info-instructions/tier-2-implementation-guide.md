TIER-2 IMPLEMENTATION GUIDE

(Execution-Authorized, Architecture-Bound)

This document is for the implementation agent (Opus).
It translates Tier-1 laws into concrete build steps, contracts, and sequencing.
Tier-1 always takes precedence.

0. IMPLEMENTATION RULES (GLOBAL)

Opus must:

Never remove or regress existing functionality

Preserve all passing tests

Implement modularly (small files, narrow scope)

Escalate if Tier-1 intent is unclear

Use grounding (docs, specs) when uncertain

Treat malformed outputs as contract violations, not “best guesses”

1. CURRENT BASELINE (DO NOT REBUILD)

Already implemented and considered stable:

Orchestrator core

Task registry

Capability taxonomy

Escalation plumbing

Event system

Memory provenance metadata

Planner validation

Contract violation retry → verifier → human escalation flow

No rewrites. Extensions only.

2. NEXT IMPLEMENTATION PHASES (ORDERED)
Phase 1 — Verifier Agent Contract (Highest Priority)
Goal

Formalize the Verifier as a pure audit agent with zero mutation authority.

Deliverables

Create a new module:

agents/
  verifier/
    verifierContract.ts
    verifierTypes.ts

Verifier Contract MUST:

Accept:

Artifact

Declared contract

Context metadata

Output:

verdict: pass | fail

violations[] (typed)

guidance (human-readable, grounded)

escalationRecommended: boolean

Explicit Prohibitions

No tool calls

No artifact modification

No memory writes

Violations route back to orchestrator only.

Phase 2 — Skill Taxonomy + Hierarchical Binding
Goal

Make skills explicit, hierarchical, and capability-scoped.

Required Artifacts
skills/
  base.xml
  planner.xml
  specialist/
    code.xml
    infra.xml
    docs.xml

Rules

Skills declare:

Required capabilities

Allowed tools

Escalation conditions

Planner can reference skills

Specialists can execute skills

Skills cannot self-elevate

Hierarchy resolution must be deterministic.

Phase 3 — System Instruction XML (Per Role)
Goal

Guarantee agents acknowledge and bind to their role law.

Required Mechanism

Each agent initialization must include:

system/
  supervisor.xml
  planner.xml
  specialist.xml
  verifier.xml


Each XML must include:

Role purpose

Explicit prohibitions

Escalation rules

Memory interaction rules

Acknowledgement Protocol

Agent must emit:

ack:
  role: <role>
  version: <hash>
  accepted: true


Failure → hard stop.

Phase 4 — Policy Engine (Formalization)
Goal

Centralize all authority decisions.

Required Module
policy/
  policyEngine.ts
  policyTypes.ts


Policy Engine evaluates:

Capability requests

Escalation requests

Memory write requests

Inputs:

Request

Role

Skill

User settings

Outputs:

approved | denied

reason (auditable)

No agent bypass permitted.

Phase 5 — Vector Memory Index (Feature-Flagged)
Goal

Efficient advisory memory retrieval.

Constraints

Memory remains advisory

Workspace memory prioritized

Similarity ≠ truth

Initial Interface (Draft)
memory/
  vector/
    VectorMemoryIndex.ts

interface VectorMemoryIndex {
  upsert(entry: MemoryEntry): Promise<void>
  query(query: string, opts: {
    scopePriority: Scope[]
    maxResults: number
    minConfidence?: number
  }): Promise<MemoryEntry[]>
  decay(now: Date): Promise<void>
}


Storage backend TBD (SQLite w/ extension or alternative).

3. ESCALATION COMPLETION GUARANTEE

Every escalation:

Has an ID

Has an owner

Has a terminal state

Auto-closes on resolution

No dangling escalations.

4. ACCEPTANCE CRITERIA

Phase considered complete when:

Tests added

No Tier-1 violations

Contracts enforced

No agent gains implicit authority

5. STOP CONDITIONS

Opus must halt and escalate if:

A decision would alter Tier-1

Authority boundaries blur

Memory begins influencing policy

Planner attempts execution

6. PLANNER FAILURE SEMANTICS

If the Planner cannot produce a valid plan, it MUST:

1. Emit a structured `PlanningFailure`
2. Halt immediately
3. Return control to Supervisor

```typescript
type PlanningFailure = {
  kind: "planning_failure";
  reason: string;
  blockers: {
    missingSkills?: string[];
    missingCapabilities?: CapabilityType[];
    policyDenials?: string[];
  };
  conflicts?: {
    requirement1: string;
    requirement2: string;
    explanation: string;
  }[];
  suggestions: string[];
  escalationRecommended: boolean;
};
```

Planner MUST NOT:
- Degrade silently to partial plans
- Attempt "best effort" execution
- Implicitly escalate (escalation is always explicit and ticket-based)

7. USER INSTRUCTION HANDLING

See: `info-instructions/user-instruction-lifecycle.md`

Key rules for implementation:
- Supervisor parses raw input into `UserIntentEnvelope`
- Planner receives envelope, never raw input
- Instructions are ephemeral by default
- Persistence requires Policy approval + Verifier validation

8. MEMORY → POLICY ISOLATION

**INVARIANT**: PolicyEngine must not accept memory-derived inputs.

This means:
- No embeddings passed to policy evaluation
- No similarity scores influencing decisions
- No "context enrichment" from memory before policy check

Policy operates on:
- Skill definitions
- Role declarations
- User settings
- Capability requests

Nothing else.