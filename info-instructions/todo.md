# LIKU SYSTEM IMPLEMENTATION TODO

> **Generated**: December 28, 2025  
> **Status**: Master Implementation Tracker  
> **Authority**: This document tracks implementations outlined in `info-instructions/` against current codebase state.

---

## IMPLEMENTATION PRIORITIES

| Priority | Phase | Description | Status |
|----------|-------|-------------|--------|
| P0 | 0 | Architecture Addenda (ChatGPT insights) | 🟢 Complete |
| P0 | 1 | Skills Schema XSD Enforcement | 🟢 Complete (1.1-1.3) |
| P0 | 2 | Policy Engine Formalization | 🟢 Complete (2.1-2.4) |
| P0 | 3 | Vector Memory Index Interface | � In Progress (3.1 done) |
| P0 | 4 | Verifier Agent Contract | 🔴 Not Started |
| P1 | 5 | System Instruction XML (Per Role) | 🔴 Not Started |
| P1 | 6 | Embedding Provider Interface | 🔴 Not Started |
| P2 | 7 | Memory Advisory Integration | 🟡 Partial |
| P2 | 8 | Escalation Ticket Lifecycle | 🟡 Partial |
| P2 | 9 | User Instruction Lifecycle | 🔴 Not Started |

---

## PHASE 0: ARCHITECTURE ADDENDA (P0) ✅ COMPLETE

### Added Documents
- ✅ `info-instructions/user-instruction-lifecycle.md` - Defines instruction classes, parsing, persistence
- ✅ Updated `architecture_guardrails.md` with:
  - Supervisor Interpretation Law (no invented requirements)
  - Planner Failure Law (structured `PlanningFailure`, no silent degradation)
  - Memory→Policy isolation invariant (Policy Engine cannot accept memory inputs)
  - Hashing & Versioning Law (explicit hash inputs/outputs/responsibility)
- ✅ Updated `Tier-1-lock-in.md` Planner section with failure semantics

### Key Invariants Added
1. **Supervisor cannot invent** - May normalize, classify, route — but not add requirements
2. **Planner must fail explicitly** - `PlanningFailure` is first-class, no silent degradation
3. **Policy is memory-free** - No embeddings, similarity scores, or memory-derived inputs
4. **Hashes are deterministic** - SHA-256 truncated to 16 hex, computed by Policy Engine only

---

## PHASE 1: SKILLS SCHEMA XSD ENFORCEMENT (P0) ✅ TYPES COMPLETE

### Current State Analysis
- ✅ `skills.xml` files exist with basic structure
- ✅ `skillsXml.ts` parses XML with fast-xml-parser
- ✅ `types.ts` defines `LikuSkill`, `Capability`, `Privilege`
- ✅ `validator.ts` validates skill execution
- ✅ **DONE**: Types updated to match XSD (`RoleType`, `CapabilityType`, etc.)
- ✅ **DONE**: Skill types expanded with `allowedRoles`, `memoryAccess`, etc.
- 🔴 **GAP**: No runtime XSD validation against `skills-schema.xsd`
- 🔴 **GAP**: Skills.xml files not yet updated to new format

### Completed Tasks ✅

#### 1.1 Update Skill Type to Match XSD ✅
- [x] Add `version` attribute to skill (required by XSD)
- [x] Add `allowedRoles: RoleType[]` to skill definition
- [x] Add `requiredCapabilities: CapabilityType[]` (replaces single `requires`)
- [x] Add `allowedTools: string[]` for execution-bounded tools
- [x] Add `escalationPolicy: { reasons: EscalationReasonType[] }` 
- [x] Add `memoryAccess: { read: boolean; write: boolean }`
- [x] Add `extends?: string` for hierarchical skill inheritance

**File**: `src/liku/skills/types.ts` ✅

#### 1.2 Create RoleType and CapabilityType Enums ✅
- [x] Define `RoleType = "supervisor" | "planner" | "specialist" | "verifier"`
- [x] Align `CapabilityType` with XSD enumeration:
  - `read_repo`, `write_repo`, `execute_code`, `network_access`
  - `memory_read`, `memory_write`, `invoke_subagent`, `escalate`
