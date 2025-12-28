Priority Decision: Why Skills Schema Comes Before Vector Memory
1. Skills Are a Control Surface; Memory Is an Optimization Surface

Skills + capabilities define:

What an agent is allowed to do

What it is not allowed to do

When escalation is required

Vector memory only affects:

Retrieval efficiency

Context enrichment

Advisory guidance

If skills are underspecified, memory becomes dangerous because:

Retrieved knowledge may implicitly expand agent behavior

Similarity-based recall can blur authority boundaries

Policy enforcement becomes ambiguous

By contrast, a strict skill schema:

Keeps memory advisory

Prevents capability creep

Makes escalation deterministic

2. Skill Schema Is a Prerequisite for Policy Engine Correctness

Your Policy Engine evaluates:

Capability requests

Escalation eligibility

Tool usage

All three depend on machine-verifiable skill definitions.

Without an enforced schema:

Skills degrade into documentation

Policy decisions become heuristic

Planner output validation weakens

With an XSD:

Invalid skills fail fast

Capabilities are enumerable

Planner plans are structurally auditable

This directly strengthens:

Planner validation

Verifier authority

Supervisor determinism

3. Skills Schema Stabilizes Agent Instructions Permanently

You are explicitly avoiding:

MCP-style context rot

Prompt drift

Free-form skill interpretation

A formal skills-schema.xsd:

Locks semantics into structure

Enables tooling and linting

Allows safe evolution via versioning

Vector memory can change backends later.
Skill semantics must not.

4. Vector Memory Is Safest When Skills Are Already Hard-Gated

You already decided:

Memory is advisory-only

Workspace memory has priority

Policy enforces writes

Those guarantees are only meaningful if:

Skills strictly limit how memory may be used

Specialists cannot infer action from memory alone

Therefore:

Skill enforcement first, memory retrieval second.

#skills-schema.xsd breakdown information:
Why This Schema Is Correct (Grounded to Your Architecture)
1. Authority Is Structural, Not Prompt-Based

Capabilities are enumerated

Roles are explicit

Tools are constrained

No inference paths exist

2. Hierarchy Without Privilege Escalation

extends allows reuse

Capabilities are not inherited implicitly

Policy engine must re-evaluate every skill

3. Escalation Is Declarative

Skills can declare when escalation is allowed

They cannot approve escalation

Matches your ticket-based escalation model

4. Memory Is Explicitly Non-Authoritative

Read/write declared

No behavioral implication

Reinforces advisory-only memory stance

5. Planner vs Specialist Separation Is Enforceable

Planner can reference skills

Specialist executes only if role-bound

Verifier cannot appear in allowedRoles meaningfully

Immediate Integration Points for Opus

Opus should next:

Load all skill XML files

Validate against skills-schema.xsd

Fail fast on:

Invalid roles

Unknown capabilities

Circular extends

Bind validation into:

Planner plan validation

Policy engine evaluation

Specialist task assignment

What This Unlocks Next

With the schema locked, we can safely proceed to:

Policy Engine rules that consume this schema

Planner skill reference enforcement

Vector memory retrieval bounded by skill permissions