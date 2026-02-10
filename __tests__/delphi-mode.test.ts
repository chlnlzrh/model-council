/**
 * Tests for Delphi mode:
 * - parseClassification
 * - parseNumericEstimate
 * - parseQualitativeEstimate
 * - parseConfidence
 * - computeNumericStats
 * - computeQualitativeStats
 * - hasConverged
 * - buildClassificationPrompt
 * - buildNumericRound1Prompt
 * - buildQualitativeRound1Prompt
 * - buildNumericRoundNPrompt
 * - buildQualitativeRoundNPrompt
 * - DEFAULT_DELPHI_CONFIG
 */

import { describe, it, expect } from "vitest";
import {
  parseClassification,
  parseNumericEstimate,
  parseQualitativeEstimate,
  parseConfidence,
  computeNumericStats,
  computeQualitativeStats,
  hasConverged,
  buildClassificationPrompt,
  buildNumericRound1Prompt,
  buildQualitativeRound1Prompt,
  buildNumericRoundNPrompt,
  buildQualitativeRoundNPrompt,
  DEFAULT_DELPHI_CONFIG,
} from "@/lib/council/modes/delphi";
import type {
  DelphiNumericEstimate,
  DelphiQualitativeEstimate,
  NumericStats,
  QualitativeStats,
} from "@/lib/council/modes/delphi";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNumericEstimate(overrides: Partial<DelphiNumericEstimate> = {}): DelphiNumericEstimate {
  return {
    model: "test/model",
    estimate: 100,
    confidence: "MEDIUM",
    reasoning: "Test reasoning",
    previousEstimate: null,
    changed: false,
    responseTimeMs: 1000,
    ...overrides,
  };
}