- [x] Define `EscalationReasonType`:
  - `missing_capability`, `ambiguous_requirement`, `framework_uncertainty`
  - `malformed_output`, `policy_conflict`
- [x] Define `ROLE_CAPABILITY_CEILING` per Tier-1 Role Law

**File**: `src/liku/skills/types.ts` ✅

### Remaining Tasks

#### 1.3 Implement XSD Validation ✅
- [x] Create `src/liku/skills/xsdValidator.ts`
- [x] Validate skills.xml against `skills-schema.xsd` on load
- [x] Fail fast on invalid structure
- [x] Report specific validation errors with context

**Files**: `src/liku/skills/xsdValidator.ts` ✅, `test/xsdValidator.test.ts` ✅ (45 tests)

#### 1.4 Update Existing skills.xml Files
- [ ] Update `Liku/skills.xml` with `schemaVersion`, `allowedRoles`, etc.
- [ ] Update all specialist skills.xml to match XSD
- [ ] Add `memoryAccess` declarations where appropriate
- [ ] Add `escalationPolicy` to skills that may escalate

**Files**: All `skills.xml` under `Liku/`

#### 1.5 Tests for XSD Validation
- [ ] Test valid skill passes validation
- [ ] Test invalid role fails validation
- [ ] Test missing required attributes fails
- [ ] Test circular `extends` detection
- [ ] Test unknown capability rejection

**File**: `test/xsdValidator.test.ts`

---

## PHASE 2: POLICY ENGINE FORMALIZATION (P0) ✅ CORE COMPLETE

### Current State Analysis
- ✅ `validator.ts` checks privilege and capability
- ✅ Escalation info returned from orchestrator
- ✅ **DONE**: Centralized Policy Engine module created
- ✅ **DONE**: `PolicyRequest` / `PolicyDecision` contracts defined
- ✅ **DONE**: Policy decisions fully auditable with hash
- ✅ **DONE**: Deterministic rule evaluation (pure function)
- ✅ **DONE**: Global Invariants G-1 through G-5 implemented
- 🔴 **GAP**: Policy Engine not yet integrated into orchestrator

### Completed Tasks ✅

#### 2.1 Create Policy Engine Types ✅
- [x] Define `PolicyRequest` interface per spec
- [x] Define `PolicyDecision` interface per spec
- [x] Define `PolicyDecisionCode` enumeration
- [x] Define `GlobalInvariant` type (G-1 through G-5)
- [x] Define `PolicyAudit` with SHA-256 hash (16 hex chars)
- [x] Define `UserPolicySettings` with defaults

**File**: `src/liku/policy/policyTypes.ts` ✅

#### 2.2 Implement Policy Engine (Pure Function) ✅
- [x] Create `src/liku/policy/policyEngine.ts`
- [x] Implement `evaluate(request: PolicyRequest): PolicyDecision`
- [x] No side effects (no memory reads inside engine)
- [x] No LLM calls
- [x] Deterministic output for same input
- [x] Implement Global Invariants (G-1 through G-5):
  - G-1: Role not allowed by skill
  - G-2: Capability not declared by skill
  - G-3: Capability exceeds role ceiling
  - G-4: Escalation by non-allowed role
  - G-5: Memory write without user approval
- [x] Implement capability approval rules with role ceiling
- [x] Implement escalation approval rules
- [x] Implement memory write policy (deny by default)
- [x] Implement DENY BY DEFAULT failure mode

**File**: `src/liku/policy/policyEngine.ts` ✅

#### 2.4 Policy Engine Tests (100% Denial Path Coverage) ✅
- [x] Test DENIED_ROLE for role ceiling violations
- [x] Test DENIED_SKILL for undeclared capabilities
- [x] Test DENIED_CAPABILITY for user settings
- [x] Test DENIED_ESCALATION_POLICY for invalid escalation
- [x] Test DENIED_MEMORY_POLICY for unauthorized writes
- [x] Test DENY BY DEFAULT on malformed input
- [x] Test audit hash generation (deterministic, 16 hex chars)

**File**: `test/policyEngine.test.ts` ✅ (37 tests passing)

### Remaining Tasks

