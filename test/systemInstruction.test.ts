/**
 * System Instruction Tests
 *
 * Tests for Phase 5: System Instruction XML (Per Role)
 *
 * Test coverage:
 * - XML parsing for all role types
 * - Validation of role-specific constraints
 * - Acknowledgement protocol
 * - Hash computation determinism
 * - Prohibition checking
 * - Memory rule validation
 * - Escalation rule validation
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parseSystemInstructionXml,
  validateSystemInstruction,
  SystemInstructionParseError,
  computeInstructionHash,
  createAcknowledgement,
  validateAcknowledgement,
  checkProhibition,
  getProhibitions,
  isCapabilityAllowed,
  canReadMemory,
  canWriteMemory,
  canValidateMemory,
  canEscalate,
  canApproveEscalation,
  cacheInstruction,
  getCachedInstruction,
  getCachedHash,
  clearInstructionCache,
  getAllCachedInstructions,
  PROHIBITED_ACTIONS
} from "../src/liku/system/index.js";
import type { SystemInstruction, SystemInstructionAck } from "../src/liku/system/index.js";
import type { RoleType } from "../src/liku/skills/types.js";

// ============================================================================
// TEST FIXTURES
// ============================================================================

const VALID_SUPERVISOR_XML = `<?xml version="1.0" encoding="UTF-8"?>
<systemInstruction role="supervisor" version="1.0.0" schemaVersion="1.0">
  <purpose>
    <description>Control-plane orchestrator</description>
    <nature>control-plane only</nature>
    <responsibilities>
      <responsibility>Receive user intent</responsibility>
      <responsibility>Route to planner</responsibility>
    </responsibilities>
    <allowedCapabilities>
      <capability>escalate</capability>
    </allowedCapabilities>
  </purpose>
  <prohibitions>
    <prohibition id="SUPV-001">
      <action>execute_tasks</action>
      <rationale>Supervisor is control-plane only</rationale>
      <violationSeverity>critical</violationSeverity>
      <onViolation>terminate</onViolation>
    </prohibition>
    <prohibition id="SUPV-002">
      <action>call_tools</action>
      <rationale>No tool invocation authority</rationale>
      <violationSeverity>critical</violationSeverity>
      <onViolation>terminate</onViolation>
    </prohibition>
  </prohibitions>
  <escalationRules>
    <canEscalate>true</canEscalate>
    <canApproveEscalation>true</canApproveEscalation>
    <escalationTriggers>
      <trigger>
        <reason>policy_conflict</reason>
        <description>Policy blocked completion</description>
        <autoEscalate>false</autoEscalate>
      </trigger>
    </escalationTriggers>
    <escalationBehavior>explicit_ticket</escalationBehavior>
  </escalationRules>
  <memoryRules>
    <canRead>true</canRead>
    <canWrite>false</canWrite>
    <canValidate>false</canValidate>
    <advisoryOnly>true</advisoryOnly>
    <scopePriority>
      <scope weight="1.0">workspace</scope>
      <scope weight="0.8">repository</scope>
    </scopePriority>
  </memoryRules>
  <acknowledgementRequired>true</acknowledgementRequired>
</systemInstruction>`;

const VALID_PLANNER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<systemInstruction role="planner" version="1.0.0" schemaVersion="1.0">
  <purpose>
    <description>Cognitive reasoning agent</description>
    <nature>cognitive / reasoning agent only</nature>
    <responsibilities>
      <responsibility>Convert intent to plan</responsibility>
      <responsibility>Decompose tasks</responsibility>
    </responsibilities>
    <allowedCapabilities>
      <capability>memory_read</capability>
      <capability>escalate</capability>
    </allowedCapabilities>
  </purpose>
  <prohibitions>
    <prohibition id="PLAN-001">
      <action>execute_tasks</action>
      <rationale>Planner is cognitive only</rationale>
      <violationSeverity>critical</violationSeverity>
      <onViolation>terminate</onViolation>
    </prohibition>
    <prohibition id="PLAN-002">
      <action>silent_degradation</action>
      <rationale>Must emit PlanningFailure</rationale>
      <violationSeverity>critical</violationSeverity>
      <onViolation>terminate</onViolation>
    </prohibition>
  </prohibitions>
  <escalationRules>
    <canEscalate>true</canEscalate>
    <canApproveEscalation>false</canApproveEscalation>
    <escalationBehavior>explicit_ticket</escalationBehavior>
  </escalationRules>
  <memoryRules>
    <canRead>true</canRead>
    <canWrite>false</canWrite>
    <canValidate>false</canValidate>
    <advisoryOnly>true</advisoryOnly>
  </memoryRules>
  <acknowledgementRequired>true</acknowledgementRequired>
</systemInstruction>`;

const VALID_SPECIALIST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<systemInstruction role="specialist" version="1.0.0" schemaVersion="1.0">
  <purpose>
    <description>Execution agent</description>
    <nature>execution agent</nature>
    <responsibilities>
      <responsibility>Execute tasks within skills</responsibility>
      <responsibility>Invoke tools as permitted</responsibility>
    </responsibilities>
    <allowedCapabilities>
      <capability>read_repo</capability>
      <capability>write_repo</capability>
      <capability>execute_code</capability>
      <capability>memory_write</capability>
    </allowedCapabilities>
  </purpose>
  <prohibitions>
    <prohibition id="SPEC-001">
      <action>self_authorize_capabilities</action>
      <rationale>Cannot self-authorize</rationale>
      <violationSeverity>critical</violationSeverity>
      <onViolation>terminate</onViolation>
    </prohibition>
  </prohibitions>
  <escalationRules>
    <canEscalate>true</canEscalate>
    <canApproveEscalation>false</canApproveEscalation>
    <escalationBehavior>explicit_ticket</escalationBehavior>
  </escalationRules>
  <memoryRules>
    <canRead>true</canRead>
    <canWrite>true</canWrite>
    <canValidate>false</canValidate>
    <advisoryOnly>true</advisoryOnly>
  </memoryRules>
  <acknowledgementRequired>true</acknowledgementRequired>
</systemInstruction>`;

const VALID_VERIFIER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<systemInstruction role="verifier" version="1.0.0" schemaVersion="1.0">
  <purpose>
    <description>Read-only validation agent</description>
    <nature>read-only validation agent</nature>
    <responsibilities>
      <responsibility>Review outputs for correctness</responsibility>
      <responsibility>Detect violations</responsibility>
    </responsibilities>
    <allowedCapabilities>
      <capability>memory_read</capability>
      <capability>escalate</capability>
    </allowedCapabilities>
  </purpose>
  <prohibitions>
    <prohibition id="VERF-001">
      <action>modify_outputs</action>
      <rationale>Verifier is read-only</rationale>
      <violationSeverity>critical</violationSeverity>
      <onViolation>terminate</onViolation>
    </prohibition>
    <prohibition id="VERF-002">
      <action>memory_write</action>
      <rationale>Cannot write memory</rationale>
      <violationSeverity>critical</violationSeverity>
      <onViolation>terminate</onViolation>
    </prohibition>
  </prohibitions>
  <escalationRules>
    <canEscalate>true</canEscalate>
    <canApproveEscalation>false</canApproveEscalation>
    <escalationBehavior>explicit_ticket</escalationBehavior>
  </escalationRules>
  <memoryRules>
    <canRead>true</canRead>
    <canWrite>false</canWrite>
    <canValidate>true</canValidate>
    <advisoryOnly>true</advisoryOnly>
  </memoryRules>
  <acknowledgementRequired>true</acknowledgementRequired>
</systemInstruction>`;

// ============================================================================
// XML PARSING TESTS
// ============================================================================

describe("System Instruction XML Parsing", () => {
  describe("parseSystemInstructionXml", () => {
    it("parses valid supervisor XML", () => {
      const instruction = parseSystemInstructionXml(VALID_SUPERVISOR_XML);

      expect(instruction.role).toBe("supervisor");
      expect(instruction.version).toBe("1.0.0");
      expect(instruction.schemaVersion).toBe("1.0");
      expect(instruction.purpose.description).toBe("Control-plane orchestrator");
      expect(instruction.purpose.nature).toBe("control-plane only");
      expect(instruction.purpose.responsibilities).toHaveLength(2);
      expect(instruction.purpose.allowedCapabilities).toContain("escalate");
      expect(instruction.prohibitions.prohibitions).toHaveLength(2);
      expect(instruction.escalationRules.canApproveEscalation).toBe(true);
      expect(instruction.memoryRules.canRead).toBe(true);
      expect(instruction.memoryRules.canWrite).toBe(false);
      expect(instruction.acknowledgementRequired).toBe(true);
    });

    it("parses valid planner XML", () => {
      const instruction = parseSystemInstructionXml(VALID_PLANNER_XML);

      expect(instruction.role).toBe("planner");
      expect(instruction.purpose.nature).toBe("cognitive / reasoning agent only");
      expect(instruction.escalationRules.canApproveEscalation).toBe(false);
      expect(instruction.memoryRules.canWrite).toBe(false);
    });

    it("parses valid specialist XML", () => {
      const instruction = parseSystemInstructionXml(VALID_SPECIALIST_XML);

      expect(instruction.role).toBe("specialist");
      expect(instruction.purpose.nature).toBe("execution agent");
      expect(instruction.memoryRules.canWrite).toBe(true);
      expect(instruction.memoryRules.canValidate).toBe(false);
    });

    it("parses valid verifier XML", () => {
      const instruction = parseSystemInstructionXml(VALID_VERIFIER_XML);

      expect(instruction.role).toBe("verifier");
      expect(instruction.purpose.nature).toBe("read-only validation agent");
      expect(instruction.memoryRules.canValidate).toBe(true);
      expect(instruction.memoryRules.canWrite).toBe(false);
    });

    it("throws on missing root element", () => {
      expect(() => parseSystemInstructionXml("<other></other>"))
        .toThrow(SystemInstructionParseError);
    });

    it("throws on invalid role", () => {
      const invalidXml = VALID_SUPERVISOR_XML.replace('role="supervisor"', 'role="invalid"');
      expect(() => parseSystemInstructionXml(invalidXml))
        .toThrow(SystemInstructionParseError);
    });

    it("throws on missing version", () => {
      const invalidXml = VALID_SUPERVISOR_XML.replace('version="1.0.0"', "");
      expect(() => parseSystemInstructionXml(invalidXml))
        .toThrow(SystemInstructionParseError);
    });

    it("throws on missing purpose description", () => {
      const invalidXml = VALID_SUPERVISOR_XML.replace(
        "<description>Control-plane orchestrator</description>",
        ""
      );
      expect(() => parseSystemInstructionXml(invalidXml))
        .toThrow(SystemInstructionParseError);
    });

    it("throws on missing prohibitions", () => {
      const invalidXml = VALID_SUPERVISOR_XML.replace(
        /<prohibitions>[\s\S]*?<\/prohibitions>/,
        "<prohibitions></prohibitions>"
      );
      expect(() => parseSystemInstructionXml(invalidXml))
        .toThrow(SystemInstructionParseError);
    });

    it("throws on invalid capability", () => {
      const invalidXml = VALID_SUPERVISOR_XML.replace(
        "<capability>escalate</capability>",
        "<capability>invalid_cap</capability>"
      );
      expect(() => parseSystemInstructionXml(invalidXml))
        .toThrow(SystemInstructionParseError);
    });

    it("throws on invalid severity", () => {
      const invalidXml = VALID_SUPERVISOR_XML.replace(
        "<violationSeverity>critical</violationSeverity>",
        "<violationSeverity>invalid</violationSeverity>"
      );
      expect(() => parseSystemInstructionXml(invalidXml))
        .toThrow(SystemInstructionParseError);
    });

    it("throws on invalid XML syntax", () => {
      expect(() => parseSystemInstructionXml("<not-valid-xml"))
        .toThrow(SystemInstructionParseError);
    });

    it("parses prohibition with missing optional fields using defaults", () => {
      const xmlWithDefaults = `<?xml version="1.0" encoding="UTF-8"?>
<systemInstruction role="supervisor" version="1.0.0" schemaVersion="1.0">
  <purpose>
    <description>Test</description>
    <nature>test</nature>
    <responsibilities><responsibility>test</responsibility></responsibilities>
  </purpose>
  <prohibitions>
    <prohibition id="TEST-001">
      <action>test_action</action>
      <rationale>test rationale</rationale>
    </prohibition>
  </prohibitions>
  <escalationRules>
    <canEscalate>true</canEscalate>
    <canApproveEscalation>true</canApproveEscalation>
    <escalationBehavior>explicit_ticket</escalationBehavior>
  </escalationRules>
  <memoryRules>
    <canRead>true</canRead>
    <canWrite>false</canWrite>
    <canValidate>false</canValidate>
    <advisoryOnly>true</advisoryOnly>
  </memoryRules>
</systemInstruction>`;

      const instruction = parseSystemInstructionXml(xmlWithDefaults);
      expect(instruction.prohibitions.prohibitions[0]?.violationSeverity).toBe("critical");
      expect(instruction.prohibitions.prohibitions[0]?.onViolation).toBe("escalate");
    });
  });

  describe("validateSystemInstruction", () => {
    it("validates supervisor instruction", () => {
      const instruction = parseSystemInstructionXml(VALID_SUPERVISOR_XML);
      expect(() => validateSystemInstruction(instruction, "supervisor")).not.toThrow();
    });

    it("validates planner instruction", () => {
      const instruction = parseSystemInstructionXml(VALID_PLANNER_XML);
      expect(() => validateSystemInstruction(instruction, "planner")).not.toThrow();
    });

    it("validates specialist instruction", () => {
      const instruction = parseSystemInstructionXml(VALID_SPECIALIST_XML);
      expect(() => validateSystemInstruction(instruction, "specialist")).not.toThrow();
    });

    it("validates verifier instruction", () => {
      const instruction = parseSystemInstructionXml(VALID_VERIFIER_XML);
      expect(() => validateSystemInstruction(instruction, "verifier")).not.toThrow();
    });

    it("throws on role mismatch", () => {
      const instruction = parseSystemInstructionXml(VALID_SUPERVISOR_XML);
      expect(() => validateSystemInstruction(instruction, "planner"))
        .toThrow(SystemInstructionParseError);
    });

    it("throws if supervisor cannot approve escalations", () => {
      const xml = VALID_SUPERVISOR_XML.replace(
        "<canApproveEscalation>true</canApproveEscalation>",
        "<canApproveEscalation>false</canApproveEscalation>"
      );
      const instruction = parseSystemInstructionXml(xml);
      expect(() => validateSystemInstruction(instruction, "supervisor"))
        .toThrow(/canApproveEscalation=true/);
    });

    it("throws if supervisor can write memory", () => {
      const xml = VALID_SUPERVISOR_XML.replace(
        "<canWrite>false</canWrite>",
        "<canWrite>true</canWrite>"
      );
      const instruction = parseSystemInstructionXml(xml);
      expect(() => validateSystemInstruction(instruction, "supervisor"))
        .toThrow(/canWrite=true/);
    });

    it("throws if planner can write memory", () => {
      const xml = VALID_PLANNER_XML.replace(
        "<canWrite>false</canWrite>",
        "<canWrite>true</canWrite>"
      );
      const instruction = parseSystemInstructionXml(xml);
      expect(() => validateSystemInstruction(instruction, "planner"))
        .toThrow(/canWrite=true/);
    });

    it("throws if verifier can write memory", () => {
      const xml = VALID_VERIFIER_XML.replace(
        "<canWrite>false</canWrite>",
        "<canWrite>true</canWrite>"
      );
      const instruction = parseSystemInstructionXml(xml);
      expect(() => validateSystemInstruction(instruction, "verifier"))
        .toThrow(/canWrite=true/);
    });

    it("throws if verifier cannot validate memory", () => {
      const xml = VALID_VERIFIER_XML.replace(
        "<canValidate>true</canValidate>",
        "<canValidate>false</canValidate>"
      );
      const instruction = parseSystemInstructionXml(xml);
      expect(() => validateSystemInstruction(instruction, "verifier"))
        .toThrow(/canValidate=true/);
    });
  });
});

// ============================================================================
// ACKNOWLEDGEMENT PROTOCOL TESTS
// ============================================================================

describe("Acknowledgement Protocol", () => {
  let supervisorInstruction: SystemInstruction;
  let plannerInstruction: SystemInstruction;

  beforeEach(() => {
    supervisorInstruction = parseSystemInstructionXml(VALID_SUPERVISOR_XML);
    plannerInstruction = parseSystemInstructionXml(VALID_PLANNER_XML);
    clearInstructionCache();
  });

  describe("computeInstructionHash", () => {
    it("produces 16-character hex hash", () => {
      const hash = computeInstructionHash(supervisorInstruction);
      expect(hash).toHaveLength(16);
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it("produces deterministic hash for same input", () => {
      const hash1 = computeInstructionHash(supervisorInstruction);
      const hash2 = computeInstructionHash(supervisorInstruction);
      expect(hash1).toBe(hash2);
    });

    it("produces different hash for different roles", () => {
      const hash1 = computeInstructionHash(supervisorInstruction);
      const hash2 = computeInstructionHash(plannerInstruction);
      expect(hash1).not.toBe(hash2);
    });

    it("produces different hash when version changes", () => {
      const hash1 = computeInstructionHash(supervisorInstruction);

      const modifiedXml = VALID_SUPERVISOR_XML.replace('version="1.0.0"', 'version="1.0.1"');
      const modifiedInstruction = parseSystemInstructionXml(modifiedXml);
      const hash2 = computeInstructionHash(modifiedInstruction);

      expect(hash1).not.toBe(hash2);
    });

    it("produces different hash when prohibitions change", () => {
      const hash1 = computeInstructionHash(supervisorInstruction);

      const modifiedXml = VALID_SUPERVISOR_XML.replace('id="SUPV-001"', 'id="SUPV-999"');
      const modifiedInstruction = parseSystemInstructionXml(modifiedXml);
      const hash2 = computeInstructionHash(modifiedInstruction);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("createAcknowledgement", () => {
    it("creates acknowledgement with correct role", () => {
      const ack = createAcknowledgement(supervisorInstruction, true);
      expect(ack.role).toBe("supervisor");
    });

    it("creates acknowledgement with correct version hash", () => {
      const ack = createAcknowledgement(supervisorInstruction, true);
      const expectedHash = computeInstructionHash(supervisorInstruction);
      expect(ack.version).toBe(expectedHash);
    });

    it("creates acknowledgement with timestamp", () => {
      const before = new Date().toISOString();
      const ack = createAcknowledgement(supervisorInstruction, true);
      const after = new Date().toISOString();

      expect(ack.timestamp >= before).toBe(true);
      expect(ack.timestamp <= after).toBe(true);
    });

    it("includes taskId when provided", () => {
      const ack = createAcknowledgement(supervisorInstruction, true, "task-123");
      expect(ack.taskId).toBe("task-123");
    });

    it("omits taskId when not provided", () => {
      const ack = createAcknowledgement(supervisorInstruction, true);
      expect(ack.taskId).toBeUndefined();
    });

    it("sets accepted to false when rejected", () => {
      const ack = createAcknowledgement(supervisorInstruction, false);
      expect(ack.accepted).toBe(false);
    });
  });

  describe("validateAcknowledgement", () => {
    it("validates correct acknowledgement", () => {
      const ack = createAcknowledgement(supervisorInstruction, true);
      const result = validateAcknowledgement(ack, supervisorInstruction);

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("rejects role mismatch", () => {
      const ack = createAcknowledgement(supervisorInstruction, true);
      const result = validateAcknowledgement(ack, plannerInstruction);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Role mismatch");
    });

    it("rejects version hash mismatch", () => {
      const ack = createAcknowledgement(supervisorInstruction, true);
      ack.version = "0000000000000000"; // Wrong hash

      const result = validateAcknowledgement(ack, supervisorInstruction);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Version hash mismatch");
      expect(result.expectedVersion).toBe(computeInstructionHash(supervisorInstruction));
      expect(result.receivedVersion).toBe("0000000000000000");
    });

    it("rejects non-accepted acknowledgement", () => {
      const ack = createAcknowledgement(supervisorInstruction, false);
      const result = validateAcknowledgement(ack, supervisorInstruction);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("rejected");
    });
  });
});

// ============================================================================
// PROHIBITION CHECKING TESTS
// ============================================================================

describe("Prohibition Checking", () => {
  let supervisorInstruction: SystemInstruction;

  beforeEach(() => {
    supervisorInstruction = parseSystemInstructionXml(VALID_SUPERVISOR_XML);
  });

  describe("checkProhibition", () => {
    it("returns prohibited=true for prohibited action", () => {
      const result = checkProhibition(supervisorInstruction, "execute_tasks");

      expect(result.prohibited).toBe(true);
      expect(result.prohibition).toBeDefined();
      expect(result.prohibition?.id).toBe("SUPV-001");
      expect(result.action).toBe("terminate");
    });

    it("returns prohibited=false for allowed action", () => {
      const result = checkProhibition(supervisorInstruction, "read_data");

      expect(result.prohibited).toBe(false);
      expect(result.prohibition).toBeUndefined();
    });

    it("returns correct violation action", () => {
      const result = checkProhibition(supervisorInstruction, "call_tools");

      expect(result.prohibited).toBe(true);
      expect(result.action).toBe("terminate");
    });
  });

  describe("getProhibitions", () => {
    it("returns all prohibitions", () => {
      const prohibitions = getProhibitions(supervisorInstruction);

      expect(prohibitions).toHaveLength(2);
      expect(prohibitions[0]?.action).toBe("execute_tasks");
      expect(prohibitions[1]?.action).toBe("call_tools");
    });

    it("returns a copy, not the original array", () => {
      const prohibitions = getProhibitions(supervisorInstruction);
      prohibitions.push({
        id: "TEST",
        action: "test",
        rationale: "test",
        violationSeverity: "low",
        onViolation: "log_and_continue"
      });

      expect(getProhibitions(supervisorInstruction)).toHaveLength(2);
    });
  });

  describe("PROHIBITED_ACTIONS constant", () => {
    it("contains supervisor prohibitions", () => {
      expect(PROHIBITED_ACTIONS.EXECUTE_TASKS).toBe("execute_tasks");
      expect(PROHIBITED_ACTIONS.CALL_TOOLS).toBe("call_tools");
      expect(PROHIBITED_ACTIONS.BYPASS_POLICY).toBe("bypass_policy_engine");
    });

    it("contains planner prohibitions", () => {
      expect(PROHIBITED_ACTIONS.SILENT_DEGRADATION).toBe("silent_degradation");
      expect(PROHIBITED_ACTIONS.IMPLICIT_ESCALATION).toBe("implicit_escalation");
    });

    it("contains specialist prohibitions", () => {
      expect(PROHIBITED_ACTIONS.SELF_AUTHORIZE).toBe("self_authorize_capabilities");
      expect(PROHIBITED_ACTIONS.SELF_ELEVATE).toBe("self_elevate_privilege");
    });

    it("contains verifier prohibitions", () => {
      expect(PROHIBITED_ACTIONS.MODIFY_OUTPUTS).toBe("modify_outputs");
      expect(PROHIBITED_ACTIONS.EXECUTE_TOOLS).toBe("execute_tools");
    });
  });
});

// ============================================================================
// CAPABILITY CHECKING TESTS
// ============================================================================

describe("Capability Checking", () => {
  describe("isCapabilityAllowed", () => {
    it("returns true for allowed capability", () => {
      const instruction = parseSystemInstructionXml(VALID_SUPERVISOR_XML);
      expect(isCapabilityAllowed(instruction, "escalate")).toBe(true);
    });

    it("returns false for disallowed capability", () => {
      const instruction = parseSystemInstructionXml(VALID_SUPERVISOR_XML);
      expect(isCapabilityAllowed(instruction, "execute_code")).toBe(false);
    });

    it("returns false when no capabilities defined", () => {
      const xml = VALID_PLANNER_XML.replace(
        /<allowedCapabilities>[\s\S]*?<\/allowedCapabilities>/,
        ""
      );
      const instruction = parseSystemInstructionXml(xml);
      expect(isCapabilityAllowed(instruction, "escalate")).toBe(false);
    });

    it("returns true for all specialist capabilities", () => {
      const instruction = parseSystemInstructionXml(VALID_SPECIALIST_XML);
      expect(isCapabilityAllowed(instruction, "read_repo")).toBe(true);
      expect(isCapabilityAllowed(instruction, "write_repo")).toBe(true);
      expect(isCapabilityAllowed(instruction, "execute_code")).toBe(true);
      expect(isCapabilityAllowed(instruction, "memory_write")).toBe(true);
    });
  });
});

// ============================================================================
// MEMORY RULE TESTS
// ============================================================================

describe("Memory Rule Checking", () => {
  describe("canReadMemory", () => {
    it("returns true when canRead is true", () => {
      const instruction = parseSystemInstructionXml(VALID_SUPERVISOR_XML);
      expect(canReadMemory(instruction)).toBe(true);
    });

    it("returns false when canRead is false", () => {
      const xml = VALID_SUPERVISOR_XML.replace(
        "<canRead>true</canRead>",
        "<canRead>false</canRead>"
      );
      const instruction = parseSystemInstructionXml(xml);
      expect(canReadMemory(instruction)).toBe(false);
    });
  });

  describe("canWriteMemory", () => {
    it("returns true for specialist", () => {
      const instruction = parseSystemInstructionXml(VALID_SPECIALIST_XML);
      expect(canWriteMemory(instruction)).toBe(true);
    });

    it("returns false for supervisor", () => {
      const instruction = parseSystemInstructionXml(VALID_SUPERVISOR_XML);
      expect(canWriteMemory(instruction)).toBe(false);
    });

    it("returns false for planner", () => {
      const instruction = parseSystemInstructionXml(VALID_PLANNER_XML);
      expect(canWriteMemory(instruction)).toBe(false);
    });

    it("returns false for verifier", () => {
      const instruction = parseSystemInstructionXml(VALID_VERIFIER_XML);
      expect(canWriteMemory(instruction)).toBe(false);
    });
  });

  describe("canValidateMemory", () => {
    it("returns true for verifier", () => {
      const instruction = parseSystemInstructionXml(VALID_VERIFIER_XML);
      expect(canValidateMemory(instruction)).toBe(true);
    });

    it("returns false for supervisor", () => {
      const instruction = parseSystemInstructionXml(VALID_SUPERVISOR_XML);
      expect(canValidateMemory(instruction)).toBe(false);
    });

    it("returns false for specialist", () => {
      const instruction = parseSystemInstructionXml(VALID_SPECIALIST_XML);
      expect(canValidateMemory(instruction)).toBe(false);
    });
  });
});

// ============================================================================
// ESCALATION RULE TESTS
// ============================================================================

describe("Escalation Rule Checking", () => {
  describe("canEscalate", () => {
    it("returns true when canEscalate is true", () => {
      const instruction = parseSystemInstructionXml(VALID_SUPERVISOR_XML);
      expect(canEscalate(instruction)).toBe(true);
    });

    it("returns false when canEscalate is false", () => {
      const xml = VALID_PLANNER_XML.replace(
        "<canEscalate>true</canEscalate>",
        "<canEscalate>false</canEscalate>"
      );
      const instruction = parseSystemInstructionXml(xml);
      expect(canEscalate(instruction)).toBe(false);
    });
  });

  describe("canApproveEscalation", () => {
    it("returns true only for supervisor", () => {
      const supervisor = parseSystemInstructionXml(VALID_SUPERVISOR_XML);
      expect(canApproveEscalation(supervisor)).toBe(true);

      const planner = parseSystemInstructionXml(VALID_PLANNER_XML);
      expect(canApproveEscalation(planner)).toBe(false);

      const specialist = parseSystemInstructionXml(VALID_SPECIALIST_XML);
      expect(canApproveEscalation(specialist)).toBe(false);

      const verifier = parseSystemInstructionXml(VALID_VERIFIER_XML);
      expect(canApproveEscalation(verifier)).toBe(false);
    });
  });
});

// ============================================================================
// INSTRUCTION CACHE TESTS
// ============================================================================

describe("Instruction Cache", () => {
  beforeEach(() => {
    clearInstructionCache();
  });

  afterEach(() => {
    clearInstructionCache();
  });

  describe("cacheInstruction", () => {
    it("caches instruction by role", () => {
      const instruction = parseSystemInstructionXml(VALID_SUPERVISOR_XML);
      cacheInstruction(instruction);

      const cached = getCachedInstruction("supervisor");
      expect(cached).toBeDefined();
      expect(cached?.role).toBe("supervisor");
    });

    it("replaces existing cached instruction", () => {
      const instruction1 = parseSystemInstructionXml(VALID_SUPERVISOR_XML);
      cacheInstruction(instruction1);

      const modifiedXml = VALID_SUPERVISOR_XML.replace('version="1.0.0"', 'version="2.0.0"');
      const instruction2 = parseSystemInstructionXml(modifiedXml);
      cacheInstruction(instruction2);

      const cached = getCachedInstruction("supervisor");
      expect(cached?.version).toBe("2.0.0");
    });
  });

  describe("getCachedInstruction", () => {
    it("returns undefined for uncached role", () => {
      expect(getCachedInstruction("supervisor")).toBeUndefined();
    });

    it("returns cached instruction", () => {
      const instruction = parseSystemInstructionXml(VALID_PLANNER_XML);
      cacheInstruction(instruction);

      const cached = getCachedInstruction("planner");
      expect(cached?.role).toBe("planner");
    });
  });

  describe("getCachedHash", () => {
    it("returns undefined for uncached role", () => {
      expect(getCachedHash("supervisor")).toBeUndefined();
    });

    it("returns hash of cached instruction", () => {
      const instruction = parseSystemInstructionXml(VALID_SUPERVISOR_XML);
      cacheInstruction(instruction);

      const expectedHash = computeInstructionHash(instruction);
      expect(getCachedHash("supervisor")).toBe(expectedHash);
    });
  });

  describe("clearInstructionCache", () => {
    it("clears all cached instructions", () => {
      const supervisor = parseSystemInstructionXml(VALID_SUPERVISOR_XML);
      const planner = parseSystemInstructionXml(VALID_PLANNER_XML);
      cacheInstruction(supervisor);
      cacheInstruction(planner);

      clearInstructionCache();

      expect(getCachedInstruction("supervisor")).toBeUndefined();
      expect(getCachedInstruction("planner")).toBeUndefined();
    });
  });

  describe("getAllCachedInstructions", () => {
    it("returns empty map when no instructions cached", () => {
      const all = getAllCachedInstructions();
      expect(all.size).toBe(0);
    });

    it("returns all cached instructions", () => {
      const supervisor = parseSystemInstructionXml(VALID_SUPERVISOR_XML);
      const planner = parseSystemInstructionXml(VALID_PLANNER_XML);
      const specialist = parseSystemInstructionXml(VALID_SPECIALIST_XML);

      cacheInstruction(supervisor);
      cacheInstruction(planner);
      cacheInstruction(specialist);

      const all = getAllCachedInstructions();
      expect(all.size).toBe(3);
      expect(all.get("supervisor")?.role).toBe("supervisor");
      expect(all.get("planner")?.role).toBe("planner");
      expect(all.get("specialist")?.role).toBe("specialist");
    });
  });
});

// ============================================================================
// ROLE-SPECIFIC CONSTRAINT TESTS
// ============================================================================

describe("Role-Specific Constraints", () => {
  describe("Supervisor Constraints", () => {
    it("must have canApproveEscalation=true", () => {
      const instruction = parseSystemInstructionXml(VALID_SUPERVISOR_XML);
      expect(instruction.escalationRules.canApproveEscalation).toBe(true);
    });

    it("must have canWrite=false", () => {
      const instruction = parseSystemInstructionXml(VALID_SUPERVISOR_XML);
      expect(instruction.memoryRules.canWrite).toBe(false);
    });

    it("must prohibit execute_tasks", () => {
      const instruction = parseSystemInstructionXml(VALID_SUPERVISOR_XML);
      const result = checkProhibition(instruction, "execute_tasks");
      expect(result.prohibited).toBe(true);
    });
  });

  describe("Planner Constraints", () => {
    it("must have canApproveEscalation=false", () => {
      const instruction = parseSystemInstructionXml(VALID_PLANNER_XML);
      expect(instruction.escalationRules.canApproveEscalation).toBe(false);
    });

    it("must have canWrite=false", () => {
      const instruction = parseSystemInstructionXml(VALID_PLANNER_XML);
      expect(instruction.memoryRules.canWrite).toBe(false);
    });

    it("must prohibit silent_degradation", () => {
      const instruction = parseSystemInstructionXml(VALID_PLANNER_XML);
      const result = checkProhibition(instruction, "silent_degradation");
      expect(result.prohibited).toBe(true);
    });
  });

  describe("Specialist Constraints", () => {
    it("must have canApproveEscalation=false", () => {
      const instruction = parseSystemInstructionXml(VALID_SPECIALIST_XML);
      expect(instruction.escalationRules.canApproveEscalation).toBe(false);
    });

    it("may have canWrite=true (unique to specialist)", () => {
      const instruction = parseSystemInstructionXml(VALID_SPECIALIST_XML);
      expect(instruction.memoryRules.canWrite).toBe(true);
    });

    it("must have canValidate=false", () => {
      const instruction = parseSystemInstructionXml(VALID_SPECIALIST_XML);
      expect(instruction.memoryRules.canValidate).toBe(false);
    });

    it("must prohibit self_authorize_capabilities", () => {
      const instruction = parseSystemInstructionXml(VALID_SPECIALIST_XML);
      const result = checkProhibition(instruction, "self_authorize_capabilities");
      expect(result.prohibited).toBe(true);
    });
  });

  describe("Verifier Constraints", () => {
    it("must have canApproveEscalation=false", () => {
      const instruction = parseSystemInstructionXml(VALID_VERIFIER_XML);
      expect(instruction.escalationRules.canApproveEscalation).toBe(false);
    });

    it("must have canWrite=false", () => {
      const instruction = parseSystemInstructionXml(VALID_VERIFIER_XML);
      expect(instruction.memoryRules.canWrite).toBe(false);
    });

    it("must have canValidate=true (unique to verifier)", () => {
      const instruction = parseSystemInstructionXml(VALID_VERIFIER_XML);
      expect(instruction.memoryRules.canValidate).toBe(true);
    });

    it("must prohibit modify_outputs", () => {
      const instruction = parseSystemInstructionXml(VALID_VERIFIER_XML);
      const result = checkProhibition(instruction, "modify_outputs");
      expect(result.prohibited).toBe(true);
    });

    it("must prohibit memory_write", () => {
      const instruction = parseSystemInstructionXml(VALID_VERIFIER_XML);
      const result = checkProhibition(instruction, "memory_write");
      expect(result.prohibited).toBe(true);
    });
  });
});

// ============================================================================
// EDGE CASE TESTS
// ============================================================================

describe("Edge Cases", () => {
  it("handles XML with extra whitespace", () => {
    const xmlWithWhitespace = `
      <?xml version="1.0" encoding="UTF-8"?>

      <systemInstruction   role="supervisor"   version="1.0.0"   schemaVersion="1.0"  >
        <purpose>
          <description>   Test   </description>
          <nature>   control-plane only   </nature>
          <responsibilities>
            <responsibility>   Test responsibility   </responsibility>
          </responsibilities>
        </purpose>
        <prohibitions>
          <prohibition   id="TEST-001"  >
            <action>   test   </action>
            <rationale>   test   </rationale>
          </prohibition>
        </prohibitions>
        <escalationRules>
          <canEscalate>true</canEscalate>
          <canApproveEscalation>true</canApproveEscalation>
          <escalationBehavior>explicit_ticket</escalationBehavior>
        </escalationRules>
        <memoryRules>
          <canRead>true</canRead>
          <canWrite>false</canWrite>
          <canValidate>false</canValidate>
          <advisoryOnly>true</advisoryOnly>
        </memoryRules>
      </systemInstruction>
    `;

    const instruction = parseSystemInstructionXml(xmlWithWhitespace);
    expect(instruction.role).toBe("supervisor");
    expect(instruction.purpose.description).toBe("Test");
  });

  it("handles boolean string values (true/false as strings)", () => {
    const xml = VALID_SUPERVISOR_XML
      .replace("<canRead>true</canRead>", "<canRead>true</canRead>")
      .replace("<canWrite>false</canWrite>", "<canWrite>false</canWrite>");

    const instruction = parseSystemInstructionXml(xml);
    expect(instruction.memoryRules.canRead).toBe(true);
    expect(instruction.memoryRules.canWrite).toBe(false);
  });

  it("preserves scope priority weights", () => {
    const instruction = parseSystemInstructionXml(VALID_SUPERVISOR_XML);
    expect(instruction.memoryRules.scopePriority).toBeDefined();
    expect(instruction.memoryRules.scopePriority).toHaveLength(2);
    expect(instruction.memoryRules.scopePriority?.[0]?.scope).toBe("workspace");
    expect(instruction.memoryRules.scopePriority?.[0]?.weight).toBe(1.0);
    expect(instruction.memoryRules.scopePriority?.[1]?.scope).toBe("repository");
    expect(instruction.memoryRules.scopePriority?.[1]?.weight).toBe(0.8);
  });

  it("handles single responsibility (not array)", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<systemInstruction role="verifier" version="1.0.0" schemaVersion="1.0">
  <purpose>
    <description>Test</description>
    <nature>test</nature>
    <responsibilities>
      <responsibility>Only one</responsibility>
    </responsibilities>
  </purpose>
  <prohibitions>
    <prohibition id="TEST-001">
      <action>test</action>
      <rationale>test</rationale>
    </prohibition>
  </prohibitions>
  <escalationRules>
    <canEscalate>true</canEscalate>
    <canApproveEscalation>false</canApproveEscalation>
    <escalationBehavior>explicit_ticket</escalationBehavior>
  </escalationRules>
  <memoryRules>
    <canRead>true</canRead>
    <canWrite>false</canWrite>
    <canValidate>true</canValidate>
    <advisoryOnly>true</advisoryOnly>
  </memoryRules>
</systemInstruction>`;

    const instruction = parseSystemInstructionXml(xml);
    expect(instruction.purpose.responsibilities).toHaveLength(1);
    expect(instruction.purpose.responsibilities[0]).toBe("Only one");
  });

  it("handles escalation triggers with all reasons", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<systemInstruction role="planner" version="1.0.0" schemaVersion="1.0">
  <purpose>
    <description>Test</description>
    <nature>test</nature>
    <responsibilities><responsibility>Test</responsibility></responsibilities>
  </purpose>
  <prohibitions>
    <prohibition id="TEST-001">
      <action>test</action>
      <rationale>test</rationale>
    </prohibition>
  </prohibitions>
  <escalationRules>
    <canEscalate>true</canEscalate>
    <canApproveEscalation>false</canApproveEscalation>
    <escalationTriggers>
      <trigger><reason>missing_capability</reason><description>A</description><autoEscalate>true</autoEscalate></trigger>
      <trigger><reason>ambiguous_requirement</reason><description>B</description><autoEscalate>false</autoEscalate></trigger>
      <trigger><reason>framework_uncertainty</reason><description>C</description><autoEscalate>false</autoEscalate></trigger>
      <trigger><reason>malformed_output</reason><description>D</description><autoEscalate>false</autoEscalate></trigger>
      <trigger><reason>policy_conflict</reason><description>E</description><autoEscalate>false</autoEscalate></trigger>
    </escalationTriggers>
    <escalationBehavior>explicit_ticket</escalationBehavior>
  </escalationRules>
  <memoryRules>
    <canRead>true</canRead>
    <canWrite>false</canWrite>
    <canValidate>false</canValidate>
    <advisoryOnly>true</advisoryOnly>
  </memoryRules>
</systemInstruction>`;

    const instruction = parseSystemInstructionXml(xml);
    expect(instruction.escalationRules.escalationTriggers).toHaveLength(5);
    expect(instruction.escalationRules.escalationTriggers?.[0]?.autoEscalate).toBe(true);
    expect(instruction.escalationRules.escalationTriggers?.[1]?.autoEscalate).toBe(false);
  });
});
