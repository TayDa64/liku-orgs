ARCHITECTURE_GUARDRAILS.md (P0)

Purpose:
Prevent Opus from accidentally:

Introducing execution authority into planner/verifier

Making memory authoritative

Collapsing policy into business logic

Contents (short, declarative, non-negotiable):

# Architecture Guardrails (LOCKED)

## Role Law
- Supervisor = control plane only (no tools, no memory writes)
- Planner = planning only (no execution, no tools)
- Specialist = execution only (bounded by policy)
- Verifier = validation only (no mutation)

## Memory Law
- Memory is advisory-only by default
- Memory absence must not break execution
- Memory writes require policy approval
- Only verifier-authored memory may be validated

## Policy Law
- Policy is evaluated before:
  - tool use
  - escalation
  - memory writes
- Policy engine is deterministic and side-effect free
- **Policy Engine must not accept memory-derived inputs, embeddings, or similarity scores — directly or indirectly**

## Supervisor Interpretation Law
- Supervisor may normalize, classify, and route intent
- Supervisor may extract explicit constraints from user input
- **Supervisor MUST NOT add requirements, assumptions, or preferences not explicitly present in user input**
- Supervisor MUST NOT fill in ambiguities silently — elicitation is required
- Supervisor MUST NOT invent intent from partial information

## Planner Failure Law
- If Planner cannot produce a valid plan under declared skills and policies, it MUST emit a structured `PlanningFailure` and halt
- Planner MUST NOT degrade silently to partial plans
- Planner MUST NOT attempt "best effort" execution
- Planner MUST NOT implicitly escalate — escalation is always explicit and ticket-based

## Orchestration Law
- Exactly one run_completed event per run
- Escalation is a ticket with a lifecycle
- Fail-open reads, fail-closed writes


Why this matters:
This prevents 80% of “helpful but wrong” agent behavior.
## Hashing & Versioning Law
Hash computation is deterministic and explicit:

**Hash Inputs (what is hashed):**
- Skill ID + version
- Role requesting action
- Capability set requested
- User settings snapshot
- Policy rule version

**Hash Outputs (where hashes appear):**
- `PolicyDecision.audit.inputsHash` — hash of all policy inputs
- `PolicyDecision.audit.ruleVersion` — version of policy rules applied
- Acknowledgement protocol `ack.version` — hash of system instruction

**Hash Algorithm:** SHA-256 truncated to 16 hex chars (64 bits)

**Responsibility:**
- Policy Engine computes `inputsHash` and `ruleVersion`
- System instruction loader computes `ack.version`
- No other component may generate authoritative hashes
2. Clarify One Ambiguous Point (Answer This for Opus)

Add a single line to Tier-1 or a new IMPLEMENTATION_NOTES.md:

Embedding source is pluggable; default is deterministic (hash/no-op). No external API calls are allowed without explicit BYOK configuration.

This avoids Opus:

Auto-integrating OpenAI embeddings prematurely

Making vector memory network-dependent

3. Confirm the Policy Engine’s Authority Boundary (Already Implied, But Should Be Explicit)

Add this clarification somewhere Opus will see it:

The Policy Engine is the only authority that may approve:

escalation

tool usage

memory writes
Agents may request, but never decide.

This aligns with your escalation-ticket model.

4. Explicitly Lock One Non-Feature (Prevents Scope Creep)

Add to your md file or README:

Out of scope (for now):

Long-term agent autonomy

Self-modifying skills

Automatic memory promotion without verifier confirmation

Streaming / real-time partial orchestration

This prevents Opus from “improving” things prematurely.

5. Optional but Strongly Recommended (Low Effort)
DECISION_LOG.md

One page. Bullet points only.

Example:

# Decision Log

- Memory is advisory-only (safest default)
- Planner has no execution authority
- Verifier cannot mutate outputs
- Policy engine is deterministic
- Vector memory is cross-repo but workspace-prioritized


Why: when Opus hits uncertainty, this becomes its anchor.