#### 2.3 Integrate Policy Engine into Orchestrator ✅
- [x] Call `PolicyEngine.evaluate()` before capability usage
- [x] Call `PolicyEngine.evaluate()` before escalation approval
- [x] Emit audit events for all policy decisions
- [x] Pass taskId and eventOptions through to runStep

**File**: `src/liku/orchestrator/orchestrator.ts` ✅

---

## PHASE 3: VECTOR MEMORY INDEX INTERFACE (P0)

### Current State Analysis
- ✅ `SqliteMemory` exists with basic event logging
- ✅ Memory provenance metadata defined
- ✅ Memory marked as advisory
- 🔴 **GAP**: No vector embeddings
- 🔴 **GAP**: No `VectorMemoryIndex` interface
- 🔴 **GAP**: No `VectorMemoryRecord` type
- 🔴 **GAP**: No similarity-based retrieval
- 🔴 **GAP**: No decay/TTL enforcement

### Required Tasks

#### 3.1 Define Vector Memory Types (VM-01) ✅
- [x] Create `src/liku/memory/vectorMemoryTypes.ts` (types only)
- [x] Define `MemoryType` enum: `lesson_learned`, `error_pattern`, `best_practice`, `design_decision`, `verification_outcome`
- [x] Define `VectorMemoryRecord` with full provenance
- [x] Define `MemoryStats` interface
- [x] Export `VectorMemoryIndex` interface
- [x] Define `EmbeddingProvider` interface
- [x] Implement relevance scoring utilities
- [x] Implement role-based access rules
- [x] Implement expiration detection

**File**: `src/liku/memory/vectorMemoryTypes.ts` ✅
**Tests**: `test/vectorMemoryTypes.test.ts` ✅ (41 tests)

#### 3.2 SQLite Schema for Vector Memory (VM-02)
- [ ] Create `vector_memory` table schema
- [ ] Fields: `id`, `embedding` (BLOB), `content`, `type`, `scope`
- [ ] Provenance fields: `repo_id`, `workspace_id`, `task_id`, `step_id`, `agent_role`
- [ ] Trust fields: `confidence`, `validated`, `verifier_task_id`
- [ ] Decay fields: `ttl`, `created_at`, `last_accessed_at`
- [ ] Indexes on `scope + repo_id`

**File**: `src/liku/memory/vectorMemorySchema.sql` (or in-code migration)

#### 3.3 Implement SQLiteVectorMemoryIndex (VM-03)
- [ ] Create `src/liku/memory/sqliteVectorMemoryIndex.ts`
- [ ] Implement `upsert(record: VectorMemoryRecord): Promise<void>`
- [ ] Implement `query(params): Promise<VectorMemoryRecord[]>`
- [ ] Implement `decay(now: Date): Promise<number>`
- [ ] Implement `stats(): Promise<MemoryStats>`
- [ ] Cosine similarity computed in JS (no extensions)
- [ ] Fail-open on query errors (return empty)
- [ ] No policy logic inside class

**File**: `src/liku/memory/sqliteVectorMemoryIndex.ts`

#### 3.4 Embedding Provider Interface (VM-04)
- [ ] Create `src/liku/memory/embeddingProvider.ts`
- [ ] Define `EmbeddingProvider` interface
- [ ] Implement `NoopEmbeddingProvider` (zero vectors)
- [ ] Implement `HashEmbeddingProvider` (deterministic, test-safe)
- [ ] No external API calls in default providers

**File**: `src/liku/memory/embeddingProvider.ts`

#### 3.5 Retrieval Weighting & Ranking (VM-05)
- [ ] Implement scope weights: workspace=1.0, repo=0.8, global=0.4
- [ ] Implement trust weight: `validated ? 1.0 : confidence`
- [ ] Implement freshness weight: `max(0.2, 1 - age/ttl)`
- [ ] Ensure workspace memory outranks global at equal similarity
- [ ] Ensure unvalidated never scores higher than validated
- [ ] Expired memory never returned

**File**: `src/liku/memory/sqliteVectorMemoryIndex.ts`

