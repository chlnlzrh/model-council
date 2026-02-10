/**
 * Tests for the Specialist Panel mode:
 * - Role library
 * - buildSpecialistSystemPrompt / buildSpecialistUserPrompt
 * - buildPanelSynthesisPrompt
 * - parseSpecialistReport
 * - buildCustomRole
 * - DEFAULT_PANEL_CONFIG
 */

import { describe, it, expect } from "vitest";
import {
  SPECIALIST_ROLE_LIBRARY,
  getSpecialistRole,
  getAvailableRoleIds,
  buildCustomRole,
  buildSpecialistSystemPrompt,
  buildSpecialistUserPrompt,
  buildPanelSynthesisPrompt,
  parseSpecialistReport,
  DEFAULT_PANEL_CONFIG,
} from "@/lib/council/modes/specialist-panel";
import type { SpecialistRole } from "@/lib/council/modes/specialist-panel";

// ---------------------------------------------------------------------------
// Role Library
// ---------------------------------------------------------------------------

describe("SPECIALIST_ROLE_LIBRARY", () => {
  it("has 8 predefined roles", () => {
    expect(Object.keys(SPECIALIST_ROLE_LIBRARY)).toHaveLength(8);
  });

  it("every role has required fields", () => {
    for (const role of Object.values(SPECIALIST_ROLE_LIBRARY)) {
      expect(role.id).toBeTruthy();
      expect(role.title).toBeTruthy();
      expect(role.expertiseAreas).toBeTruthy();
      expect(role.description).toBeTruthy();
      expect(role.priorities.length).toBeGreaterThanOrEqual(3);
      expect(role.criteria.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("every role has exactly 5 criteria", () => {
    for (const role of Object.values(SPECIALIST_ROLE_LIBRARY)) {
      expect(role.criteria).toHaveLength(5);
    }
  });

  it("every role has exactly 4 priorities", () => {
    for (const role of Object.values(SPECIALIST_ROLE_LIBRARY)) {
      expect(role.priorities).toHaveLength(4);
    }
  });

  it("contains expected role IDs", () => {
    const ids = Object.keys(SPECIALIST_ROLE_LIBRARY);
    expect(ids).toContain("security_expert");
    expect(ids).toContain("cost_analyst");
    expect(ids).toContain("scalability_architect");
    expect(ids).toContain("ux_designer");
    expect(ids).toContain("devops_engineer");
    expect(ids).toContain("compliance_officer");
    expect(ids).toContain("performance_engineer");
    expect(ids).toContain("data_architect");
  });
});

describe("getSpecialistRole", () => {
  it("returns role for valid IDs", () => {
    const role = getSpecialistRole("security_expert");
    expect(role).not.toBeNull();
    expect(role!.title).toBe("Security Expert");
  });

  it("returns null for unknown IDs", () => {
    expect(getSpecialistRole("unknown")).toBeNull();
    expect(getSpecialistRole("")).toBeNull();
  });
});

describe("getAvailableRoleIds", () => {
  it("returns 8 role IDs", () => {
    expect(getAvailableRoleIds()).toHaveLength(8);
  });
});

describe("buildCustomRole", () => {
  it("creates a role with a generated ID", () => {
    const role = buildCustomRole({
      title: "Mobile Specialist",
      expertiseAreas: "iOS, Android, React Native",
      description: "You evaluate mobile platforms.",
      priorities: ["Check platform compat", "Review app store rules", "Assess offline"],
      criteria: ["Compatibility", "Compliance", "Offline Support"],
    });
    expect(role.id).toBe("custom_mobile_specialist");
    expect(role.title).toBe("Mobile Specialist");
    expect(role.criteria).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// buildSpecialistSystemPrompt
// ---------------------------------------------------------------------------

describe("buildSpecialistSystemPrompt", () => {
  const role = SPECIALIST_ROLE_LIBRARY["security_expert"];

  it("includes the role title", () => {
    const prompt = buildSpecialistSystemPrompt(role);
    expect(prompt).toContain("Security Expert");
  });

  it("includes expertise areas", () => {
    const prompt = buildSpecialistSystemPrompt(role);
    expect(prompt).toContain("application security");
    expect(prompt).toContain("threat modeling");
  });

  it("includes the role description", () => {
    const prompt = buildSpecialistSystemPrompt(role);
    expect(prompt).toContain("security posture");
  });

  it("includes all priorities numbered", () => {
    const prompt = buildSpecialistSystemPrompt(role);
    expect(prompt).toContain("1.");
    expect(prompt).toContain("2.");
    expect(prompt).toContain("3.");
    expect(prompt).toContain("4.");
  });

  it("includes all criteria", () => {
    const prompt = buildSpecialistSystemPrompt(role);
    for (const criterion of role.criteria) {
      expect(prompt).toContain(criterion);
    }
  });
});

// ---------------------------------------------------------------------------
// buildSpecialistUserPrompt
// ---------------------------------------------------------------------------

describe("buildSpecialistUserPrompt", () => {
  const role = SPECIALIST_ROLE_LIBRARY["cost_analyst"];

  it("includes the user input", () => {
    const prompt = buildSpecialistUserPrompt("Evaluate our AWS setup", role);
    expect(prompt).toContain("Evaluate our AWS setup");
  });

  it("includes the role title in the format", () => {
    const prompt = buildSpecialistUserPrompt("Test", role);
    expect(prompt).toContain("Cost Analyst Assessment");
  });

  it("includes all criteria in the table template", () => {
    const prompt = buildSpecialistUserPrompt("Test", role);
    for (const criterion of role.criteria) {
      expect(prompt).toContain(criterion);
    }
  });

  it("includes structured format instructions", () => {
    const prompt = buildSpecialistUserPrompt("Test", role);
    expect(prompt).toContain("### Key Findings");
    expect(prompt).toContain("### Risk Assessment");
    expect(prompt).toContain("### Top 3 Recommendations");
    expect(prompt).toContain("### Detailed Analysis");
  });
});

// ---------------------------------------------------------------------------
// buildPanelSynthesisPrompt
// ---------------------------------------------------------------------------

describe("buildPanelSynthesisPrompt", () => {
  const reports = [
    { roleTitle: "Security Expert", model: "model-a", report: "Security analysis..." },
    { roleTitle: "Cost Analyst", model: "model-b", report: "Cost analysis..." },
  ];

  it("includes the user input", () => {
    const prompt = buildPanelSynthesisPrompt("Evaluate architecture", reports);
    expect(prompt).toContain("Evaluate architecture");
  });

  it("includes the specialist count", () => {
    const prompt = buildPanelSynthesisPrompt("Test", reports);
    expect(prompt).toContain("2 specialists");
  });

  it("includes all specialist reports", () => {
    const prompt = buildPanelSynthesisPrompt("Test", reports);
    expect(prompt).toContain("--- Security Expert (model-a) ---");
    expect(prompt).toContain("Security analysis...");
    expect(prompt).toContain("--- Cost Analyst (model-b) ---");
    expect(prompt).toContain("Cost analysis...");
  });

  it("includes synthesis format instructions", () => {
    const prompt = buildPanelSynthesisPrompt("Test", reports);
    expect(prompt).toContain("### Convergent Findings");
    expect(prompt).toContain("### Divergent Findings");
    expect(prompt).toContain("### Consolidated Risk Matrix");
    expect(prompt).toContain("### Unified Recommendations");
    expect(prompt).toContain("### Executive Summary");
  });

  it("includes failed roles note when provided", () => {
    const prompt = buildPanelSynthesisPrompt("Test", reports, ["DevOps Engineer"]);
    expect(prompt).toContain("DevOps Engineer");
    expect(prompt).toContain("unavailable due to errors");
  });

  it("does not include failed note when no failures", () => {
    const prompt = buildPanelSynthesisPrompt("Test", reports);
    expect(prompt).not.toContain("unavailable due to errors");
  });
});

// ---------------------------------------------------------------------------
// parseSpecialistReport
// ---------------------------------------------------------------------------

describe("parseSpecialistReport", () => {
  const role = SPECIALIST_ROLE_LIBRARY["security_expert"];

  const sampleReport = `## Security Expert Assessment

### Key Findings
1. JWT tokens use long expiry without rotation
2. Three API endpoints accept unvalidated user input
3. No mTLS between internal microservices
4. Security event logging is incomplete

### Risk Assessment
| Criterion | Rating (1-5) | Notes |
|-----------|:---:|-------|
| Authentication & Authorization | 3 | JWT implementation lacks refresh token rotation |
| Data Protection | 4 | Encryption at rest and in transit properly configured |
| Input Validation | 2 | Missing server-side validation on 3 endpoints |
| Attack Surface | 3 | API gateway helps but internal services lack mTLS |
| Incident Response Readiness | 2 | No runbooks or alerting for security events |

### Top 3 Recommendations
1. Implement refresh token rotation with short-lived access tokens
2. Add server-side input validation middleware to all API endpoints
3. Create incident response runbooks and configure security alerting

### Detailed Analysis
This is the detailed analysis text.`;

  it("extracts criteria scores from the markdown table", () => {
    const parsed = parseSpecialistReport(sampleReport, role);
    expect(parsed.criteriaScores).toHaveLength(5);
    expect(parsed.criteriaScores[0].criterion).toBe("Authentication & Authorization");
    expect(parsed.criteriaScores[0].score).toBe(3);
    expect(parsed.criteriaScores[0].notes).toContain("refresh token rotation");
  });

  it("extracts correct score values", () => {
    const parsed = parseSpecialistReport(sampleReport, role);
    const scores = parsed.criteriaScores.map((c) => c.score);
    expect(scores).toEqual([3, 4, 2, 3, 2]);
  });

  it("extracts top 3 recommendations", () => {
    const parsed = parseSpecialistReport(sampleReport, role);
    expect(parsed.topRecommendations).toHaveLength(3);
    expect(parsed.topRecommendations[0]).toContain("refresh token rotation");
    expect(parsed.topRecommendations[1]).toContain("input validation");
    expect(parsed.topRecommendations[2]).toContain("incident response runbooks");
  });

  it("extracts key findings", () => {
    const parsed = parseSpecialistReport(sampleReport, role);
    expect(parsed.keyFindings.length).toBeGreaterThanOrEqual(4);
    expect(parsed.keyFindings[0]).toContain("JWT tokens");
  });

  it("calculates average score", () => {
    const parsed = parseSpecialistReport(sampleReport, role);
    // (3 + 4 + 2 + 3 + 2) / 5 = 2.8
    expect(parsed.averageScore).toBe(2.8);
  });

  it("sets role title", () => {
    const parsed = parseSpecialistReport(sampleReport, role);
    expect(parsed.roleTitle).toBe("Security Expert");
  });

  it("handles missing criteria gracefully", () => {
    const parsed = parseSpecialistReport("No structured data here.", role);
    expect(parsed.criteriaScores).toHaveLength(0);
    expect(parsed.topRecommendations).toHaveLength(0);
    expect(parsed.keyFindings).toHaveLength(0);
    expect(parsed.averageScore).toBe(0);
  });

  it("handles partial data (some criteria present, some missing)", () => {
    const partial = `## Security Expert Assessment

### Key Findings
1. Found an issue

### Risk Assessment
| Criterion | Rating (1-5) | Notes |
|-----------|:---:|-------|
| Authentication & Authorization | 4 | Good auth |
| Data Protection | 3 | Okay encryption |

### Top 3 Recommendations
1. Fix the issue`;

    const parsed = parseSpecialistReport(partial, role);
    expect(parsed.criteriaScores).toHaveLength(2);
    expect(parsed.topRecommendations).toHaveLength(1);
    expect(parsed.keyFindings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_PANEL_CONFIG
// ---------------------------------------------------------------------------

describe("DEFAULT_PANEL_CONFIG", () => {
  it("has 3 default specialists", () => {
    expect(DEFAULT_PANEL_CONFIG.specialists).toHaveLength(3);
  });

  it("all default specialists have valid role IDs", () => {
    for (const s of DEFAULT_PANEL_CONFIG.specialists) {
      expect(getSpecialistRole(s.roleId)).not.toBeNull();
    }
  });

  it("all default specialists have a model", () => {
    for (const s of DEFAULT_PANEL_CONFIG.specialists) {
      expect(s.model.length).toBeGreaterThan(0);
    }
  });

  it("has a synthesizer model", () => {
    expect(DEFAULT_PANEL_CONFIG.synthesizerModel.length).toBeGreaterThan(0);
  });

  it("has a timeout", () => {
    expect(DEFAULT_PANEL_CONFIG.timeoutMs).toBeGreaterThan(0);
  });
});
