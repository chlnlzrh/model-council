/**
 * Tests for Jury mode:
 * - parseScores
 * - parseVerdict
 * - calculateAverage
 * - calculateMajorityVerdict
 * - calculateDimensionAverages
 * - calculateDimensionRanges
 * - buildJurorPrompt
 * - buildForemanPrompt
 * - buildJuryTitlePrompt
 * - DEFAULT_JURY_CONFIG
 */

import { describe, it, expect } from "vitest";
import {
  parseScores,
  parseVerdict,
  calculateAverage,
  calculateMajorityVerdict,
  calculateDimensionAverages,
  calculateDimensionRanges,
  buildJurorPrompt,
  buildForemanPrompt,
  buildJuryTitlePrompt,
  DEFAULT_JURY_CONFIG,
} from "@/lib/council/modes/jury";
import type { JurorAssessment, DimensionScores } from "@/lib/council/modes/jury";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAssessment(
  overrides: Partial<JurorAssessment> = {}
): JurorAssessment {
  return {
    model: "test/model",
    assessmentText: "test",
    scores: {
      accuracy: 8,
      completeness: 7,
      clarity: 9,
      relevance: 8,
      actionability: 6,
    },
    average: 7.6,
    verdict: "APPROVE",
    recommendations: [],
    responseTimeMs: 1000,
    parseSuccess: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseScores
// ---------------------------------------------------------------------------

describe("parseScores", () => {
  it("parses table format scores", () => {
    const text = `
| Dimension | Score | Justification |
|-----------|:-----:|---------------|
| Accuracy | 8 | Good facts |
| Completeness | 7 | Covers most |
| Clarity | 9 | Very clear |
| Relevance | 8 | On topic |
| Actionability | 6 | Some guidance |
`;
    const scores = parseScores(text);
    expect(scores.accuracy).toBe(8);
    expect(scores.completeness).toBe(7);
    expect(scores.clarity).toBe(9);
    expect(scores.relevance).toBe(8);
    expect(scores.actionability).toBe(6);
  });

  it("parses inline format scores", () => {
    const text = `
Accuracy: 8
Completeness: 7
Clarity: 9
Relevance: 8
Actionability: 6
`;
    const scores = parseScores(text);
    expect(scores.accuracy).toBe(8);
    expect(scores.completeness).toBe(7);
    expect(scores.clarity).toBe(9);
    expect(scores.relevance).toBe(8);
    expect(scores.actionability).toBe(6);
  });

  it("handles mixed case dimension names", () => {
    const text = `
| ACCURACY | 8 | Good |
| completeness | 7 | OK |
| Clarity | 9 | Clear |
| RELEVANCE | 8 | Relevant |
| Actionability | 6 | Some |
`;
    const scores = parseScores(text);
    expect(scores.accuracy).toBe(8);
    expect(scores.completeness).toBe(7);
    expect(scores.clarity).toBe(9);
    expect(scores.relevance).toBe(8);
    expect(scores.actionability).toBe(6);
  });

  it("rejects scores outside 1-10 range", () => {
    const text = `
| Accuracy | 0 | Too low |
| Completeness | 11 | Too high |
| Clarity | 15 | Way too high |
| Relevance | -1 | Negative |
| Actionability | 5 | Valid |
`;
    const scores = parseScores(text);
    expect(scores.accuracy).toBeNull();
    expect(scores.completeness).toBeNull();
    expect(scores.clarity).toBeNull();
    // -1 won't match \d+ so null
    expect(scores.relevance).toBeNull();
    expect(scores.actionability).toBe(5);
  });

  it("handles partial scores (some dimensions missing)", () => {
    const text = `
| Accuracy | 8 | Good |
| Clarity | 7 | OK |
`;
    const scores = parseScores(text);
    expect(scores.accuracy).toBe(8);
    expect(scores.completeness).toBeNull();
    expect(scores.clarity).toBe(7);
    expect(scores.relevance).toBeNull();
    expect(scores.actionability).toBeNull();
  });

  it("returns all nulls for empty text", () => {
    const scores = parseScores("");
    expect(scores.accuracy).toBeNull();
    expect(scores.completeness).toBeNull();
    expect(scores.clarity).toBeNull();
    expect(scores.relevance).toBeNull();
    expect(scores.actionability).toBeNull();
  });

  it("returns all nulls for text with no scores", () => {
    const scores = parseScores(
      "This is a great response with no structured scores."
    );
    expect(scores.accuracy).toBeNull();
    expect(scores.completeness).toBeNull();
    expect(scores.clarity).toBeNull();
    expect(scores.relevance).toBeNull();
    expect(scores.actionability).toBeNull();
  });

  it("prefers table format over inline format", () => {
    const text = `
Accuracy: 5
| Accuracy | 8 | Table wins |
`;
    const scores = parseScores(text);
    expect(scores.accuracy).toBe(8);
  });

  it("handles /10 suffix in inline format", () => {
    const text = `
Accuracy: 8/10
Completeness: 7/10
`;
    const scores = parseScores(text);
    expect(scores.accuracy).toBe(8);
    expect(scores.completeness).toBe(7);
  });

  it("handles bold formatting in inline", () => {
    const text = `
**Accuracy**: 8
**Completeness**: 7
`;
    const scores = parseScores(text);
    expect(scores.accuracy).toBe(8);
    expect(scores.completeness).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// parseVerdict
// ---------------------------------------------------------------------------

describe("parseVerdict", () => {
  it("parses standard VERDICT: APPROVE format", () => {
    expect(parseVerdict("VERDICT: APPROVE")).toBe("APPROVE");
  });

  it("parses standard VERDICT: REVISE format", () => {
    expect(parseVerdict("VERDICT: REVISE")).toBe("REVISE");
  });

  it("parses standard VERDICT: REJECT format", () => {
    expect(parseVerdict("VERDICT: REJECT")).toBe("REJECT");
  });

  it("is case insensitive for the primary format", () => {
    expect(parseVerdict("verdict: approve")).toBe("APPROVE");
    expect(parseVerdict("Verdict: Revise")).toBe("REVISE");
    expect(parseVerdict("VERDICT: reject")).toBe("REJECT");
  });

  it("falls back to keyword search in last 500 chars", () => {
    const text = "Some very long text..." + " ".repeat(600) + "I would APPROVE this content.";
    expect(parseVerdict(text)).toBe("APPROVE");
  });

  it("returns null when no verdict found", () => {
    expect(parseVerdict("This text has no verdict keywords at all.")).toBeNull();
  });

  it("prefers primary format over fallback", () => {
    const text =
      "VERDICT: REJECT\n\nIn summary I would say this is okay and could APPROVE it.";
    expect(parseVerdict(text)).toBe("REJECT");
  });

  it("falls back to REJECT before REVISE in the last paragraph", () => {
    // APPROVE is checked first, then REJECT, then REVISE
    const text = " ".repeat(600) + "This should be REJECT due to errors. But could REVISE too.";
    expect(parseVerdict(text)).toBe("REJECT");
  });
});

// ---------------------------------------------------------------------------
// calculateAverage
// ---------------------------------------------------------------------------

describe("calculateAverage", () => {
  it("calculates average of all non-null scores", () => {
    const scores: DimensionScores = {
      accuracy: 8,
      completeness: 7,
      clarity: 9,
      relevance: 8,
      actionability: 6,
    };
    // (8 + 7 + 9 + 8 + 6) / 5 = 7.6
    expect(calculateAverage(scores)).toBe(7.6);
  });

  it("returns null when all scores are null", () => {
    const scores: DimensionScores = {
      accuracy: null,
      completeness: null,
      clarity: null,
      relevance: null,
      actionability: null,
    };
    expect(calculateAverage(scores)).toBeNull();
  });

  it("calculates average with partial nulls", () => {
    const scores: DimensionScores = {
      accuracy: 8,
      completeness: null,
      clarity: 6,
      relevance: null,
      actionability: null,
    };
    // (8 + 6) / 2 = 7.0
    expect(calculateAverage(scores)).toBe(7);
  });

  it("rounds to 1 decimal place", () => {
    const scores: DimensionScores = {
      accuracy: 7,
      completeness: 8,
      clarity: 7,
      relevance: null,
      actionability: null,
    };
    // (7 + 8 + 7) / 3 = 7.333... → 7.3
    expect(calculateAverage(scores)).toBe(7.3);
  });
});

// ---------------------------------------------------------------------------
// calculateMajorityVerdict
// ---------------------------------------------------------------------------

describe("calculateMajorityVerdict", () => {
  it("returns clear majority winner", () => {
    const result = calculateMajorityVerdict(["APPROVE", "APPROVE", "REVISE"]);
    expect(result.verdict).toBe("APPROVE");
    expect(result.approveCount).toBe(2);
    expect(result.reviseCount).toBe(1);
    expect(result.rejectCount).toBe(0);
  });

  it("APPROVE/REJECT tie defaults to REVISE", () => {
    const result = calculateMajorityVerdict(["APPROVE", "REJECT"]);
    expect(result.verdict).toBe("REVISE");
  });

  it("APPROVE/REVISE tie defaults to REVISE", () => {
    const result = calculateMajorityVerdict(["APPROVE", "REVISE"]);
    expect(result.verdict).toBe("REVISE");
  });

  it("REVISE/REJECT tie defaults to REVISE", () => {
    const result = calculateMajorityVerdict(["REVISE", "REJECT"]);
    expect(result.verdict).toBe("REVISE");
  });

  it("three-way tie defaults to REVISE", () => {
    const result = calculateMajorityVerdict(["APPROVE", "REVISE", "REJECT"]);
    expect(result.verdict).toBe("REVISE");
    expect(result.approveCount).toBe(1);
    expect(result.reviseCount).toBe(1);
    expect(result.rejectCount).toBe(1);
  });

  it("handles all null verdicts", () => {
    const result = calculateMajorityVerdict([null, null, null]);
    expect(result.verdict).toBe("REVISE");
    expect(result.approveCount).toBe(0);
    expect(result.reviseCount).toBe(0);
    expect(result.rejectCount).toBe(0);
  });

  it("ignores null verdicts in counting", () => {
    const result = calculateMajorityVerdict(["APPROVE", null, "APPROVE"]);
    expect(result.verdict).toBe("APPROVE");
    expect(result.approveCount).toBe(2);
  });

  it("single valid verdict wins", () => {
    const result = calculateMajorityVerdict([null, "REJECT", null]);
    expect(result.verdict).toBe("REJECT");
    expect(result.rejectCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// calculateDimensionAverages
// ---------------------------------------------------------------------------

describe("calculateDimensionAverages", () => {
  it("averages scores across multiple jurors", () => {
    const assessments = [
      makeAssessment({
        scores: { accuracy: 8, completeness: 7, clarity: 9, relevance: 8, actionability: 6 },
      }),
      makeAssessment({
        scores: { accuracy: 7, completeness: 5, clarity: 7, relevance: 7, actionability: 4 },
      }),
      makeAssessment({
        scores: { accuracy: 8, completeness: 7, clarity: 9, relevance: 9, actionability: 7 },
      }),
    ];
    const avgs = calculateDimensionAverages(assessments);
    // accuracy: (8+7+8)/3 = 7.7
    expect(avgs.accuracy).toBe(7.7);
    // completeness: (7+5+7)/3 = 6.3
    expect(avgs.completeness).toBe(6.3);
    // clarity: (9+7+9)/3 = 8.3
    expect(avgs.clarity).toBe(8.3);
    // relevance: (8+7+9)/3 = 8.0
    expect(avgs.relevance).toBe(8);
    // actionability: (6+4+7)/3 = 5.7
    expect(avgs.actionability).toBe(5.7);
  });

  it("handles partial null scores by excluding them", () => {
    const assessments = [
      makeAssessment({
        scores: { accuracy: 8, completeness: null, clarity: 9, relevance: 8, actionability: 6 },
      }),
      makeAssessment({
        scores: { accuracy: 7, completeness: 5, clarity: null, relevance: 7, actionability: 4 },
      }),
    ];
    const avgs = calculateDimensionAverages(assessments);
    expect(avgs.accuracy).toBe(7.5);
    expect(avgs.completeness).toBe(5);
    expect(avgs.clarity).toBe(9);
    expect(avgs.relevance).toBe(7.5);
    expect(avgs.actionability).toBe(5);
  });

  it("returns all nulls for empty array", () => {
    const avgs = calculateDimensionAverages([]);
    expect(avgs.accuracy).toBeNull();
    expect(avgs.completeness).toBeNull();
    expect(avgs.clarity).toBeNull();
    expect(avgs.relevance).toBeNull();
    expect(avgs.actionability).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// calculateDimensionRanges
// ---------------------------------------------------------------------------

describe("calculateDimensionRanges", () => {
  it("calculates min/max per dimension", () => {
    const assessments = [
      makeAssessment({
        scores: { accuracy: 8, completeness: 7, clarity: 9, relevance: 8, actionability: 6 },
      }),
      makeAssessment({
        scores: { accuracy: 7, completeness: 5, clarity: 7, relevance: 7, actionability: 4 },
      }),
      makeAssessment({
        scores: { accuracy: 8, completeness: 7, clarity: 9, relevance: 9, actionability: 7 },
      }),
    ];
    const ranges = calculateDimensionRanges(assessments);
    expect(ranges.accuracy).toEqual({ min: 7, max: 8 });
    expect(ranges.completeness).toEqual({ min: 5, max: 7 });
    expect(ranges.clarity).toEqual({ min: 7, max: 9 });
    expect(ranges.relevance).toEqual({ min: 7, max: 9 });
    expect(ranges.actionability).toEqual({ min: 4, max: 7 });
  });

  it("handles single juror (min === max)", () => {
    const assessments = [
      makeAssessment({
        scores: { accuracy: 8, completeness: 7, clarity: 9, relevance: 8, actionability: 6 },
      }),
    ];
    const ranges = calculateDimensionRanges(assessments);
    expect(ranges.accuracy).toEqual({ min: 8, max: 8 });
    expect(ranges.completeness).toEqual({ min: 7, max: 7 });
  });

  it("handles partial nulls by excluding them", () => {
    const assessments = [
      makeAssessment({
        scores: { accuracy: 8, completeness: null, clarity: 9, relevance: 8, actionability: 6 },
      }),
      makeAssessment({
        scores: { accuracy: 7, completeness: 5, clarity: null, relevance: 7, actionability: 4 },
      }),
    ];
    const ranges = calculateDimensionRanges(assessments);
    expect(ranges.accuracy).toEqual({ min: 7, max: 8 });
    expect(ranges.completeness).toEqual({ min: 5, max: 5 });
    expect(ranges.clarity).toEqual({ min: 9, max: 9 });
  });
});

// ---------------------------------------------------------------------------
// buildJurorPrompt
// ---------------------------------------------------------------------------

describe("buildJurorPrompt", () => {
  it("includes the content under evaluation", () => {
    const prompt = buildJurorPrompt("Check this API doc.");
    expect(prompt).toContain("Check this API doc.");
    expect(prompt).toContain("CONTENT UNDER EVALUATION:");
  });

  it("includes originalQuestion when provided", () => {
    const prompt = buildJurorPrompt("The doc", "Write API documentation");
    expect(prompt).toContain("ORIGINAL QUESTION:");
    expect(prompt).toContain("Write API documentation");
  });

  it("omits originalQuestion when not provided", () => {
    const prompt = buildJurorPrompt("The doc");
    expect(prompt).not.toContain("ORIGINAL QUESTION:");
  });

  it("includes all 5 dimensions", () => {
    const prompt = buildJurorPrompt("test");
    expect(prompt).toContain("Accuracy");
    expect(prompt).toContain("Completeness");
    expect(prompt).toContain("Clarity");
    expect(prompt).toContain("Relevance");
    expect(prompt).toContain("Actionability");
  });

  it("includes verdict instructions", () => {
    const prompt = buildJurorPrompt("test");
    expect(prompt).toContain("VERDICT:");
    expect(prompt).toContain("APPROVE");
    expect(prompt).toContain("REVISE");
    expect(prompt).toContain("REJECT");
  });
});

// ---------------------------------------------------------------------------
// buildForemanPrompt
// ---------------------------------------------------------------------------

describe("buildForemanPrompt", () => {
  const jurorAssessments = [
    { model: "model-a", assessmentText: "Assessment 1..." },
    { model: "model-b", assessmentText: "Assessment 2..." },
  ];
  const voteTally = { approve: 1, revise: 1, reject: 0 };

  it("includes the content evaluated", () => {
    const prompt = buildForemanPrompt("API docs", undefined, jurorAssessments, voteTally, "REVISE");
    expect(prompt).toContain("CONTENT EVALUATED:");
    expect(prompt).toContain("API docs");
  });

  it("includes original question when provided", () => {
    const prompt = buildForemanPrompt("API docs", "Write docs", jurorAssessments, voteTally, "REVISE");
    expect(prompt).toContain("ORIGINAL QUESTION:");
    expect(prompt).toContain("Write docs");
  });

  it("includes juror assessments with model names", () => {
    const prompt = buildForemanPrompt("content", undefined, jurorAssessments, voteTally, "REVISE");
    expect(prompt).toContain("--- Juror 1 (model-a) ---");
    expect(prompt).toContain("Assessment 1...");
    expect(prompt).toContain("--- Juror 2 (model-b) ---");
    expect(prompt).toContain("Assessment 2...");
  });

  it("includes vote tally and majority verdict", () => {
    const prompt = buildForemanPrompt("content", undefined, jurorAssessments, voteTally, "REVISE");
    expect(prompt).toContain("APPROVE: 1");
    expect(prompt).toContain("REVISE: 1");
    expect(prompt).toContain("REJECT: 0");
    expect(prompt).toContain("Majority Verdict: REVISE");
  });

  it("includes format instructions for verdict report", () => {
    const prompt = buildForemanPrompt("content", undefined, jurorAssessments, voteTally, "APPROVE");
    expect(prompt).toContain("## Jury Verdict Report");
    expect(prompt).toContain("### Dimension Analysis");
    expect(prompt).toContain("### Key Strengths");
    expect(prompt).toContain("### Key Weaknesses");
    expect(prompt).toContain("### Improvement Recommendations");
    expect(prompt).toContain("### Dissenting Opinions");
  });
});

// ---------------------------------------------------------------------------
// buildJuryTitlePrompt
// ---------------------------------------------------------------------------

describe("buildJuryTitlePrompt", () => {
  it("includes the content preview", () => {
    const prompt = buildJuryTitlePrompt("API documentation review");
    expect(prompt).toContain("API documentation review");
  });

  it("instructs for a brief title", () => {
    const prompt = buildJuryTitlePrompt("test");
    expect(prompt).toContain("3-5 words");
    expect(prompt).toContain("ONLY the title");
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_JURY_CONFIG
// ---------------------------------------------------------------------------

describe("DEFAULT_JURY_CONFIG", () => {
  it("has 3 juror models", () => {
    expect(DEFAULT_JURY_CONFIG.jurorModels).toHaveLength(3);
  });

  it("has a foreman model", () => {
    expect(DEFAULT_JURY_CONFIG.foremanModel.length).toBeGreaterThan(0);
  });

  it("foreman model is not in juror models", () => {
    expect(DEFAULT_JURY_CONFIG.jurorModels).not.toContain(
      DEFAULT_JURY_CONFIG.foremanModel
    );
  });

  it("has a timeout", () => {
    expect(DEFAULT_JURY_CONFIG.timeoutMs).toBeGreaterThan(0);
  });

  it("all juror models are non-empty strings", () => {
    for (const model of DEFAULT_JURY_CONFIG.jurorModels) {
      expect(model.length).toBeGreaterThan(0);
    }
  });
});