#### 3.6 Tests for Vector Memory (VM-10)
- [ ] Test scope weighting correctness
- [ ] Test confidence impact on ranking
- [ ] Test TTL decay removes expired records
- [ ] Test advisory-only behavior (no authority)
- [ ] Test policy-blocked writes (Phase 2 integration)
- [ ] Test fail-open read behavior
- [ ] 100% deterministic tests
- [ ] No external dependencies

**File**: `test/vectorMemory.test.ts`

---

## PHASE 4: VERIFIER AGENT CONTRACT (P0)

### Current State Analysis
- ✅ Contracts exist in `contracts.ts` for supervisor/parser/planner/synthesizer
- ✅ Violation handling with retry/escalate logic
- 🔴 **GAP**: No Verifier contract
- 🔴 **GAP**: Verifier role not formalized
- 🔴 **GAP**: No verifier-specific types

### Required Tasks

#### 4.1 Create Verifier Contract Types
- [ ] Create `src/liku/agents/verifier/verifierTypes.ts`
- [ ] Define `VerifierInput`:
  ```typescript
  type VerifierInput = {
    artifact: unknown;
    declaredContract: string;
    contextMetadata: Record<string, unknown>;
  };
  ```
- [ ] Define `VerifierOutput`:
  ```typescript
  type VerifierOutput = {
    verdict: "pass" | "fail";
    violations: TypedViolation[];
    guidance: string;
    escalationRecommended: boolean;
  };
  ```
- [ ] Define `TypedViolation` with categorization

**File**: `src/liku/agents/verifier/verifierTypes.ts`

#### 4.2 Implement Verifier Contract
- [ ] Create `src/liku/agents/verifier/verifierContract.ts`
- [ ] Implement `AgentContract<VerifierOutput>` interface
- [ ] Parse and validate verifier output
- [ ] Explicit prohibitions:
  - No tool calls
  - No artifact modification
  - No memory writes
  - No escalation approval
- [ ] Violations route back to orchestrator only

**File**: `src/liku/agents/verifier/verifierContract.ts`

#### 4.3 Integrate Verifier into Contract Registry
- [ ] Add "verifier" to `AgentRole` union
- [ ] Register verifier contract in `getContract()`
- [ ] Add validation for verifier outputs

**File**: `src/liku/orchestrator/contracts.ts`

#### 4.4 Verifier Tests
- [ ] Test valid verifier output parses correctly
- [ ] Test invalid output triggers violation
- [ ] Test read-only guarantees
- [ ] Test guidance generation

**File**: `test/verifierContract.test.ts`

---

## PHASE 5: SYSTEM INSTRUCTION XML (Per Role) (P1)

### Current State Analysis
- ✅ `supervisor.prompt.md` exists in `Liku/root/`
- ✅ Agent context loaded from `context.md`
- 🔴 **GAP**: No structured XML system instructions per role
- 🔴 **GAP**: No acknowledgement protocol
- 🔴 **GAP**: Role prohibitions not machine-enforced

### Required Tasks

#### 5.1 Create System Instruction Schema
- [ ] Create `src/liku/system/systemInstructionSchema.xsd`
- [ ] Define elements: purpose, prohibitions, escalationRules, memoryRules

#### 5.2 Create Role-Specific System XMLs
- [ ] Create `Liku/system/supervisor.xml`
- [ ] Create `Liku/system/planner.xml`
- [ ] Create `Liku/system/specialist.xml`
- [ ] Create `Liku/system/verifier.xml`

**Directory**: `Liku/system/`

#### 5.3 Implement Acknowledgement Protocol
- [ ] Agent must emit `ack: { role, version, accepted: true }`
- [ ] Failure to acknowledge = hard stop
- [ ] Hash-based version tracking

**File**: `src/liku/agents/acknowledgement.ts`

---

## PHASE 6: EMBEDDING PROVIDER INTERFACE (P1)

> Covered in Phase 3 (VM-04). Cross-reference only.

---

## PHASE 7: MEMORY ADVISORY INTEGRATION (P2)

### Current State Analysis
- ✅ Memory explicitly marked advisory in docs
- ✅ Provenance metadata defined
- 🔴 **GAP**: Planner doesn't query memory before planning
- 🔴 **GAP**: Specialist doesn't query memory before execution
- 🔴 **GAP**: Memory results not labeled `ADVISORY_CONTEXT`

