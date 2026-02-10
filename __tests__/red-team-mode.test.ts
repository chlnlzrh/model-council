/**
 * Tests for Red Team mode:
 * - parseSeverity
 * - parseVerdict
 * - parseAttackReport
 * - parseDefenseReport
 * - buildGeneratePrompt
 * - buildAttackRound1Prompt
 * - buildAttackRoundNPrompt
 * - buildDefensePrompt
 * - buildSynthesisPrompt
 * - DEFAULT_RED_TEAM_CONFIG
 */

import { describe, it, expect } from "vitest";
import {
  parseSeverity,
  parseVerdict,
  parseAttackReport,
  parseDefenseReport,
  buildGeneratePrompt,
  buildAttackRound1Prompt,
  buildAttackRoundNPrompt,
  buildDefensePrompt,
  buildSynthesisPrompt,
  DEFAULT_RED_TEAM_CONFIG,
} from "@/lib/council/modes/red-team";
import type {
  RedTeamRound,
  AttackResult,
  DefenseResult,
} from "@/lib/council/modes/red-team";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAttackResult(overrides: Partial<AttackResult> = {}): AttackResult {
  return {
    model: "openai/o3",
    round: 1,
    findings: [
      {
        title: "Test Finding",
        severity: "HIGH",
        location: "Line 1",
        vulnerability: "Test vulnerability",
        exploitScenario: "Test exploit",
      },
    ],
    summary: { critical: 0, high: 1, medium: 0, low: 0, overallRisk: "HIGH" },
    noFlaws: false,
    responseTimeMs: 5000,
    parseSuccess: true,
    ...overrides,
  };
}

function makeDefenseResult(overrides: Partial<DefenseResult> = {}): DefenseResult {
  return {
    model: "anthropic/claude-opus-4-6",
    round: 1,
    responses: [
      {
        findingTitle: "Test Finding",
        verdict: "ACCEPT",
        reasoning: "Valid concern",
        revision: "Fixed the issue",
      },
    ],
    accepted: 1,
    rebutted: 0,
    revisedContent: "Revised content here",
    responseTimeMs: 7000,
    parseSuccess: true,
    ...overrides,
  };
}

function makeRound(roundNumber: number, hasDefense: boolean = true): RedTeamRound {
  return {
    roundNumber,
    attack: makeAttackResult({ round: roundNumber }),
    defense: hasDefense ? makeDefenseResult({ round: roundNumber }) : null,
  };
}

// ---------------------------------------------------------------------------
// parseSeverity
// ---------------------------------------------------------------------------

describe("parseSeverity", () => {
  it("parses CRITICAL", () => {
    expect(parseSeverity("CRITICAL")).toBe("CRITICAL");
  });

  it("parses HIGH", () => {
    expect(parseSeverity("HIGH")).toBe("HIGH");
  });

  it("parses MEDIUM", () => {
    expect(parseSeverity("MEDIUM")).toBe("MEDIUM");
  });

  it("parses LOW", () => {
    expect(parseSeverity("LOW")).toBe("LOW");
  });

  it("is case insensitive", () => {
    expect(parseSeverity("critical")).toBe("CRITICAL");
    expect(parseSeverity("High")).toBe("HIGH");
    expect(parseSeverity("medium")).toBe("MEDIUM");
    expect(parseSeverity("low")).toBe("LOW");
  });

  it("strips bold markdown markers", () => {
    expect(parseSeverity("**CRITICAL**")).toBe("CRITICAL");
    expect(parseSeverity("**High**")).toBe("HIGH");
  });

  it("defaults to MEDIUM for unknown input", () => {
    expect(parseSeverity("UNKNOWN")).toBe("MEDIUM");
    expect(parseSeverity("something")).toBe("MEDIUM");
  });

  it("defaults to MEDIUM for empty input", () => {
    expect(parseSeverity("")).toBe("MEDIUM");
  });
});

