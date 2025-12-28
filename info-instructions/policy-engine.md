POLICY ENGINE — RULES, DECISION MATRIX, AND PROCEDURES

Authoritative Specification

1. POLICY ENGINE MANDATE (LOCKED)

The Policy Engine is the sole authority for:

Capability approvals

Escalation approvals

Memory write approvals (future)

No agent:

May bypass it

May cache its decisions

May infer approval from similarity, memory, or precedent

All decisions are:

Deterministic

Auditable

Stateless beyond explicit inputs

2. INPUT CONTRACT

Every policy evaluation request must include:

PolicyRequest {
  requestId: string
  requestType: "capability" | "escalation" | "memory_write"
  role: RoleType
  skillId: string
  capabilitiesRequested?: CapabilityType[]
  escalationReason?: EscalationReasonType
  context: {
    repoId: string
    workspaceId: string
    taskId: string
    stepId?: string
  }
  userSettings: {
    allowEscalation: boolean
    allowNetwork: boolean
    allowMemoryWrite: boolean
  }
}


If any required field is missing → DENY (INVALID_REQUEST)

3. OUTPUT CONTRACT
PolicyDecision {
  approved: boolean
  decisionCode:
    | "APPROVED"
    | "DENIED_ROLE"
    | "DENIED_SKILL"
    | "DENIED_CAPABILITY"
    | "DENIED_USER_POLICY"
    | "DENIED_ESCALATION_POLICY"
    | "DENIED_MEMORY_POLICY"
  rationale: string
  audit: {
    evaluatedAt: ISODate
    inputsHash: string
    ruleVersion: string
  }
}

4. GLOBAL INVARIANTS (NON-NEGOTIABLE)

These rules are evaluated before all others:

Rule	Condition	Result
G-1	Role not allowed by skill	DENY
G-2	Capability not declared by skill	DENY
G-3	Capability exceeds role law	DENY
G-4	Escalation requested by non-allowed role	DENY
G-5	Memory write without explicit user approval	DENY

No exception paths.

5. CAPABILITY APPROVAL RULES
5.1 Capability Request Evaluation

A capability request is approved only if all conditions pass:

Check	Requirement
Skill Binding	Capability appears in <requiredCapabilities>
Role Law	Role is permitted to request capability
User Settings	Capability allowed by user
Scope	Capability applies to current workspace/repo

Failure of any check → DENIED_CAPABILITY

5.2 Role Capability Ceiling
Role	Max Authority
Supervisor	escalate only
Planner	invoke_subagent, escalate
Specialist	declared execution capabilities only
Verifier	none

If requested capability exceeds ceiling → DENIED_ROLE

6. ESCALATION APPROVAL RULES
6.1 Escalation Eligibility

Escalation may only be approved if:

Skill declares <escalationPolicy>

Reason matches declared on value

User settings allow escalation

Requesting role is not Supervisor

Failure → DENIED_ESCALATION_POLICY

6.2 Escalation Ticket Rules

On approval:

Generate escalation ticket ID

Bind to:

taskId

skillId

requesting role

Ticket must auto-close when:

Capability granted

Guidance provided

User intervenes

No persistent escalation allowed.

7. MEMORY WRITE POLICY (FORWARD-SAFE)

Memory writes are disabled by default.

Approval requires:

Condition	Requirement
User Setting	allowMemoryWrite === true
Role	Specialist or Supervisor only
Skill	<memoryAccess write="true"/>
Scope	Workspace or repo only

Otherwise → DENIED_MEMORY_POLICY

8. MEMORY READ POLICY (CURRENT DEFAULT)

Memory reads are always advisory

No approval required

Policy Engine does not gate reads

Skills may restrict use, not access

This preserves:

Speed

Safety

Non-authoritative memory stance

9. DECISION MATRIX (SUMMARY)
Request	Role	Skill Declared	User Allows	Result
Capability	Planner	❌	—	DENY
Capability	Specialist	✅	❌	DENY
Escalation	Specialist	✅	✅	APPROVE
Escalation	Planner	❌	—	DENY
Memory Write	Specialist	✅	❌	DENY
10. AUDIT & TRACEABILITY

Every decision must emit:

Inputs hash

Rule version

Timestamp

Rationale

These are:

Logged

Testable

Deterministic

11. IMPLEMENTATION REQUIREMENTS FOR OPUS

Opus must:

Implement Policy Engine as a pure function

No side effects

No memory reads inside engine

No LLM calls

100% test coverage for denial paths

12. FAILURE MODE GUARANTEE

If Policy Engine:

Throws

Times out

Receives malformed input

→ DENY BY DEFAULT

This is a security feature.

END — POLICY ENGINE RULES
What This Unlocks Next

With:

Tier-1 locked

Skill schema enforced

Policy engine defined

You are now safe to proceed to:

Vector Memory Index Design

(backed by SQLite or alternative, advisory-only, policy-aware)

or

Planner ↔ Skill Binding Enforcement

(ensuring plans cannot reference unauthorized skills)