### Required Tasks

#### 7.1 Planner Memory Integration (VM-07)
- [ ] Query memory before plan synthesis
- [ ] Pass results as `ADVISORY_CONTEXT`
- [ ] Ensure removing memory has zero effect on correctness
- [ ] Execution proceeds if memory unavailable

**File**: `src/liku/orchestrator/orchestrator.ts`

#### 7.2 Specialist Memory Integration (VM-07)
- [ ] Query memory before task execution
- [ ] Include in agent bundle as advisory context
- [ ] Label clearly as non-authoritative

**File**: `src/liku/engine.ts`

#### 7.3 Verifier-Authored Memory Writes (VM-08)
- [ ] Allow verifier to propose memory writes
- [ ] Supervisor confirms via policy
- [ ] Write with `validated = true`, `confidence >= 0.8`
- [ ] Only verifier-origin memory can be validated

**File**: `src/liku/memory/sqliteVectorMemoryIndex.ts`

---

## PHASE 8: ESCALATION TICKET LIFECYCLE (P2)

### Current State Analysis
- ✅ `EscalationInfo` type exists
- ✅ Escalation events emitted
- ✅ Escalation result returned from orchestrator
- 🔴 **GAP**: No ticket ID generation
- 🔴 **GAP**: No ticket lifecycle tracking
- 🔴 **GAP**: No auto-close on resolution
- 🔴 **GAP**: Dangling escalations possible

### Required Tasks

#### 8.1 Escalation Ticket Types
- [ ] Define `EscalationTicket`:
  ```typescript
  type EscalationTicket = {
    ticketId: string;
    taskId: string;
    skillId: string;
    requestingRole: RoleType;
    reason: EscalationReasonType;
    capability?: CapabilityType;
    status: "open" | "approved" | "denied" | "closed";
    createdAt: string;
    resolvedAt?: string;
  };
  ```

**File**: `src/liku/escalation/escalationTypes.ts`

#### 8.2 Escalation Ticket Registry
- [ ] Create `EscalationRegistry` class
- [ ] `create(params): EscalationTicket`
- [ ] `resolve(ticketId, resolution): void`
- [ ] `close(ticketId): void`
- [ ] Auto-close when capability granted/guidance provided/user intervenes
- [ ] No persistent escalation allowed

**File**: `src/liku/escalation/escalationRegistry.ts`

#### 8.3 Integrate Escalation Registry
- [ ] Generate ticket ID on escalation
- [ ] Bind ticket to taskId, skillId, role
- [ ] Auto-close on resolution
- [ ] Emit escalation lifecycle events

**File**: `src/liku/orchestrator/orchestrator.ts`

---

## PHASE 9: USER INSTRUCTION LIFECYCLE (P2)

### Current State Analysis
- ✅ Supervisor receives raw user input
- ✅ Query passed to planner
- 🔴 **GAP**: No `UserIntentEnvelope` structure
- 🔴 **GAP**: No instruction class separation
- 🔴 **GAP**: Planner receives raw input (should receive envelope)
- 🔴 **GAP**: No instruction persistence rules

### Required Tasks

#### 9.1 Define User Intent Types
- [ ] Define `InstructionClass`:
  ```typescript
  type InstructionClass = "session" | "workspace" | "repository" | "global";
  ```
- [ ] Define `UserInstruction`:
  ```typescript
  type UserInstruction = {
    class: InstructionClass;
    content: string;
    explicit: boolean;
  };
  ```
- [ ] Define `UserIntentEnvelope`:
  ```typescript
  type UserIntentEnvelope = {
    rawInput: string;
    classification: "exploratory" | "structured" | "pre-planned";
    instructions: UserInstruction[];
    taskIntent: string;
    constraints: string[];
  };
  ```

**File**: `src/liku/intent/intentTypes.ts`

#### 9.2 Implement Intent Parser
- [ ] Create `src/liku/intent/intentParser.ts`
- [ ] Extract instructions from raw input
- [ ] Classify intent type
- [ ] Extract explicit constraints only
- [ ] NEVER add requirements not in input
- [ ] Emit `ElicitationRequired` on ambiguity

