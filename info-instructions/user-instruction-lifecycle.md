# USER INSTRUCTION LIFECYCLE

**Status**: Tier-1 Addendum (Locked)

---

## 1. PURPOSE

User instructions are distinct from:
- **Skills** (capabilities bound to roles)
- **Memory** (advisory historical context)
- **Policy** (deterministic authority rules)

User instructions influence all three but are not any of them.

---

## 2. INSTRUCTION CLASSES

| Class | Example | Scope | Persistence |
|-------|---------|-------|-------------|
| **Session** | "Be verbose" | Current run only | Never persisted |
| **Workspace** | "Prefer TypeScript" | Current workspace | Explicit opt-in only |
| **Repository** | "Never modify /prod/" | Repo-wide | Requires user confirmation |
| **Global** | "Always use tabs" | Cross-repo | Requires explicit promotion |

Default scope is **Session** (ephemeral).

---

## 3. USER INTENT ENVELOPE

The Supervisor normalizes raw user input into a structured envelope:

```typescript
type UserIntentEnvelope = {
  // Original input (preserved verbatim)
  rawInput: string;
  
  // Supervisor classification
  classification: "exploratory" | "structured" | "pre-planned";
  
  // Extracted instructions (if any)
  instructions: {
    class: InstructionClass;
    content: string;
    explicit: boolean;  // true if user stated directly
  }[];
  
  // Task intent (what the user wants done)
  taskIntent: string;
  
  // Constraints extracted from input
  constraints: string[];
  
  // Supervisor did NOT add anything not in rawInput
  supervisorAdditions: never;
};
```

---

## 4. PARSING RULES (LOCKED)

### 4.1 Supervisor Responsibility

The Supervisor:
- ✅ MAY normalize language (grammar, structure)
- ✅ MAY classify intent type
- ✅ MAY extract explicit constraints
- ✅ MAY identify instruction class
- ❌ MUST NOT add requirements not in input
- ❌ MUST NOT assume preferences
- ❌ MUST NOT fill in ambiguities silently

### 4.2 Ambiguity Handling

If user intent is ambiguous:
1. Supervisor emits `ElicitationRequired` event
2. Orchestration pauses
3. User provides clarification
4. Process resumes with enriched envelope

Supervisor NEVER guesses.

---

## 5. PERSISTENCE RULES (LOCKED)

### 5.1 Default: Non-Persistent

User instructions are **ephemeral by default**.

They are:
- Not written to memory
- Not cached across runs
- Not promoted to policy

### 5.2 Explicit Persistence

To persist a user instruction:

1. User explicitly requests: "Remember this preference"
2. Supervisor classifies instruction class
3. Policy Engine approves memory write
4. Verifier confirms instruction validity
5. Memory write occurs with:
   - `type: "user_preference"`
   - `validated: true` (verifier confirmed)
   - `scope: <declared scope>`
   - `ttl: <user-specified or default>`

Without all 5 steps, instruction remains ephemeral.

---

## 6. PLANNER CONSUMPTION RULES

The Planner:
- ✅ Receives `UserIntentEnvelope` from Supervisor
- ✅ Consumes `taskIntent` and `constraints`
- ❌ NEVER receives `rawInput` directly
- ❌ NEVER interprets user language itself
- ❌ NEVER infers preferences not in envelope

This prevents:
- Planner bias from user phrasing
- Inconsistent interpretation
- Authority leakage

---

## 7. MEMORY POLLUTION PREVENTION

Instructions MUST NOT pollute memory as:
- Lessons learned
- Best practices
- Design decisions

User preferences are a separate memory type with explicit lifecycle.

If an instruction looks like knowledge, it requires:
1. User confirmation: "This is knowledge, not a preference"
2. Verifier validation
3. Re-classification before memory write

---

## 8. EXAMPLES

### Valid Flow
```
User: "Refactor auth.ts, and always prefer async/await"
       ↓
Supervisor: {
  rawInput: "Refactor auth.ts, and always prefer async/await",
  classification: "structured",
  instructions: [{
    class: "session",
    content: "prefer async/await",
    explicit: true
  }],
  taskIntent: "Refactor auth.ts",
  constraints: ["use async/await syntax"]
}
       ↓
Planner: Receives envelope, creates plan with async/await constraint
       ↓
Specialist: Executes refactor using async/await
       ↓
Instruction discarded after run (session scope)
```

### Invalid Flow (BLOCKED)
```
User: "Fix the bug"
       ↓
Supervisor: {
  ...
  constraints: ["probably in auth.ts", "likely a null check"]  // ❌ INVENTED
}
```

This would be a Tier-1 violation. Supervisor must elicit, not invent.

---

## 9. INTEGRATION POINTS

| Component | Interaction |
|-----------|-------------|
| Supervisor | Parses and normalizes |
| Planner | Consumes envelope only |
| Policy Engine | Approves persistence requests |
| Memory | Stores only approved preferences |
| Verifier | Validates preference correctness |

---

*This document is a Tier-1 addendum. Modifications require explicit user approval.*