function makeQualitativeEstimate(overrides: Partial<DelphiQualitativeEstimate> = {}): DelphiQualitativeEstimate {
  return {
    model: "test/model",
    answer: "TypeScript",
    confidence: "MEDIUM",
    reasoning: "Test reasoning",
    previousAnswer: null,
    changed: false,
    responseTimeMs: 1000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseClassification
// ---------------------------------------------------------------------------

describe("parseClassification", () => {
  it("parses numeric classification", () => {
    const text = `TYPE: NUMERIC
OPTIONS: N/A
REASONING: The question asks for a quantity estimate.`;

    const result = parseClassification(text);
    expect(result.type).toBe("numeric");
    expect(result.options).toBeNull();
    expect(result.reasoning).toContain("quantity estimate");
  });

  it("parses qualitative classification with options", () => {
    const text = `TYPE: QUALITATIVE
OPTIONS: TypeScript, Python, Go, Rust
REASONING: The question asks for a recommendation.`;

    const result = parseClassification(text);
    expect(result.type).toBe("qualitative");
    expect(result.options).toEqual(["TypeScript", "Python", "Go", "Rust"]);
    expect(result.reasoning).toContain("recommendation");
  });

  it("handles case-insensitive TYPE", () => {
    const text = `type: numeric
OPTIONS: N/A
REASONING: Number expected.`;

    const result = parseClassification(text);
    expect(result.type).toBe("numeric");
  });

  it("defaults to qualitative when TYPE is missing", () => {
    const text = `Some random text without proper format.`;
    const result = parseClassification(text);
    expect(result.type).toBe("qualitative");
  });

  it("defaults to qualitative for empty/null input", () => {
    expect(parseClassification("").type).toBe("qualitative");
    expect(parseClassification("  ").type).toBe("qualitative");
  });

  it("handles OPTIONS: N/A as null", () => {
    const text = `TYPE: NUMERIC
OPTIONS: N/A
REASONING: It's a number.`;

    const result = parseClassification(text);
    expect(result.options).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseNumericEstimate
// ---------------------------------------------------------------------------

describe("parseNumericEstimate", () => {
  it("parses standard numeric estimate", () => {
    const text = `ESTIMATE: 42000000
CONFIDENCE: HIGH
REASONING: Based on current growth trends in the software industry.`;

    const result = parseNumericEstimate(text);
    expect(result.estimate).toBe(42000000);
    expect(result.confidence).toBe("HIGH");
    expect(result.reasoning).toContain("growth trends");
  });

  it("parses estimate with commas", () => {
    const text = `ESTIMATE: 42,000,000
CONFIDENCE: MEDIUM
REASONING: Rough estimate.`;

    const result = parseNumericEstimate(text);
    expect(result.estimate).toBe(42000000);
  });

  it("parses decimal estimates", () => {
    const text = `ESTIMATE: 3.14
CONFIDENCE: HIGH
REASONING: Pi approximation.`;

    const result = parseNumericEstimate(text);
    expect(result.estimate).toBeCloseTo(3.14);
  });

  it("parses negative estimates", () => {
    const text = `ESTIMATE: -15.5
CONFIDENCE: LOW
REASONING: Negative value expected.`;

    const result = parseNumericEstimate(text);
    expect(result.estimate).toBe(-15.5);
  });

  it("falls back to number extraction when ESTIMATE: is missing", () => {
    const text = `I think the answer is approximately 50000 based on my analysis.`;
    const result = parseNumericEstimate(text);
    expect(result.estimate).toBe(50000);
  });

  it("returns null estimate for text with no numbers", () => {
    const text = `I have no idea what the number could be.`;
    const result = parseNumericEstimate(text);
    expect(result.estimate).toBeNull();
  });

  it("defaults confidence to MEDIUM when missing", () => {
    const text = `ESTIMATE: 100
REASONING: Just a guess.`;

    const result = parseNumericEstimate(text);
    expect(result.confidence).toBe("MEDIUM");
  });

  it("returns defaults for empty input", () => {
    const result = parseNumericEstimate("");
    expect(result.estimate).toBeNull();
    expect(result.confidence).toBe("MEDIUM");
    expect(result.reasoning).toBe("");
  });
});

// ---------------------------------------------------------------------------
// parseQualitativeEstimate
// ---------------------------------------------------------------------------

describe("parseQualitativeEstimate", () => {
  it("parses standard qualitative estimate", () => {
    const text = `ANSWER: TypeScript
CONFIDENCE: HIGH
REASONING: Type safety and ecosystem maturity make it ideal.`;

    const result = parseQualitativeEstimate(text);
    expect(result.answer).toBe("TypeScript");
    expect(result.confidence).toBe("HIGH");
    expect(result.reasoning).toContain("Type safety");
  });

  it("parses multi-word answer", () => {
    const text = `ANSWER: Hybrid approach with monorepo for core
CONFIDENCE: MEDIUM
REASONING: Balances both strategies.`;

    const result = parseQualitativeEstimate(text);
    expect(result.answer).toBe("Hybrid approach with monorepo for core");
  });

  it("defaults confidence to MEDIUM when missing", () => {
    const text = `ANSWER: Python
REASONING: Easy to learn.`;

    const result = parseQualitativeEstimate(text);
    expect(result.confidence).toBe("MEDIUM");
  });

  it("returns null answer for empty input", () => {
    const result = parseQualitativeEstimate("");
    expect(result.answer).toBeNull();
    expect(result.confidence).toBe("MEDIUM");
  });

  it("handles answer with trailing newlines properly", () => {
    const text = `ANSWER: Rust
CONFIDENCE: LOW
REASONING: Steep learning curve but excellent performance.`;

    const result = parseQualitativeEstimate(text);
    expect(result.answer).toBe("Rust");
  });
});

// ---------------------------------------------------------------------------
// parseConfidence
// ---------------------------------------------------------------------------

describe("parseConfidence", () => {
  it("parses HIGH", () => {
    expect(parseConfidence("HIGH")).toBe("HIGH");
  });

  it("parses LOW", () => {
    expect(parseConfidence("LOW")).toBe("LOW");
  });

  it("parses MEDIUM", () => {
    expect(parseConfidence("MEDIUM")).toBe("MEDIUM");
  });

  it("handles case insensitive input", () => {
    expect(parseConfidence("high")).toBe("HIGH");
    expect(parseConfidence("Low")).toBe("LOW");
    expect(parseConfidence("medium")).toBe("MEDIUM");
  });

  it("defaults to MEDIUM for unknown input", () => {
    expect(parseConfidence("unknown")).toBe("MEDIUM");
    expect(parseConfidence("")).toBe("MEDIUM");
  });
});

// ---------------------------------------------------------------------------
// computeNumericStats
// ---------------------------------------------------------------------------

describe("computeNumericStats", () => {
  it("computes basic statistics correctly", () => {
    const estimates = [
      makeNumericEstimate({ estimate: 10, confidence: "LOW" }),
      makeNumericEstimate({ estimate: 20, confidence: "MEDIUM" }),
      makeNumericEstimate({ estimate: 30, confidence: "HIGH" }),
      makeNumericEstimate({ estimate: 40, confidence: "HIGH" }),
    ];

    const stats = computeNumericStats(estimates);
    expect(stats.mean).toBe(25);
    expect(stats.median).toBe(25); // (20+30)/2
    expect(stats.min).toBe(10);
    expect(stats.max).toBe(40);
    expect(stats.stdDev).toBeGreaterThan(0);
    expect(stats.cv).toBeGreaterThan(0);
  });

  it("handles single value (cv should be 0)", () => {
    const estimates = [
      makeNumericEstimate({ estimate: 42 }),
    ];

    const stats = computeNumericStats(estimates);
    expect(stats.mean).toBe(42);
    expect(stats.median).toBe(42);
    expect(stats.stdDev).toBe(0);
    expect(stats.cv).toBe(0);
    expect(stats.min).toBe(42);
    expect(stats.max).toBe(42);
  });

  it("handles mean=0 edge case (cv should be 0)", () => {
    const estimates = [
      makeNumericEstimate({ estimate: -10 }),
      makeNumericEstimate({ estimate: 10 }),
    ];

    const stats = computeNumericStats(estimates);
    expect(stats.mean).toBe(0);
    expect(stats.cv).toBe(0);
  });

  it("handles identical values (cv should be 0)", () => {
    const estimates = [
      makeNumericEstimate({ estimate: 100 }),
      makeNumericEstimate({ estimate: 100 }),
      makeNumericEstimate({ estimate: 100 }),
    ];

    const stats = computeNumericStats(estimates);
    expect(stats.mean).toBe(100);
    expect(stats.stdDev).toBe(0);
    expect(stats.cv).toBe(0);
  });

  it("counts confidence levels correctly", () => {
    const estimates = [
      makeNumericEstimate({ estimate: 10, confidence: "LOW" }),
      makeNumericEstimate({ estimate: 20, confidence: "LOW" }),
      makeNumericEstimate({ estimate: 30, confidence: "MEDIUM" }),
      makeNumericEstimate({ estimate: 40, confidence: "HIGH" }),
    ];

    const stats = computeNumericStats(estimates);
    expect(stats.confidenceCounts).toEqual({ low: 2, medium: 1, high: 1 });
  });

  it("computes correct median for 2 estimates", () => {
    const estimates = [
      makeNumericEstimate({ estimate: 10 }),
      makeNumericEstimate({ estimate: 30 }),
    ];

    const stats = computeNumericStats(estimates);
    expect(stats.median).toBe(20);
  });

  it("computes correct median for odd count", () => {
    const estimates = [
      makeNumericEstimate({ estimate: 10 }),
      makeNumericEstimate({ estimate: 20 }),
      makeNumericEstimate({ estimate: 30 }),
    ];

    const stats = computeNumericStats(estimates);
    expect(stats.median).toBe(20);
  });

  it("handles large spread", () => {
    const estimates = [
      makeNumericEstimate({ estimate: 1 }),
      makeNumericEstimate({ estimate: 1000000 }),
    ];

    const stats = computeNumericStats(estimates);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(1000000);
    expect(stats.cv).toBeGreaterThan(0.9);
  });
});

// ---------------------------------------------------------------------------
// computeQualitativeStats
// ---------------------------------------------------------------------------

describe("computeQualitativeStats", () => {
  it("handles unanimous agreement", () => {
    const estimates = [
      makeQualitativeEstimate({ answer: "TypeScript" }),
      makeQualitativeEstimate({ answer: "TypeScript" }),
      makeQualitativeEstimate({ answer: "TypeScript" }),
    ];

    const stats = computeQualitativeStats(estimates);
    expect(stats.agreementPercentage).toBe(100);
    expect(stats.mode).toBe("TypeScript");
    expect(stats.distribution).toHaveLength(1);
    expect(stats.distribution[0]).toEqual({
      answer: "TypeScript",
      count: 3,
      percentage: 100,
    });
  });

  it("handles split vote", () => {
    const estimates = [
      makeQualitativeEstimate({ answer: "TypeScript" }),
      makeQualitativeEstimate({ answer: "TypeScript" }),
      makeQualitativeEstimate({ answer: "Python" }),
      makeQualitativeEstimate({ answer: "Python" }),
    ];

    const stats = computeQualitativeStats(estimates);
    expect(stats.agreementPercentage).toBe(50);
    expect(stats.distribution).toHaveLength(2);
  });

  it("handles three-way split", () => {
    const estimates = [
      makeQualitativeEstimate({ answer: "TypeScript" }),
      makeQualitativeEstimate({ answer: "Python" }),
      makeQualitativeEstimate({ answer: "Go" }),
    ];

    const stats = computeQualitativeStats(estimates);
    expect(stats.agreementPercentage).toBe(33);
    expect(stats.distribution).toHaveLength(3);
  });

  it("handles single model", () => {
    const estimates = [
      makeQualitativeEstimate({ answer: "Rust" }),
    ];

    const stats = computeQualitativeStats(estimates);
    expect(stats.agreementPercentage).toBe(100);
    expect(stats.mode).toBe("Rust");
  });

  it("counts confidence levels correctly", () => {
    const estimates = [
      makeQualitativeEstimate({ answer: "A", confidence: "HIGH" }),
      makeQualitativeEstimate({ answer: "A", confidence: "HIGH" }),
      makeQualitativeEstimate({ answer: "B", confidence: "LOW" }),
    ];

    const stats = computeQualitativeStats(estimates);
    expect(stats.confidenceCounts).toEqual({ low: 1, medium: 0, high: 2 });
  });

  it("sorts distribution by count descending", () => {
    const estimates = [
      makeQualitativeEstimate({ answer: "C" }),
      makeQualitativeEstimate({ answer: "A" }),
      makeQualitativeEstimate({ answer: "A" }),
      makeQualitativeEstimate({ answer: "A" }),
      makeQualitativeEstimate({ answer: "B" }),
      makeQualitativeEstimate({ answer: "B" }),
    ];

    const stats = computeQualitativeStats(estimates);
    expect(stats.distribution[0].answer).toBe("A");
    expect(stats.distribution[0].count).toBe(3);
    expect(stats.distribution[1].answer).toBe("B");
    expect(stats.distribution[1].count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// hasConverged
// ---------------------------------------------------------------------------

describe("hasConverged", () => {
  const config = { ...DEFAULT_DELPHI_CONFIG };

  it("returns true for numeric when CV < threshold", () => {
    const stats: NumericStats = {
      mean: 100,
      median: 100,
      stdDev: 10,
      min: 90,
      max: 110,
      cv: 0.10,
      confidenceCounts: { low: 0, medium: 2, high: 2 },
    };
    expect(hasConverged(stats, "numeric", config)).toBe(true);
  });

  it("returns false for numeric when CV >= threshold", () => {
    const stats: NumericStats = {
      mean: 100,
      median: 100,
      stdDev: 50,
      min: 50,
      max: 150,
      cv: 0.50,
      confidenceCounts: { low: 1, medium: 1, high: 2 },
    };
    expect(hasConverged(stats, "numeric", config)).toBe(false);
  });

  it("returns true for qualitative when agreement >= threshold", () => {
    const stats: QualitativeStats = {
      distribution: [{ answer: "A", count: 3, percentage: 75 }],
      agreementPercentage: 75,
      mode: "A",
      confidenceCounts: { low: 0, medium: 1, high: 3 },
    };
    expect(hasConverged(stats, "qualitative", config)).toBe(true);
  });

  it("returns false for qualitative when agreement < threshold", () => {
    const stats: QualitativeStats = {
      distribution: [
        { answer: "A", count: 2, percentage: 50 },
        { answer: "B", count: 2, percentage: 50 },
      ],
      agreementPercentage: 50,
      mode: "A",
      confidenceCounts: { low: 0, medium: 4, high: 0 },
    };
    expect(hasConverged(stats, "qualitative", config)).toBe(false);
  });

  it("handles exact numeric threshold (CV = 0.15 is NOT converged)", () => {
    const stats: NumericStats = {
      mean: 100,
      median: 100,
      stdDev: 15,
      min: 85,
      max: 115,
      cv: 0.15,
      confidenceCounts: { low: 0, medium: 4, high: 0 },
    };
    // cv < threshold, 0.15 is NOT less than 0.15
    expect(hasConverged(stats, "numeric", config)).toBe(false);
  });

  it("handles exact qualitative threshold (75% IS converged)", () => {
    const stats: QualitativeStats = {
      distribution: [{ answer: "A", count: 3, percentage: 75 }],
      agreementPercentage: 75,
      mode: "A",
      confidenceCounts: { low: 0, medium: 0, high: 3 },
    };
    // agreement >= threshold, 75 >= 75
    expect(hasConverged(stats, "qualitative", config)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildClassificationPrompt
// ---------------------------------------------------------------------------

describe("buildClassificationPrompt", () => {
  it("includes the user query", () => {
    const prompt = buildClassificationPrompt("How many people live on Earth?");
    expect(prompt).toContain("How many people live on Earth?");
  });

  it("includes TYPE and OPTIONS format instructions", () => {
    const prompt = buildClassificationPrompt("Test question");
    expect(prompt).toContain("TYPE:");
    expect(prompt).toContain("OPTIONS:");
    expect(prompt).toContain("REASONING:");
    expect(prompt).toContain("NUMERIC");
    expect(prompt).toContain("QUALITATIVE");
  });
});

// ---------------------------------------------------------------------------
// buildNumericRound1Prompt
// ---------------------------------------------------------------------------

describe("buildNumericRound1Prompt", () => {
  it("includes the user query", () => {
    const prompt = buildNumericRound1Prompt("How many stars in the galaxy?");
    expect(prompt).toContain("How many stars in the galaxy?");
  });

  it("includes ESTIMATE format instruction", () => {
    const prompt = buildNumericRound1Prompt("Test");
    expect(prompt).toContain("ESTIMATE:");
  });

  it("includes CONFIDENCE format instruction", () => {
    const prompt = buildNumericRound1Prompt("Test");
    expect(prompt).toContain("CONFIDENCE:");
    expect(prompt).toContain("LOW");
    expect(prompt).toContain("MEDIUM");
    expect(prompt).toContain("HIGH");
  });
});

// ---------------------------------------------------------------------------
// buildQualitativeRound1Prompt
// ---------------------------------------------------------------------------

describe("buildQualitativeRound1Prompt", () => {
  it("includes the user query", () => {
    const prompt = buildQualitativeRound1Prompt("Best language?", null);
    expect(prompt).toContain("Best language?");
  });

  it("includes options when provided", () => {
    const prompt = buildQualitativeRound1Prompt("Best language?", [
      "TypeScript",
      "Python",
      "Go",
    ]);
    expect(prompt).toContain("1. TypeScript");
    expect(prompt).toContain("2. Python");
    expect(prompt).toContain("3. Go");
  });

  it("includes ANSWER format instruction", () => {
    const prompt = buildQualitativeRound1Prompt("Test", null);
    expect(prompt).toContain("ANSWER:");
  });
});

// ---------------------------------------------------------------------------
// buildNumericRoundNPrompt
// ---------------------------------------------------------------------------

describe("buildNumericRoundNPrompt", () => {
  const stats: NumericStats = {
    mean: 100,
    median: 95,
    stdDev: 15,
    min: 80,
    max: 120,
    cv: 0.15,
    confidenceCounts: { low: 1, medium: 2, high: 1 },
  };

  it("includes aggregate stats", () => {
    const prompt = buildNumericRoundNPrompt({
      userQuery: "Test",
      round: 2,
      maxRounds: 5,
      prevEstimate: 110,
      prevConfidence: "MEDIUM",
      stats,
      participantCount: 4,
    });
    expect(prompt).toContain("Mean:");
    expect(prompt).toContain("Median:");
    expect(prompt).toContain("Standard Deviation:");
    expect(prompt).toContain("Coefficient of Variation:");
  });

  it("includes previous estimate", () => {
    const prompt = buildNumericRoundNPrompt({
      userQuery: "Test",
      round: 2,
      maxRounds: 5,
      prevEstimate: 110,
      prevConfidence: "HIGH",
      stats,
      participantCount: 4,
    });
    expect(prompt).toContain("YOUR PREVIOUS ESTIMATE: 110");
    expect(prompt).toContain("YOUR PREVIOUS CONFIDENCE: HIGH");
  });

  it("includes round number and max rounds", () => {
    const prompt = buildNumericRoundNPrompt({
      userQuery: "Test",
      round: 3,
      maxRounds: 5,
      prevEstimate: 100,
      prevConfidence: "MEDIUM",
      stats,
      participantCount: 4,
    });
    expect(prompt).toContain("DELPHI ROUND 3 of 5");
  });

  it("includes participant count", () => {
    const prompt = buildNumericRoundNPrompt({
      userQuery: "Test",
      round: 2,
      maxRounds: 5,
      prevEstimate: 100,
      prevConfidence: "MEDIUM",
      stats,
      participantCount: 4,
    });
    expect(prompt).toContain("ALL 4 PARTICIPANTS");
  });
});

// ---------------------------------------------------------------------------
// buildQualitativeRoundNPrompt
// ---------------------------------------------------------------------------

describe("buildQualitativeRoundNPrompt", () => {
  const stats: QualitativeStats = {
    distribution: [
      { answer: "TypeScript", count: 3, percentage: 75 },
      { answer: "Python", count: 1, percentage: 25 },
    ],
    agreementPercentage: 75,
    mode: "TypeScript",
    confidenceCounts: { low: 0, medium: 1, high: 3 },
  };

  it("includes distribution", () => {
    const prompt = buildQualitativeRoundNPrompt({
      userQuery: "Test",
      round: 2,
      maxRounds: 5,
      prevAnswer: "Python",
      prevConfidence: "MEDIUM",
      stats,
      participantCount: 4,
    });
    expect(prompt).toContain("TypeScript: 3 participants (75%)");
    expect(prompt).toContain("Python: 1 participants (25%)");
  });

  it("includes previous answer", () => {
    const prompt = buildQualitativeRoundNPrompt({
      userQuery: "Test",
      round: 2,
      maxRounds: 5,
      prevAnswer: "Python",
      prevConfidence: "HIGH",
      stats,
      participantCount: 4,
    });
    expect(prompt).toContain("YOUR PREVIOUS ANSWER: Python");
    expect(prompt).toContain("YOUR PREVIOUS CONFIDENCE: HIGH");
  });

  it("includes agreement percentage", () => {
    const prompt = buildQualitativeRoundNPrompt({
      userQuery: "Test",
      round: 2,
      maxRounds: 5,
      prevAnswer: "Python",
      prevConfidence: "MEDIUM",
      stats,
      participantCount: 4,
    });
    expect(prompt).toContain("Agreement Level: 75%");
  });

  it("includes round info and participant count", () => {
    const prompt = buildQualitativeRoundNPrompt({
      userQuery: "Test",
      round: 3,
      maxRounds: 4,
      prevAnswer: "Go",
      prevConfidence: "LOW",
      stats,
      participantCount: 5,
    });
    expect(prompt).toContain("DELPHI ROUND 3 of 4");
    expect(prompt).toContain("ALL 5 PARTICIPANTS");
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_DELPHI_CONFIG
// ---------------------------------------------------------------------------

describe("DEFAULT_DELPHI_CONFIG", () => {
  it("has panelist models", () => {
    expect(DEFAULT_DELPHI_CONFIG.panelistModels.length).toBeGreaterThanOrEqual(3);
  });

  it("has at least 3 panelists", () => {
    expect(DEFAULT_DELPHI_CONFIG.panelistModels.length).toBeGreaterThanOrEqual(3);
  });

  it("has a facilitator model", () => {
    expect(DEFAULT_DELPHI_CONFIG.facilitatorModel).toBeTruthy();
  });

  it("facilitator is not in panelist list", () => {
    expect(
      DEFAULT_DELPHI_CONFIG.panelistModels.includes(
        DEFAULT_DELPHI_CONFIG.facilitatorModel
      )
    ).toBe(false);
  });

  it("has valid timeout", () => {
    expect(DEFAULT_DELPHI_CONFIG.timeoutMs).toBeGreaterThan(0);
  });

  it("has valid maxRounds between 2 and 5", () => {
    expect(DEFAULT_DELPHI_CONFIG.maxRounds).toBeGreaterThanOrEqual(2);
    expect(DEFAULT_DELPHI_CONFIG.maxRounds).toBeLessThanOrEqual(5);
  });

  it("has valid convergence thresholds", () => {
    expect(DEFAULT_DELPHI_CONFIG.numericConvergenceThreshold).toBeGreaterThan(0);
    expect(DEFAULT_DELPHI_CONFIG.numericConvergenceThreshold).toBeLessThanOrEqual(1);
    expect(DEFAULT_DELPHI_CONFIG.qualitativeConvergenceThreshold).toBeGreaterThanOrEqual(50);
    expect(DEFAULT_DELPHI_CONFIG.qualitativeConvergenceThreshold).toBeLessThanOrEqual(100);
  });
});