**File**: `src/liku/intent/intentParser.ts`

#### 9.3 Integrate Intent Envelope into Orchestrator
- [ ] Supervisor calls intent parser
- [ ] Pass `UserIntentEnvelope` to Planner (not raw input)
- [ ] Handle elicitation events
- [ ] Respect instruction class for scoping

**File**: `src/liku/orchestrator/orchestrator.ts`

#### 9.4 Instruction Persistence
- [ ] Define persistence flow: user request → policy → verifier → memory
- [ ] Instructions are ephemeral by default
- [ ] Only explicit "remember" requests trigger persistence
- [ ] Store with `type: "user_preference"` in memory

**File**: `src/liku/intent/instructionPersistence.ts`

#### 9.5 Tests for Intent Lifecycle
- [ ] Test instruction extraction
- [ ] Test no invented requirements
- [ ] Test elicitation on ambiguity
- [ ] Test ephemeral default (not persisted)
- [ ] Test explicit persistence flow

**File**: `test/intentLifecycle.test.ts`

---

## ARCHITECTURE GUARDRAILS (LOCKED)

These must be enforced at all times. Implementation must never violate:

### Role Law
- ✅ Supervisor = control plane only (no tools, no memory writes)
- ✅ Planner = planning only (no execution, no tools)
- ✅ Specialist = execution only (bounded by policy)
- ✅ Verifier = validation only (no mutation)

### Supervisor Interpretation Law (NEW)
- ✅ Supervisor may normalize, classify, and route intent
- ✅ Supervisor may extract explicit constraints
- ⏳ Supervisor MUST NOT add requirements not in user input
- ⏳ Supervisor MUST NOT fill ambiguities silently (elicitation required)

### Planner Failure Law (NEW)
- ⏳ Planner must emit `PlanningFailure` if plan impossible
- ⏳ No silent degradation to partial plans
- ⏳ No "best effort" execution
- ⏳ No implicit escalation

### Memory Law
- ✅ Memory is advisory-only by default
- ✅ Memory absence must not break execution
- ✅ Memory writes require policy approval
- ✅ Only verifier-authored memory may be validated

### Policy Law
- ✅ Policy is evaluated before tool use
- ✅ Policy is evaluated before escalation
- ⏳ Policy is evaluated before memory writes
- ✅ Policy engine is deterministic and side-effect free
- ✅ **Policy Engine MUST NOT accept memory-derived inputs** (embeddings, similarity scores)

### Hashing Law (NEW)
- ✅ Hash inputs: Skill ID + version, Role, Capability set, User settings, Policy rule version
- ✅ Hash outputs: PolicyDecision.audit.inputsHash, ack.version
- ✅ Algorithm: SHA-256 truncated to 16 hex chars
- ✅ Only Policy Engine computes authoritative hashes

### Orchestration Law
- ✅ Exactly one `run_completed` event per run
- ⏳ Escalation is a ticket with a lifecycle
- ✅ Fail-open reads, fail-closed writes

### User Instruction Law (NEW)
- ⏳ Instructions are ephemeral by default
- ⏳ Planner receives `UserIntentEnvelope`, never raw input
- ⏳ Persistence requires explicit user request + policy + verifier
- ⏳ Instructions must not pollute memory as knowledge

---

## OUT OF SCOPE (LOCKED)

The following are explicitly deferred:

- ❌ Long-term agent autonomy
- ❌ Self-modifying skills
- ❌ Automatic memory promotion without verifier confirmation
- ❌ Streaming / real-time partial orchestration
- ❌ External embedding API calls without explicit BYOK configuration

---

## CURRENT BASELINE (DO NOT REBUILD)

These components are stable and should only be extended:

- ✅ Orchestrator core (`orchestrator.ts`)
- ✅ Task registry (`taskRegistry.ts`)
- ✅ Capability taxonomy (`types.ts`)
- ✅ Escalation plumbing (`EscalationInfo`)
- ✅ Event system (orchestration events)
- ✅ Memory provenance metadata
- ✅ Planner validation (`planValidator.ts`)
- ✅ Contract violation retry → verifier → human escalation flow