// ---------------------------------------------------------------------------
// parseVerdict
// ---------------------------------------------------------------------------

describe("parseVerdict", () => {
  it("parses ACCEPT", () => {
    expect(parseVerdict("ACCEPT")).toBe("ACCEPT");
  });

  it("parses REBUT", () => {
    expect(parseVerdict("REBUT")).toBe("REBUT");
  });

  it("is case insensitive", () => {
    expect(parseVerdict("accept")).toBe("ACCEPT");
    expect(parseVerdict("Rebut")).toBe("REBUT");
  });

  it("strips bold markdown markers", () => {
    expect(parseVerdict("**ACCEPT**")).toBe("ACCEPT");
    expect(parseVerdict("**REBUT**")).toBe("REBUT");
  });

  it("defaults to REBUT for unknown input", () => {
    expect(parseVerdict("UNKNOWN")).toBe("REBUT");
    expect(parseVerdict("maybe")).toBe("REBUT");
  });

  it("defaults to REBUT for empty input", () => {
    expect(parseVerdict("")).toBe("REBUT");
  });
});

// ---------------------------------------------------------------------------
// parseAttackReport
// ---------------------------------------------------------------------------

describe("parseAttackReport", () => {
  it("parses a standard multi-finding report", () => {
    const text = `ATTACK REPORT — ROUND 1

FINDING 1: Missing Token Expiration
Severity: CRITICAL
Location: Line 4
Vulnerability: No expiration validation
Exploit Scenario: Leaked token valid forever

FINDING 2: No Error Handling
Severity: HIGH
Location: Line 5
Vulnerability: Unhandled throws crash server
Exploit Scenario: Malformed JWT causes 500

SUMMARY:
- Critical: 1, High: 1, Medium: 0, Low: 0
- Overall risk: HIGH`;

    const result = parseAttackReport(text);
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0].title).toBe("Missing Token Expiration");
    expect(result.findings[0].severity).toBe("CRITICAL");
    expect(result.findings[0].location).toBe("Line 4");
    expect(result.findings[0].vulnerability).toBe("No expiration validation");
    expect(result.findings[0].exploitScenario).toBe("Leaked token valid forever");
    expect(result.findings[1].title).toBe("No Error Handling");
    expect(result.findings[1].severity).toBe("HIGH");
    expect(result.summary.critical).toBe(1);
    expect(result.summary.high).toBe(1);
    expect(result.summary.overallRisk).toBe("HIGH");
  });

  it("parses a single finding report", () => {
    const text = `FINDING 1: Weak Password Policy
Severity: MEDIUM
Location: Section 2
Vulnerability: Only 8 characters required
Exploit Scenario: Brute force attack

SUMMARY:
- Critical: 0, High: 0, Medium: 1, Low: 0
- Overall risk: MEDIUM`;

    const result = parseAttackReport(text);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].title).toBe("Weak Password Policy");
    expect(result.findings[0].severity).toBe("MEDIUM");
    expect(result.summary.medium).toBe(1);
  });

  it("returns empty findings for empty input", () => {
    const result = parseAttackReport("");
    expect(result.findings).toHaveLength(0);
    expect(result.summary.critical).toBe(0);
    expect(result.summary.high).toBe(0);
    expect(result.summary.medium).toBe(0);
    expect(result.summary.low).toBe(0);
    expect(result.summary.overallRisk).toBe("NONE");
  });

  it("returns empty findings for whitespace-only input", () => {
    const result = parseAttackReport("   \n\n  ");
    expect(result.findings).toHaveLength(0);
  });

  it("handles missing fields with defaults", () => {
    const text = `FINDING 1: Some Issue
Severity: LOW
Vulnerability: Something is wrong`;

    const result = parseAttackReport(text);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].title).toBe("Some Issue");
    expect(result.findings[0].severity).toBe("LOW");
    expect(result.findings[0].location).toBe("Not specified");
    expect(result.findings[0].exploitScenario).toBe("Not specified");
  });

  it("handles multiline vulnerability description", () => {
    const text = `FINDING 1: Complex Issue
Severity: HIGH
Location: Module A
Vulnerability: The system has a complex issue
that spans multiple lines and includes details
about the vulnerability.
Exploit Scenario: Attacker exploits this flaw`;

    const result = parseAttackReport(text);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].vulnerability).toContain("spans multiple lines");
  });

  it("extracts summary correctly", () => {
    const text = `FINDING 1: Issue A
Severity: CRITICAL
Location: Here
Vulnerability: Bad
Exploit Scenario: Very bad

SUMMARY:
- Critical: 1, High: 0, Medium: 0, Low: 0
- Overall risk: CRITICAL — immediate action required`;

    const result = parseAttackReport(text);
    expect(result.summary.critical).toBe(1);
    expect(result.summary.overallRisk).toContain("CRITICAL");
  });

  it("computes summary from findings when SUMMARY section is missing", () => {
    const text = `FINDING 1: Issue A
Severity: HIGH
Location: Here
Vulnerability: Bad
Exploit Scenario: Very bad

FINDING 2: Issue B
Severity: LOW
Location: There
Vulnerability: Minor issue
Exploit Scenario: Slightly bad`;

    const result = parseAttackReport(text);
    expect(result.summary.high).toBe(1);
    expect(result.summary.low).toBe(1);
    expect(result.summary.overallRisk).toBe("Computed from findings");
  });

  it("parses zero findings when text has no FINDING blocks", () => {
    const text = `ATTACK REPORT — ROUND 1

No vulnerabilities found. The content is well-structured.

SUMMARY:
- Critical: 0, High: 0, Medium: 0, Low: 0
- Overall risk: NONE`;

    const result = parseAttackReport(text);
    expect(result.findings).toHaveLength(0);
    expect(result.summary.overallRisk).toContain("NONE");
  });

  it("handles severity with bold markers in findings", () => {
    const text = `FINDING 1: Bold Severity Test
Severity: **CRITICAL**
Location: Line 1
Vulnerability: Test
Exploit Scenario: Test`;

    const result = parseAttackReport(text);
    expect(result.findings[0].severity).toBe("CRITICAL");
  });

  it("handles multiple findings of the same severity", () => {
    const text = `FINDING 1: Issue A
Severity: HIGH
Location: Here
Vulnerability: Bad A
Exploit Scenario: Exploit A

FINDING 2: Issue B
Severity: HIGH
Location: There
Vulnerability: Bad B
Exploit Scenario: Exploit B

FINDING 3: Issue C
Severity: HIGH
Location: Everywhere
Vulnerability: Bad C
Exploit Scenario: Exploit C`;

    const result = parseAttackReport(text);
    expect(result.findings).toHaveLength(3);
    // Fallback summary should count all
    expect(result.summary.high).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// parseDefenseReport
// ---------------------------------------------------------------------------

describe("parseDefenseReport", () => {
  it("parses a standard defense report with mixed verdicts", () => {
    const text = `DEFENSE REPORT — ROUND 1

RESPONSE TO FINDING 1: Missing Token Expiration
Verdict: ACCEPT
Reasoning: Valid concern. Token expiration should be enforced.
Revision: Added expiresIn check to jwt.verify

RESPONSE TO FINDING 2: Environment Variable Access
Verdict: REBUT
Reasoning: The application validates env vars at startup.
Revision: N/A

DEFENSE SUMMARY:
- Accepted: 1, Rebutted: 1

---
REVISED CONTENT:
The revised authentication middleware with fixes applied.`;

    const result = parseDefenseReport(text);
    expect(result.responses).toHaveLength(2);
    expect(result.responses[0].findingTitle).toBe("Missing Token Expiration");
    expect(result.responses[0].verdict).toBe("ACCEPT");
    expect(result.responses[0].revision).toBe("Added expiresIn check to jwt.verify");
    expect(result.responses[1].findingTitle).toBe("Environment Variable Access");
    expect(result.responses[1].verdict).toBe("REBUT");
    expect(result.responses[1].revision).toBeNull();
    expect(result.accepted).toBe(1);
    expect(result.rebutted).toBe(1);
    expect(result.revisedContent).toContain("revised authentication middleware");
  });

  it("parses all-ACCEPT defense", () => {
    const text = `RESPONSE TO FINDING 1: Issue A
Verdict: ACCEPT
Reasoning: Valid concern
Revision: Fixed it

RESPONSE TO FINDING 2: Issue B
Verdict: ACCEPT
Reasoning: Also valid
Revision: Fixed this too

---
REVISED CONTENT:
All fixes applied.`;

    const result = parseDefenseReport(text);
    expect(result.accepted).toBe(2);
    expect(result.rebutted).toBe(0);
  });

  it("parses all-REBUT defense", () => {
    const text = `RESPONSE TO FINDING 1: Issue A
Verdict: REBUT
Reasoning: Not a real issue
Revision: N/A

RESPONSE TO FINDING 2: Issue B
Verdict: REBUT
Reasoning: Also not a real issue
Revision: N/A

---
REVISED CONTENT:
No changes needed.`;

    const result = parseDefenseReport(text);
    expect(result.accepted).toBe(0);
    expect(result.rebutted).toBe(2);
  });

  it("returns empty for empty input", () => {
    const result = parseDefenseReport("");
    expect(result.responses).toHaveLength(0);
    expect(result.accepted).toBe(0);
    expect(result.rebutted).toBe(0);
    expect(result.revisedContent).toBe("");
  });

  it("extracts revised content after separator", () => {
    const text = `RESPONSE TO FINDING 1: Issue
Verdict: ACCEPT
Reasoning: Valid
Revision: Fix

---
REVISED CONTENT:
Here is the revised version
with multiple lines
of content.`;

    const result = parseDefenseReport(text);
    expect(result.revisedContent).toContain("revised version");
    expect(result.revisedContent).toContain("multiple lines");
  });

  it("extracts revised content without separator as fallback", () => {
    const text = `RESPONSE TO FINDING 1: Issue
Verdict: ACCEPT
Reasoning: Valid
Revision: Fix

REVISED CONTENT:
Fallback revised content here.`;

    const result = parseDefenseReport(text);
    expect(result.revisedContent).toContain("Fallback revised content");
  });

  it("defaults verdict to REBUT for missing verdict", () => {
    const text = `RESPONSE TO FINDING 1: Ambiguous Finding
Reasoning: Not sure about this one
Revision: N/A`;

    const result = parseDefenseReport(text);
    expect(result.responses).toHaveLength(1);
    expect(result.responses[0].verdict).toBe("REBUT");
  });

  it("treats N/A revision as null", () => {
    const text = `RESPONSE TO FINDING 1: Test
Verdict: REBUT
Reasoning: Not valid
Revision: N/A`;

    const result = parseDefenseReport(text);
    expect(result.responses[0].revision).toBeNull();
  });

  it("computes counts from parsed responses, not DEFENSE SUMMARY", () => {
    const text = `RESPONSE TO FINDING 1: Issue A
Verdict: ACCEPT
Reasoning: Valid
Revision: Fixed

RESPONSE TO FINDING 2: Issue B
Verdict: REBUT
Reasoning: Invalid
Revision: N/A

RESPONSE TO FINDING 3: Issue C
Verdict: ACCEPT
Reasoning: Also valid
Revision: Also fixed

DEFENSE SUMMARY:
- Accepted: 999, Rebutted: 999

---
REVISED CONTENT:
Fixed stuff.`;

    const result = parseDefenseReport(text);
    // Counts come from parsed responses, not DEFENSE SUMMARY text
    expect(result.accepted).toBe(2);
    expect(result.rebutted).toBe(1);
  });

  it("handles empty revised content section", () => {
    const text = `RESPONSE TO FINDING 1: Issue
Verdict: REBUT
Reasoning: Not valid
Revision: N/A`;

    const result = parseDefenseReport(text);
    expect(result.revisedContent).toBe("");
  });

  it("handles case-insensitive verdict parsing", () => {
    const text = `RESPONSE TO FINDING 1: Issue
Verdict: accept
Reasoning: Valid
Revision: Fixed it`;

    const result = parseDefenseReport(text);
    expect(result.responses[0].verdict).toBe("ACCEPT");
  });
});

// ---------------------------------------------------------------------------
// buildGeneratePrompt
// ---------------------------------------------------------------------------

describe("buildGeneratePrompt", () => {
  it("includes user input", () => {
    const prompt = buildGeneratePrompt("Review my code");
    expect(prompt).toContain("Review my code");
  });

  it("requests structured format", () => {
    const prompt = buildGeneratePrompt("test input");
    expect(prompt).toContain("structured format");
  });

  it("instructs faithfulness to input", () => {
    const prompt = buildGeneratePrompt("test input");
    expect(prompt).toContain("faithfully represent");
  });

  it("handles multi-line input", () => {
    const input = "Line 1\nLine 2\nLine 3";
    const prompt = buildGeneratePrompt(input);
    expect(prompt).toContain("Line 1\nLine 2\nLine 3");
  });
});

// ---------------------------------------------------------------------------
// buildAttackRound1Prompt
// ---------------------------------------------------------------------------

describe("buildAttackRound1Prompt", () => {
  it("includes content under review", () => {
    const prompt = buildAttackRound1Prompt("My content here");
    expect(prompt).toContain("My content here");
  });

  it("requests FINDING format", () => {
    const prompt = buildAttackRound1Prompt("test");
    expect(prompt).toContain("FINDING 1:");
  });

  it("includes severity levels", () => {
    const prompt = buildAttackRound1Prompt("test");
    expect(prompt).toContain("CRITICAL");
    expect(prompt).toContain("HIGH");
    expect(prompt).toContain("MEDIUM");
    expect(prompt).toContain("LOW");
  });

  it("includes adversary instruction", () => {
    const prompt = buildAttackRound1Prompt("test");
    expect(prompt).toContain("ruthless red team adversary");
  });
});

// ---------------------------------------------------------------------------
// buildAttackRoundNPrompt
// ---------------------------------------------------------------------------

describe("buildAttackRoundNPrompt", () => {
  it("includes revised content", () => {
    const prompt = buildAttackRoundNPrompt("revised content", "defense text", 2);
    expect(prompt).toContain("revised content");
  });

  it("includes previous defense", () => {
    const prompt = buildAttackRoundNPrompt("content", "defense summary here", 2);
    expect(prompt).toContain("defense summary here");
  });

  it("includes round number", () => {
    const prompt = buildAttackRoundNPrompt("content", "defense", 3);
    expect(prompt).toContain("ROUND 3");
  });

  it("instructs to find NEW weaknesses", () => {
    const prompt = buildAttackRoundNPrompt("content", "defense", 2);
    expect(prompt).toContain("NEW weaknesses");
  });
});

// ---------------------------------------------------------------------------
// buildDefensePrompt
// ---------------------------------------------------------------------------

describe("buildDefensePrompt", () => {
  it("includes original content", () => {
    const prompt = buildDefensePrompt("original content", "attack report", 1);
    expect(prompt).toContain("original content");
  });

  it("includes attack report", () => {
    const prompt = buildDefensePrompt("content", "the attack report", 1);
    expect(prompt).toContain("the attack report");
  });

  it("includes round number", () => {
    const prompt = buildDefensePrompt("content", "report", 2);
    expect(prompt).toContain("ROUND 2");
  });

  it("includes ACCEPT/REBUT instruction", () => {
    const prompt = buildDefensePrompt("content", "report", 1);
    expect(prompt).toContain("ACCEPT");
    expect(prompt).toContain("REBUT");
  });

  it("requests REVISED CONTENT section", () => {
    const prompt = buildDefensePrompt("content", "report", 1);
    expect(prompt).toContain("REVISED CONTENT");
  });
});

// ---------------------------------------------------------------------------
// buildSynthesisPrompt
// ---------------------------------------------------------------------------

describe("buildSynthesisPrompt", () => {
  it("includes original content", () => {
    const rounds = [makeRound(1)];
    const prompt = buildSynthesisPrompt("original content here", rounds, 1);
    expect(prompt).toContain("original content here");
  });

  it("includes round data", () => {
    const rounds = [makeRound(1), makeRound(2)];
    const prompt = buildSynthesisPrompt("content", rounds, 2);
    expect(prompt).toContain("ROUND 1");
    expect(prompt).toContain("ROUND 2");
  });

  it("includes total round count", () => {
    const rounds = [makeRound(1)];
    const prompt = buildSynthesisPrompt("content", rounds, 1);
    expect(prompt).toContain("1 round(s)");
  });

  it("requests hardened output section", () => {
    const rounds = [makeRound(1)];
    const prompt = buildSynthesisPrompt("content", rounds, 1);
    expect(prompt).toContain("Hardened Output");
  });

  it("requests vulnerability audit table", () => {
    const rounds = [makeRound(1)];
    const prompt = buildSynthesisPrompt("content", rounds, 1);
    expect(prompt).toContain("Vulnerability Audit Summary");
    expect(prompt).toContain("| # | Finding | Severity | Verdict | Status |");
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_RED_TEAM_CONFIG
// ---------------------------------------------------------------------------

describe("DEFAULT_RED_TEAM_CONFIG", () => {
  it("has a valid generator model", () => {
    expect(DEFAULT_RED_TEAM_CONFIG.generatorModel).toBeTruthy();
    expect(DEFAULT_RED_TEAM_CONFIG.generatorModel).toContain("/");
  });

  it("has a valid attacker model", () => {
    expect(DEFAULT_RED_TEAM_CONFIG.attackerModel).toBeTruthy();
    expect(DEFAULT_RED_TEAM_CONFIG.attackerModel).toContain("/");
  });

  it("generator and attacker are different models", () => {
    expect(DEFAULT_RED_TEAM_CONFIG.generatorModel).not.toBe(
      DEFAULT_RED_TEAM_CONFIG.attackerModel
    );
  });

  it("synthesizer defaults to generator", () => {
    expect(DEFAULT_RED_TEAM_CONFIG.synthesizerModel).toBe(
      DEFAULT_RED_TEAM_CONFIG.generatorModel
    );
  });

  it("has rounds set to 2", () => {
    expect(DEFAULT_RED_TEAM_CONFIG.rounds).toBe(2);
  });

  it("has a reasonable timeout", () => {
    expect(DEFAULT_RED_TEAM_CONFIG.timeoutMs).toBeGreaterThanOrEqual(30_000);
    expect(DEFAULT_RED_TEAM_CONFIG.timeoutMs).toBeLessThanOrEqual(180_000);
  });

  it("has a reasonable maxInputLength", () => {
    expect(DEFAULT_RED_TEAM_CONFIG.maxInputLength).toBeGreaterThanOrEqual(1_000);
    expect(DEFAULT_RED_TEAM_CONFIG.maxInputLength).toBeLessThanOrEqual(50_000);
  });

  it("has rounds in valid range (1-3)", () => {
    expect(DEFAULT_RED_TEAM_CONFIG.rounds).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_RED_TEAM_CONFIG.rounds).toBeLessThanOrEqual(3);
  });
});
