/**
 * Tests for the Peer Review mode:
 * - REVIEW_RUBRICS registry
 * - resolveRubric
 * - parseReview
 * - calculateWeightedScore
 * - calculateConsensusScores
 * - buildReviewPrompt / buildConsolidationPrompt
 * - DEFAULT_PEER_REVIEW_CONFIG
 * - SEVERITY_DESCRIPTIONS
 */

import { describe, it, expect } from "vitest";
import {
  REVIEW_RUBRICS,
  resolveRubric,
  parseReview,
  calculateWeightedScore,
  calculateConsensusScores,
  buildReviewPrompt,
  buildConsolidationPrompt,
  DEFAULT_PEER_REVIEW_CONFIG,
  SEVERITY_DESCRIPTIONS,
} from "@/lib/council/modes/peer-review";
import type {
  ReviewType,
  PeerReviewConfig,
  ReviewResult,
  ReviewRubric,
} from "@/lib/council/modes/peer-review";

// ---------------------------------------------------------------------------
// REVIEW_RUBRICS
// ---------------------------------------------------------------------------

describe("REVIEW_RUBRICS", () => {
  it("has 6 review types", () => {
    expect(Object.keys(REVIEW_RUBRICS)).toHaveLength(6);
  });

  it("architecture_review has 6 criteria", () => {
    expect(REVIEW_RUBRICS.architecture_review.criteria).toHaveLength(6);
  });

  it("code_review has 6 criteria", () => {
    expect(REVIEW_RUBRICS.code_review.criteria).toHaveLength(6);
  });

  it("design_spec_review has 5 criteria", () => {
    expect(REVIEW_RUBRICS.design_spec_review.criteria).toHaveLength(5);
  });

  it("compliance_audit has 4 criteria", () => {
    expect(REVIEW_RUBRICS.compliance_audit.criteria).toHaveLength(4);
  });

  it("business_plan_review has 5 criteria", () => {
    expect(REVIEW_RUBRICS.business_plan_review.criteria).toHaveLength(5);
  });

  it("custom has 0 criteria", () => {
    expect(REVIEW_RUBRICS.custom.criteria).toHaveLength(0);
  });

  it("all criteria weights are between 1 and 5", () => {
    for (const rubric of Object.values(REVIEW_RUBRICS)) {
      for (const c of rubric.criteria) {
        expect(c.weight).toBeGreaterThanOrEqual(1);
        expect(c.weight).toBeLessThanOrEqual(5);
      }
    }
  });

  it("all rubrics have non-empty name and description", () => {
    for (const rubric of Object.values(REVIEW_RUBRICS)) {
      expect(rubric.name.length).toBeGreaterThan(0);
      expect(rubric.description.length).toBeGreaterThan(0);
    }
  });

  it("rubric IDs match their keys", () => {
    for (const [key, rubric] of Object.entries(REVIEW_RUBRICS)) {
      expect(rubric.id).toBe(key);
    }
  });

  it("no duplicate criteria names within a rubric", () => {
    for (const rubric of Object.values(REVIEW_RUBRICS)) {
      const names = rubric.criteria.map((c) => c.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it("all criteria have non-empty fields", () => {
    for (const rubric of Object.values(REVIEW_RUBRICS)) {
      for (const c of rubric.criteria) {
        expect(c.name.length).toBeGreaterThan(0);
        expect(c.description.length).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// resolveRubric
// ---------------------------------------------------------------------------

describe("resolveRubric", () => {
  it("returns predefined rubric for architecture_review", () => {
    const config: PeerReviewConfig = {
      ...DEFAULT_PEER_REVIEW_CONFIG,
      reviewType: "architecture_review",
    };
    const rubric = resolveRubric(config);
    expect(rubric.id).toBe("architecture_review");
    expect(rubric.criteria).toHaveLength(6);
  });

  it("returns predefined rubric for code_review", () => {
    const config: PeerReviewConfig = {
      ...DEFAULT_PEER_REVIEW_CONFIG,
      reviewType: "code_review",
    };
    const rubric = resolveRubric(config);
    expect(rubric.id).toBe("code_review");
    expect(rubric.criteria).toHaveLength(6);
  });

  it("returns custom rubric when reviewType is custom", () => {
    const config: PeerReviewConfig = {
      ...DEFAULT_PEER_REVIEW_CONFIG,
      reviewType: "custom",
      customRubric: {
        name: "My Rubric",
        description: "Custom evaluation criteria",
        criteria: [
          { name: "Criterion A", description: "Desc A", weight: 3 },
          { name: "Criterion B", description: "Desc B", weight: 4 },
          { name: "Criterion C", description: "Desc C", weight: 5 },
        ],
      },
    };
    const rubric = resolveRubric(config);
    expect(rubric.id).toBe("custom");
    expect(rubric.name).toBe("My Rubric");
    expect(rubric.criteria).toHaveLength(3);
  });

  it("throws when custom type has no customRubric", () => {
    const config: PeerReviewConfig = {
      ...DEFAULT_PEER_REVIEW_CONFIG,
      reviewType: "custom",
    };
    expect(() => resolveRubric(config)).toThrow(
      "customRubric is required when reviewType is 'custom'"
    );
  });

  it("preserves criteria from custom rubric", () => {
    const config: PeerReviewConfig = {
      ...DEFAULT_PEER_REVIEW_CONFIG,
      reviewType: "custom",
      customRubric: {
        name: "Test",
        description: "Test rubric",
        criteria: [
          { name: "Alpha", description: "Alpha criterion", weight: 5 },
          { name: "Beta", description: "Beta criterion", weight: 2 },
          { name: "Gamma", description: "Gamma criterion", weight: 1 },
        ],
      },
    };
    const rubric = resolveRubric(config);
    expect(rubric.criteria[0].name).toBe("Alpha");
    expect(rubric.criteria[1].weight).toBe(2);
    expect(rubric.criteria[2].name).toBe("Gamma");
  });
});

// ---------------------------------------------------------------------------
// parseReview
// ---------------------------------------------------------------------------

const ARCH_RUBRIC = REVIEW_RUBRICS.architecture_review;

const WELL_FORMED_REVIEW = `## Peer Review

### Scores
| Criterion | Score (1-5) | Weight | Justification |
|-----------|:---:|:---:|---------------|
| Scalability | 4 | 5 | Kubernetes autoscaling is well-configured. |
| Security | 3 | 5 | JWT auth works but lacks refresh token rotation. |
| Maintainability | 4 | 4 | Clean service boundaries and good documentation. |
| Cost Efficiency | 3 | 3 | Over-provisioned for average load. |
| Reliability | 3 | 4 | Circuit breakers present but no chaos testing. |
| Performance | 4 | 3 | Redis caching strategy is effective. |

### Findings

**FINDING 1:** Single-Instance Database
- **Category:** Reliability
- **Severity:** CRITICAL
- **Location:** Data Layer
- **Description:** The primary database runs as a single instance.
- **Impact:** A database failure would cause complete system downtime.
- **Recommendation:** Implement PostgreSQL streaming replication.

**FINDING 2:** Missing Refresh Token Rotation
- **Category:** Security
- **Severity:** MAJOR
- **Location:** User Service
- **Description:** JWT access tokens have 24-hour expiry with no refresh token rotation.
- **Impact:** Compromised tokens remain valid for extended periods.
- **Recommendation:** Implement short-lived access tokens with refresh token rotation.

**FINDING 3:** No Load Testing Evidence
- **Category:** Performance
- **Severity:** MINOR
- **Location:** Infrastructure
- **Description:** No load testing results are documented.
- **Impact:** Performance under stress is unknown.
- **Recommendation:** Run load tests with k6 or similar tool.

**FINDING 4:** Consider CDN for Static Assets
- **Category:** Performance
- **Severity:** SUGGESTION
- **Location:** Frontend Deployment
- **Description:** Static assets are served directly from origin.
- **Impact:** Higher latency for geographically distributed users.
- **Recommendation:** Add CloudFront or similar CDN.

### Strengths
- Clean microservice boundaries with well-defined APIs
- Effective Redis caching strategy with proper invalidation
- Comprehensive API documentation
- Good use of container orchestration

### Summary
Overall the architecture is adequate with some notable strengths.`;

describe("parseReview", () => {
  it("parses well-formed review with 6 criteria scores", () => {
    const parsed = parseReview(WELL_FORMED_REVIEW, ARCH_RUBRIC);
    expect(parsed.scores).toHaveLength(6);
  });

  it("parses correct score values", () => {
    const parsed = parseReview(WELL_FORMED_REVIEW, ARCH_RUBRIC);
    const scalability = parsed.scores.find((s) => s.criterion === "Scalability");
    expect(scalability?.score).toBe(4);
    expect(scalability?.weight).toBe(5);
    const security = parsed.scores.find((s) => s.criterion === "Security");
    expect(security?.score).toBe(3);
  });

  it("extracts justifications", () => {
    const parsed = parseReview(WELL_FORMED_REVIEW, ARCH_RUBRIC);
    const scalability = parsed.scores.find((s) => s.criterion === "Scalability");
    expect(scalability?.justification).toContain("Kubernetes");
  });

  it("calculates correct weighted overall score", () => {
    const parsed = parseReview(WELL_FORMED_REVIEW, ARCH_RUBRIC);
    // Manual: (4*5 + 3*5 + 4*4 + 3*3 + 3*4 + 4*3) / (5+5+4+3+4+3) = 83/24 = 3.458... -> 3.5
    expect(parsed.overallScore).toBe(3.5);
  });

  it("parses 4 findings", () => {
    const parsed = parseReview(WELL_FORMED_REVIEW, ARCH_RUBRIC);
    expect(parsed.findings).toHaveLength(4);
  });

  it("parses finding fields correctly", () => {
    const parsed = parseReview(WELL_FORMED_REVIEW, ARCH_RUBRIC);
    const f1 = parsed.findings[0];
    expect(f1.number).toBe(1);
    expect(f1.title).toBe("Single-Instance Database");
    expect(f1.category).toBe("Reliability");
    expect(f1.severity).toBe("CRITICAL");
    expect(f1.location).toBe("Data Layer");
    expect(f1.description).toContain("single instance");
    expect(f1.impact).toContain("downtime");
    expect(f1.recommendation).toContain("replication");
  });

  it("counts findings by severity correctly", () => {
    const parsed = parseReview(WELL_FORMED_REVIEW, ARCH_RUBRIC);
    expect(parsed.findingCounts.CRITICAL).toBe(1);
    expect(parsed.findingCounts.MAJOR).toBe(1);
    expect(parsed.findingCounts.MINOR).toBe(1);
    expect(parsed.findingCounts.SUGGESTION).toBe(1);
  });

  it("parses CRITICAL and SUGGESTION severities", () => {
    const parsed = parseReview(WELL_FORMED_REVIEW, ARCH_RUBRIC);
    expect(parsed.findings[0].severity).toBe("CRITICAL");
    expect(parsed.findings[3].severity).toBe("SUGGESTION");
  });

  it("parses strengths", () => {
    const parsed = parseReview(WELL_FORMED_REVIEW, ARCH_RUBRIC);
    expect(parsed.strengths.length).toBeGreaterThanOrEqual(3);
    expect(parsed.strengths[0]).toContain("microservice");
  });

  it("returns empty scores for malformed text", () => {
    const parsed = parseReview("This is just random text with no structure.", ARCH_RUBRIC);
    expect(parsed.scores).toHaveLength(0);
    expect(parsed.overallScore).toBe(0);
  });

  it("returns empty findings for text without findings section", () => {
    const parsed = parseReview("No findings here at all.", ARCH_RUBRIC);
    expect(parsed.findings).toHaveLength(0);
    expect(parsed.findingCounts.CRITICAL).toBe(0);
    expect(parsed.findingCounts.MAJOR).toBe(0);
  });

  it("handles partial format gracefully", () => {
    const partial = `## Peer Review

### Scores
| Criterion | Score (1-5) | Weight | Justification |
|-----------|:---:|:---:|---------------|
| Scalability | 4 | 5 | Good scaling. |

### Summary
Partial review.`;
    const parsed = parseReview(partial, ARCH_RUBRIC);
    expect(parsed.scores).toHaveLength(1);
    expect(parsed.scores[0].criterion).toBe("Scalability");
    expect(parsed.findings).toHaveLength(0);
  });

  it("handles empty input", () => {
    const parsed = parseReview("", ARCH_RUBRIC);
    expect(parsed.scores).toHaveLength(0);
    expect(parsed.overallScore).toBe(0);
    expect(parsed.findings).toHaveLength(0);
    expect(parsed.strengths).toHaveLength(0);
  });

  it("handles case-insensitive severity matching", () => {
    // The regex uses 'gi' flag so CRITICAL/critical should both match
    // But the enum values in the format are always uppercase
    const text = `**FINDING 1:** Test Finding
- **Category:** Security
- **Severity:** CRITICAL
- **Location:** Test
- **Description:** Test desc
- **Impact:** Test impact
- **Recommendation:** Test rec`;
    const parsed = parseReview(text, ARCH_RUBRIC);
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0].severity).toBe("CRITICAL");
  });

  it("handles multiple findings with different severities", () => {
    const text = `**FINDING 1:** Critical Issue
- **Category:** Security
- **Severity:** CRITICAL
- **Location:** Auth
- **Description:** Auth bypass
- **Impact:** Full access
- **Recommendation:** Fix auth

**FINDING 2:** Major Issue
- **Category:** Performance
- **Severity:** MAJOR
- **Location:** DB
- **Description:** Slow queries
- **Impact:** High latency
- **Recommendation:** Add indexes

**FINDING 3:** Suggestion
- **Category:** Maintainability
- **Severity:** SUGGESTION
- **Location:** Code
- **Description:** Could be cleaner
- **Impact:** Dev productivity
- **Recommendation:** Refactor`;
    const parsed = parseReview(text, ARCH_RUBRIC);
    expect(parsed.findings).toHaveLength(3);
    expect(parsed.findingCounts.CRITICAL).toBe(1);
    expect(parsed.findingCounts.MAJOR).toBe(1);
    expect(parsed.findingCounts.SUGGESTION).toBe(1);
    expect(parsed.findingCounts.MINOR).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// calculateWeightedScore
// ---------------------------------------------------------------------------

describe("calculateWeightedScore", () => {
  it("calculates correctly with uniform weights", () => {
    const scores = [
      { score: 3, weight: 1 },
      { score: 4, weight: 1 },
      { score: 5, weight: 1 },
    ];
    expect(calculateWeightedScore(scores)).toBe(4);
  });

  it("calculates correctly with varying weights", () => {
    const scores = [
      { score: 5, weight: 5 },
      { score: 3, weight: 1 },
    ];
    // (5*5 + 3*1) / (5+1) = 28/6 = 4.666... -> 4.7
    expect(calculateWeightedScore(scores)).toBe(4.7);
  });

  it("returns 0 for empty array", () => {
    expect(calculateWeightedScore([])).toBe(0);
  });

  it("rounds to 1 decimal", () => {
    const scores = [
      { score: 3, weight: 3 },
      { score: 4, weight: 4 },
    ];
    // (3*3 + 4*4) / (3+4) = 25/7 = 3.571... -> 3.6
    expect(calculateWeightedScore(scores)).toBe(3.6);
  });

  it("returns 5 when all scores are 5", () => {
    const scores = [
      { score: 5, weight: 3 },
      { score: 5, weight: 5 },
      { score: 5, weight: 1 },
    ];
    expect(calculateWeightedScore(scores)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// calculateConsensusScores
// ---------------------------------------------------------------------------

describe("calculateConsensusScores", () => {
  const rubric = REVIEW_RUBRICS.architecture_review;

  const makeReview = (scoreMap: Record<string, number>): ReviewResult => ({
    reviewerIndex: 0,
    model: "test/model",
    reviewText: "",
    scores: Object.entries(scoreMap).map(([criterion, score]) => ({
      criterion,
      score,
      weight: rubric.criteria.find((c) => c.name === criterion)?.weight ?? 1,
      justification: "test",
    })),
    overallScore: 0,
    findings: [],
    findingCounts: { CRITICAL: 0, MAJOR: 0, MINOR: 0, SUGGESTION: 0 },
    strengths: [],
    responseTimeMs: 1000,
  });

  it("computes correct averages", () => {
    const reviews = [
      makeReview({ Scalability: 4, Security: 3 }),
      makeReview({ Scalability: 3, Security: 3 }),
    ];
    const consensus = calculateConsensusScores(reviews, rubric);
    const scalability = consensus.find((c) => c.criterion === "Scalability");
    expect(scalability?.average).toBe(3.5);
    const security = consensus.find((c) => c.criterion === "Security");
    expect(security?.average).toBe(3);
  });

  it("computes correct stddev", () => {
    const reviews = [
      makeReview({ Scalability: 4 }),
      makeReview({ Scalability: 2 }),
    ];
    const consensus = calculateConsensusScores(reviews, rubric);
    const scalability = consensus.find((c) => c.criterion === "Scalability");
    // stddev of [4,2] = sqrt(((4-3)^2 + (2-3)^2) / 2) = sqrt(1) = 1
    expect(scalability?.stddev).toBe(1);
  });

  it("marks High agreement when stddev < 0.5", () => {
    const reviews = [
      makeReview({ Scalability: 4 }),
      makeReview({ Scalability: 4 }),
    ];
    const consensus = calculateConsensusScores(reviews, rubric);
    const scalability = consensus.find((c) => c.criterion === "Scalability");
    expect(scalability?.stddev).toBe(0);
    expect(scalability?.agreement).toBe("High");
  });

  it("marks Medium agreement when stddev between 0.5 and 1.5", () => {
    const reviews = [
      makeReview({ Scalability: 4 }),
      makeReview({ Scalability: 2 }),
    ];
    const consensus = calculateConsensusScores(reviews, rubric);
    const scalability = consensus.find((c) => c.criterion === "Scalability");
    expect(scalability?.agreement).toBe("Medium");
  });

  it("marks Low agreement when stddev > 1.5", () => {
    const reviews = [
      makeReview({ Scalability: 5 }),
      makeReview({ Scalability: 1 }),
    ];
    const consensus = calculateConsensusScores(reviews, rubric);
    const scalability = consensus.find((c) => c.criterion === "Scalability");
    // stddev of [5,1] = sqrt(((5-3)^2 + (1-3)^2) / 2) = sqrt(4) = 2
    expect(scalability?.stddev).toBe(2);
    expect(scalability?.agreement).toBe("Low");
  });

  it("returns one entry per criterion", () => {
    const reviews = [
      makeReview({ Scalability: 4, Security: 3 }),
    ];
    const consensus = calculateConsensusScores(reviews, rubric);
    expect(consensus).toHaveLength(rubric.criteria.length);
  });

  it("handles missing scores gracefully", () => {
    const reviews = [
      makeReview({}), // no scores at all
    ];
    const consensus = calculateConsensusScores(reviews, rubric);
    for (const entry of consensus) {
      expect(entry.average).toBe(0);
      expect(entry.agreement).toBe("High");
    }
  });
});

// ---------------------------------------------------------------------------
// buildReviewPrompt
// ---------------------------------------------------------------------------

describe("buildReviewPrompt", () => {
  it("includes the user input", () => {
    const prompt = buildReviewPrompt("My architecture doc", "architecture_review", ARCH_RUBRIC);
    expect(prompt).toContain("My architecture doc");
  });

  it("includes the review type name", () => {
    const prompt = buildReviewPrompt("doc", "architecture_review", ARCH_RUBRIC);
    expect(prompt).toContain("Architecture Review");
  });

  it("includes all criteria names", () => {
    const prompt = buildReviewPrompt("doc", "architecture_review", ARCH_RUBRIC);
    for (const c of ARCH_RUBRIC.criteria) {
      expect(prompt).toContain(c.name);
    }
  });

  it("includes criterion weights", () => {
    const prompt = buildReviewPrompt("doc", "architecture_review", ARCH_RUBRIC);
    expect(prompt).toContain("weight: 5/5");
    expect(prompt).toContain("weight: 4/5");
    expect(prompt).toContain("weight: 3/5");
  });

  it("includes the scoring scale description", () => {
    const prompt = buildReviewPrompt("doc", "architecture_review", ARCH_RUBRIC);
    expect(prompt).toContain("1 = Critical deficiencies");
    expect(prompt).toContain("5 = Excellent");
  });

  it("includes format markers for findings", () => {
    const prompt = buildReviewPrompt("doc", "architecture_review", ARCH_RUBRIC);
    expect(prompt).toContain("**FINDING [n]:**");
    expect(prompt).toContain("**Category:**");
    expect(prompt).toContain("**Severity:**");
  });
});

// ---------------------------------------------------------------------------
// buildConsolidationPrompt
// ---------------------------------------------------------------------------

describe("buildConsolidationPrompt", () => {
  const reviews = [
    { reviewerIndex: 0, model: "anthropic/claude-opus-4-6", reviewText: "Review 1 text" },
    { reviewerIndex: 1, model: "openai/o3", reviewText: "Review 2 text" },
  ];

  it("includes the original work", () => {
    const prompt = buildConsolidationPrompt("My work under review", reviews, ARCH_RUBRIC);
    expect(prompt).toContain("My work under review");
  });

  it("includes reviewer texts", () => {
    const prompt = buildConsolidationPrompt("work", reviews, ARCH_RUBRIC);
    expect(prompt).toContain("Review 1 text");
    expect(prompt).toContain("Review 2 text");
  });

  it("includes model names", () => {
    const prompt = buildConsolidationPrompt("work", reviews, ARCH_RUBRIC);
    expect(prompt).toContain("anthropic/claude-opus-4-6");
    expect(prompt).toContain("openai/o3");
  });

  it("includes reviewer indices", () => {
    const prompt = buildConsolidationPrompt("work", reviews, ARCH_RUBRIC);
    expect(prompt).toContain("Reviewer 1");
    expect(prompt).toContain("Reviewer 2");
  });

  it("includes criteria from rubric", () => {
    const prompt = buildConsolidationPrompt("work", reviews, ARCH_RUBRIC);
    for (const c of ARCH_RUBRIC.criteria) {
      expect(prompt).toContain(c.name);
    }
  });

  it("includes format markers for action items", () => {
    const prompt = buildConsolidationPrompt("work", reviews, ARCH_RUBRIC);
    expect(prompt).toContain("Prioritized Action Items");
    expect(prompt).toContain("Executive Summary");
    expect(prompt).toContain("Consensus Findings");
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_PEER_REVIEW_CONFIG
// ---------------------------------------------------------------------------

describe("DEFAULT_PEER_REVIEW_CONFIG", () => {
  it("has architecture_review as default type", () => {
    expect(DEFAULT_PEER_REVIEW_CONFIG.reviewType).toBe("architecture_review");
  });

  it("has 3 reviewer models", () => {
    expect(DEFAULT_PEER_REVIEW_CONFIG.reviewerModels).toHaveLength(3);
  });

  it("has a consolidator model", () => {
    expect(DEFAULT_PEER_REVIEW_CONFIG.consolidatorModel).toBeTruthy();
  });

  it("has 150s timeout", () => {
    expect(DEFAULT_PEER_REVIEW_CONFIG.timeoutMs).toBe(150_000);
  });

  it("has non-empty model strings", () => {
    for (const model of DEFAULT_PEER_REVIEW_CONFIG.reviewerModels) {
      expect(model.length).toBeGreaterThan(0);
    }
    expect(DEFAULT_PEER_REVIEW_CONFIG.consolidatorModel.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// SEVERITY_DESCRIPTIONS
// ---------------------------------------------------------------------------

describe("SEVERITY_DESCRIPTIONS", () => {
  it("has all 4 severity levels", () => {
    expect(Object.keys(SEVERITY_DESCRIPTIONS)).toHaveLength(4);
    expect(SEVERITY_DESCRIPTIONS.CRITICAL).toBeDefined();
    expect(SEVERITY_DESCRIPTIONS.MAJOR).toBeDefined();
    expect(SEVERITY_DESCRIPTIONS.MINOR).toBeDefined();
    expect(SEVERITY_DESCRIPTIONS.SUGGESTION).toBeDefined();
  });

  it("all descriptions are non-empty strings", () => {
    for (const desc of Object.values(SEVERITY_DESCRIPTIONS)) {
      expect(typeof desc).toBe("string");
      expect(desc.length).toBeGreaterThan(0);
    }
  });

  it("CRITICAL mentions blocking", () => {
    expect(SEVERITY_DESCRIPTIONS.CRITICAL.toLowerCase()).toContain("block");
  });
});