---

## DECISION LOG

| Decision | Rationale |
|----------|-----------|
| Memory is advisory-only | Safest default; prevents authority leakage |
| Planner has no execution authority | Tier-1 Role Law |
| Verifier cannot mutate outputs | Read-only validation |
| Policy engine is deterministic | Audit and reproducibility |
| Vector memory is workspace-prioritized | Local context > global noise |
| Embedding source is pluggable | No external API lock-in |
| Skills schema before memory | Control surface before optimization |
| **Supervisor cannot invent requirements** | Prevents "helpful" drift into super-agent |
| **Planner must fail explicitly** | No silent degradation; `PlanningFailure` is first-class |
| **Policy is memory-free** | No embeddings/similarity in policy decisions |
| **User instructions are ephemeral** | Prevents memory pollution from preferences |
| **Hashes computed by Policy Engine only** | Single source of truth for audit |

---

## STOP CONDITIONS

Implementation must halt and escalate to user if:

- A decision would alter Tier-1 architecture
- Authority boundaries become ambiguous
- Memory begins influencing policy decisions
- Planner attempts execution
- Any agent attempts self-elevation

---

## FILE STRUCTURE (TARGET)

```
src/liku/
├── agents/
│   └── verifier/
│       ├── verifierContract.ts    # Phase 4
│       └── verifierTypes.ts       # Phase 4
├── escalation/
│   ├── escalationRegistry.ts      # Phase 8
│   └── escalationTypes.ts         # Phase 8
├── intent/
│   ├── intentParser.ts            # Phase 9
│   ├── intentTypes.ts             # Phase 9
│   └── instructionPersistence.ts  # Phase 9
├── memory/
│   ├── embeddingProvider.ts       # Phase 3 (VM-04)
│   ├── sqliteMemory.ts            # Existing
│   ├── sqliteVectorMemoryIndex.ts # Phase 3 (VM-03)
│   ├── types.ts                   # Existing
│   └── vectorMemoryTypes.ts       # Phase 3 (VM-01)
├── policy/
│   ├── policyEngine.ts            # Phase 2
│   └── policyTypes.ts             # Phase 2
├── skills/
│   ├── loader.ts                  # Existing
│   ├── skillsXml.ts               # Existing
│   ├── types.ts                   # Update (Phase 1)
│   ├── validator.ts               # Existing
│   └── xsdValidator.ts            # Phase 1
├── system/
│   └── acknowledgement.ts         # Phase 5
└── ...existing files...

Liku/
├── system/
│   ├── supervisor.xml             # Phase 5
│   ├── planner.xml                # Phase 5
│   ├── specialist.xml             # Phase 5
│   └── verifier.xml               # Phase 5
└── ...existing structure...

info-instructions/
├── architecture_guardrails.md     # Updated with new laws
├── policy-engine.md               # Existing
├── skills-schema.xsd              # Existing
├── ticket-vm-01.md                # Existing (VM tickets)
├── Tier-1-lock-in.md              # Updated with Planner failure semantics
├── tier-2-implementation-guide.md # Updated with failure/isolation rules
├── Tier1-1-information.md         # Existing
├── todo.md                        # This file
├── user-instruction-lifecycle.md  # NEW - Phase 0
└── vector-memory-index.md         # Existing
```

---

## NEXT IMMEDIATE ACTIONS

1. ✅ ~~**Phase 1.1-1.2**: Update `src/liku/skills/types.ts` to match XSD enumerations~~
2. ✅ ~~**Phase 1.3**: Create `xsdValidator.ts` with schema validation~~
3. ✅ ~~**Phase 2.1**: Create `src/liku/policy/policyTypes.ts`~~
4. ✅ ~~**Phase 2.2**: Implement pure-function `policyEngine.ts`~~
5. ✅ ~~**Phase 3.1**: Define `VectorMemoryRecord` and `VectorMemoryIndex` interface types~~
6. **Phase 4**: Create Verifier Agent Contract (types, contract, tests)
7. **Phase 3.2**: SQLite Schema for Vector Memory (VM-02)

---

*This document is the authoritative implementation tracker. Update status markers as work progresses.*
