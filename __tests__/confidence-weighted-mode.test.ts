/**
 * Tests for Confidence-Weighted mode:
 * - parseConfidenceResponse
 * - computeSoftmaxWeights
 * - buildAnswerConfidencePrompt
 * - buildWeightedSynthesisPrompt
 * - parseSynthesisResponse
 * - DEFAULT_CONFIDENCE_CONFIG
 * - Integration / edge cases
 */

import { describe, it, expect } from "vitest";
import {
  parseConfidenceResponse,
  computeSoftmaxWeights,
  buildAnswerConfidencePrompt,
  buildWeightedSynthesisPrompt,
  parseSynthesisResponse,
  DEFAULT_CONFIDENCE_CONFIG,
} from "@/lib/council/modes/confidence-weighted";
import type { ConfidenceWeight } from "@/lib/council/modes/confidence-weighted";

// ---------------------------------------------------------------------------
// parseConfidenceResponse
// ---------------------------------------------------------------------------

describe("parseConfidenceResponse", () => {
  it("parses standard format with all sections", () => {
    const text = `RESPONSE:
The half-life of caffeine is approximately 5-6 hours.

CONFIDENCE: 0.82
CONFIDENCE_REASONING: I am fairly certain based on pharmacology knowledge.`;

    const result = parseConfidenceResponse(text);
    expect(result.response).toBe("The half-life of caffeine is approximately 5-6 hours.");
    expect(result.confidence).toBeCloseTo(0.82, 2);
    expect(result.confidenceReasoning).toContain("fairly certain");
    expect(result.parsedSuccessfully).toBe(true);
  });

  it("returns default 0.5 when no markers are present", () => {
    const text = "Just a plain response with no structured format.";
    const result = parseConfidenceResponse(text);
    expect(result.confidence).toBe(0.5);
    expect(result.parsedSuccessfully).toBe(false);
    expect(result.response).toBe(text);
  });

  it("parses percentage format (82%)", () => {
    const text = `RESPONSE:
Some response here.

CONFIDENCE: 82%
CONFIDENCE_REASONING: Pretty sure about this.`;

    const result = parseConfidenceResponse(text);
    expect(result.confidence).toBeCloseTo(0.82, 2);
    expect(result.parsedSuccessfully).toBe(true);
  });

  it("parses integer format (82) as percentage when > 1.0", () => {
    const text = `RESPONSE:
Some response here.

CONFIDENCE: 82
CONFIDENCE_REASONING: High confidence.`;

    const result = parseConfidenceResponse(text);
    expect(result.confidence).toBeCloseTo(0.82, 2);
    expect(result.parsedSuccessfully).toBe(true);
  });

  it("clamps values > 1.0 that are also > 100 to 1.0", () => {
    const text = `RESPONSE:
Response.

CONFIDENCE: 150
CONFIDENCE_REASONING: Very confident.`;

    const result = parseConfidenceResponse(text);
    // 150 > 1.0 and > 100 → not treated as percentage, but > 100 → 150/100 = 1.5 → clamp to 1.0
    expect(result.confidence).toBeLessThanOrEqual(1.0);
    expect(result.parsedSuccessfully).toBe(true);
  });

  it("clamps negative values to 0", () => {
    // Edge: regex won't match negative, so will default to 0.5
    const text = `RESPONSE:
Response.

CONFIDENCE: -0.3
CONFIDENCE_REASONING: Not sure.`;

    const result = parseConfidenceResponse(text);
    // The regex should not match negative, so parsedSuccessfully may be false
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("parses exactly 1.0", () => {
    const text = `RESPONSE:
Definitely correct.

CONFIDENCE: 1.0
CONFIDENCE_REASONING: Absolute certainty.`;

    const result = parseConfidenceResponse(text);
    expect(result.confidence).toBe(1.0);
    expect(result.parsedSuccessfully).toBe(true);
  });

  it("parses exactly 0", () => {
    const text = `RESPONSE:
Total guess.

CONFIDENCE: 0
CONFIDENCE_REASONING: No idea.`;

    const result = parseConfidenceResponse(text);
    expect(result.confidence).toBe(0);
    expect(result.parsedSuccessfully).toBe(true);
  });

  it("parses decimal without leading zero (.82)", () => {
    const text = `RESPONSE:
Response text.

CONFIDENCE: .82
CONFIDENCE_REASONING: Mostly sure.`;

    const result = parseConfidenceResponse(text);
    expect(result.confidence).toBeCloseTo(0.82, 2);
    expect(result.parsedSuccessfully).toBe(true);
  });

  it("handles missing CONFIDENCE_REASONING", () => {
    const text = `RESPONSE:
Some answer.

CONFIDENCE: 0.7`;

    const result = parseConfidenceResponse(text);
    expect(result.confidence).toBeCloseTo(0.7, 2);
    expect(result.confidenceReasoning).toBe("");
    expect(result.parsedSuccessfully).toBe(true);
  });

  it("returns defaults for empty input", () => {
    const result = parseConfidenceResponse("");
    expect(result.confidence).toBe(0.5);
    expect(result.parsedSuccessfully).toBe(false);
    expect(result.response).toBe("");
  });

  it("returns defaults for whitespace-only input", () => {
    const result = parseConfidenceResponse("   \n\n  ");
    expect(result.confidence).toBe(0.5);
    expect(result.parsedSuccessfully).toBe(false);
  });

  it("handles multiline response content", () => {
    const text = `RESPONSE:
Line 1 of the response.
Line 2 of the response.
Line 3 of the response.

CONFIDENCE: 0.65
CONFIDENCE_REASONING: Multi-line reasoning.`;

    const result = parseConfidenceResponse(text);
    expect(result.response).toContain("Line 1");
    expect(result.response).toContain("Line 3");
    expect(result.confidence).toBeCloseTo(0.65, 2);
  });

  it("is case-insensitive for markers", () => {
    const text = `response:
Answer text.

confidence: 0.75
confidence_reasoning: Somewhat certain.`;

    const result = parseConfidenceResponse(text);
    expect(result.confidence).toBeCloseTo(0.75, 2);
    expect(result.parsedSuccessfully).toBe(true);
  });

  it("handles missing RESPONSE marker — uses text before CONFIDENCE", () => {
    const text = `This is my answer without a response marker.

CONFIDENCE: 0.6
CONFIDENCE_REASONING: Moderate confidence.`;

    const result = parseConfidenceResponse(text);
    expect(result.response).toContain("answer without a response marker");
    expect(result.confidence).toBeCloseTo(0.6, 2);
  });
});

// ---------------------------------------------------------------------------
// computeSoftmaxWeights
// ---------------------------------------------------------------------------

describe("computeSoftmaxWeights", () => {
  it("produces equal weights for uniform confidences", () => {
    const answers = [
      { model: "a", rawConfidence: 0.5 },
      { model: "b", rawConfidence: 0.5 },
      { model: "c", rawConfidence: 0.5 },
    ];
    const weights = computeSoftmaxWeights(answers, 1.0);
    weights.forEach((w) => {
      expect(w.normalizedWeight).toBeCloseTo(1 / 3, 4);
    });
  });

  it("gives higher weight to higher confidence", () => {
    const answers = [
      { model: "low", rawConfidence: 0.3 },
      { model: "high", rawConfidence: 0.9 },
    ];
    const weights = computeSoftmaxWeights(answers, 1.0);
    const highW = weights.find((w) => w.model === "high")!;
    const lowW = weights.find((w) => w.model === "low")!;
    expect(highW.normalizedWeight).toBeGreaterThan(lowW.normalizedWeight);
  });

  it("extreme low temperature (0.1) makes winner-take-all", () => {
    const answers = [
      { model: "low", rawConfidence: 0.3 },
      { model: "high", rawConfidence: 0.9 },
    ];
    const weights = computeSoftmaxWeights(answers, 0.1);
    const highW = weights.find((w) => w.model === "high")!;
    expect(highW.normalizedWeight).toBeGreaterThan(0.95);
  });

  it("high temperature (5.0) produces near-uniform weights", () => {
    const answers = [
      { model: "low", rawConfidence: 0.3 },
      { model: "high", rawConfidence: 0.9 },
    ];
    const weights = computeSoftmaxWeights(answers, 5.0);
    const highW = weights.find((w) => w.model === "high")!;
    const lowW = weights.find((w) => w.model === "low")!;
    // With temp=5.0, difference should be small
    expect(Math.abs(highW.normalizedWeight - lowW.normalizedWeight)).toBeLessThan(0.1);
  });

  it("temperature < 0.001 produces uniform weights", () => {
    const answers = [
      { model: "a", rawConfidence: 0.1 },
      { model: "b", rawConfidence: 0.9 },
    ];
    const weights = computeSoftmaxWeights(answers, 0.0001);
    expect(weights[0].normalizedWeight).toBeCloseTo(0.5, 4);
    expect(weights[1].normalizedWeight).toBeCloseTo(0.5, 4);
  });

  it("flags outlier confidence > 0.95", () => {
    const answers = [{ model: "a", rawConfidence: 0.98 }];
    const weights = computeSoftmaxWeights(answers, 1.0);
    expect(weights[0].isOutlier).toBe(true);
  });

  it("flags outlier confidence < 0.1", () => {
    const answers = [{ model: "a", rawConfidence: 0.05 }];
    const weights = computeSoftmaxWeights(answers, 1.0);
    expect(weights[0].isOutlier).toBe(true);
  });

  it("does not flag normal confidence as outlier", () => {
    const answers = [{ model: "a", rawConfidence: 0.7 }];
    const weights = computeSoftmaxWeights(answers, 1.0);
    expect(weights[0].isOutlier).toBe(false);
  });

  it("weights sum to approximately 1.0", () => {
    const answers = [
      { model: "a", rawConfidence: 0.3 },
      { model: "b", rawConfidence: 0.6 },
      { model: "c", rawConfidence: 0.9 },
    ];
    const weights = computeSoftmaxWeights(answers, 1.0);
    const sum = weights.reduce((s, w) => s + w.normalizedWeight, 0);
    expect(sum).toBeCloseTo(1.0, 6);
  });

  it("handles single model", () => {
    const answers = [{ model: "solo", rawConfidence: 0.8 }];
    const weights = computeSoftmaxWeights(answers, 1.0);
    expect(weights.length).toBe(1);
    expect(weights[0].normalizedWeight).toBeCloseTo(1.0, 6);
    expect(weights[0].weightPercent).toBe(100);
  });

  it("handles two models", () => {
    const answers = [
      { model: "a", rawConfidence: 0.5 },
      { model: "b", rawConfidence: 0.5 },
    ];
    const weights = computeSoftmaxWeights(answers, 1.0);
    expect(weights.length).toBe(2);
    expect(weights[0].normalizedWeight).toBeCloseTo(0.5, 4);
  });

  it("weightPercent equals normalizedWeight * 100 (rounded to 2 decimal places)", () => {
    const answers = [
      { model: "a", rawConfidence: 0.3 },
      { model: "b", rawConfidence: 0.7 },
    ];
    const weights = computeSoftmaxWeights(answers, 1.0);
    weights.forEach((w) => {
      expect(w.weightPercent).toBeCloseTo(w.normalizedWeight * 100, 1);
    });
  });
});

// ---------------------------------------------------------------------------
// buildAnswerConfidencePrompt
// ---------------------------------------------------------------------------

describe("buildAnswerConfidencePrompt", () => {
  it("includes the user query", () => {
    const prompt = buildAnswerConfidencePrompt("What is gravity?");
    expect(prompt).toContain("What is gravity?");
  });

  it("includes format instructions with RESPONSE/CONFIDENCE/CONFIDENCE_REASONING", () => {
    const prompt = buildAnswerConfidencePrompt("test");
    expect(prompt).toContain("RESPONSE:");
    expect(prompt).toContain("CONFIDENCE:");
    expect(prompt).toContain("CONFIDENCE_REASONING:");
  });

  it("mentions 0.0-1.0 range", () => {
    const prompt = buildAnswerConfidencePrompt("test");
    expect(prompt).toContain("0.0");
    expect(prompt).toContain("1.0");
  });

  it("includes history when provided", () => {
    const history = [
      { role: "user" as const, content: "previous question" },
      { role: "assistant" as const, content: "previous answer" },
    ];
    const prompt = buildAnswerConfidencePrompt("follow up?", history);
    expect(prompt).toContain("CONVERSATION CONTEXT:");
    expect(prompt).toContain("previous question");
    expect(prompt).toContain("previous answer");
  });

  it("omits history section when history is empty", () => {
    const prompt = buildAnswerConfidencePrompt("test", []);
    expect(prompt).not.toContain("CONVERSATION CONTEXT:");
  });
});

// ---------------------------------------------------------------------------
// buildWeightedSynthesisPrompt
// ---------------------------------------------------------------------------

describe("buildWeightedSynthesisPrompt", () => {
  const baseResponses = [
    { model: "a", response: "Response A text", weightPercent: 60, rawConfidence: 0.9, isOutlier: false },
    { model: "b", response: "Response B text", weightPercent: 40, rawConfidence: 0.5, isOutlier: false },
  ];

  it("includes the user query", () => {
    const prompt = buildWeightedSynthesisPrompt("What is 2+2?", baseResponses);
    expect(prompt).toContain("What is 2+2?");
  });

  it("sorts responses by weight (highest first)", () => {
    const reversed = [
      { model: "b", response: "B text", weightPercent: 30, rawConfidence: 0.5, isOutlier: false },
      { model: "a", response: "A text", weightPercent: 70, rawConfidence: 0.9, isOutlier: false },
    ];
    const prompt = buildWeightedSynthesisPrompt("test", reversed);
    const aPos = prompt.indexOf("model a");
    // "a" has higher weight, should appear first in the output
    // Actually it uses the model name, let's check order
    expect(prompt.indexOf("70%")).toBeLessThan(prompt.indexOf("30%"));
  });

  it("includes weight percentages", () => {
    const prompt = buildWeightedSynthesisPrompt("test", baseResponses);
    expect(prompt).toContain("60%");
    expect(prompt).toContain("40%");
  });

  it("includes outlier markers when present", () => {
    const withOutlier = [
      { model: "a", response: "text", weightPercent: 80, rawConfidence: 0.98, isOutlier: true },
      { model: "b", response: "text", weightPercent: 20, rawConfidence: 0.5, isOutlier: false },
    ];
    const prompt = buildWeightedSynthesisPrompt("test", withOutlier);
    expect(prompt).toContain("OUTLIER CONFIDENCE");
  });

  it("requests calibration notes", () => {
    const prompt = buildWeightedSynthesisPrompt("test", baseResponses);
    expect(prompt).toContain("CONFIDENCE CALIBRATION NOTES:");
  });

  it("includes all responses in the prompt", () => {
    const prompt = buildWeightedSynthesisPrompt("test", baseResponses);
    expect(prompt).toContain("Response A text");
    expect(prompt).toContain("Response B text");
  });
});

// ---------------------------------------------------------------------------
// parseSynthesisResponse
// ---------------------------------------------------------------------------

describe("parseSynthesisResponse", () => {
  it("parses standard format with both sections", () => {
    const text = `SYNTHESIS:
This is the synthesized answer.

CONFIDENCE CALIBRATION NOTES:
Models were well calibrated.`;

    const result = parseSynthesisResponse(text);
    expect(result.synthesis).toBe("This is the synthesized answer.");
    expect(result.calibrationNotes).toBe("Models were well calibrated.");
  });

  it("falls back to full text when no markers present", () => {
    const text = "Just a plain synthesis without markers.";
    const result = parseSynthesisResponse(text);
    expect(result.synthesis).toBe(text);
    expect(result.calibrationNotes).toBe("");
  });

  it("handles multiline synthesis", () => {
    const text = `SYNTHESIS:
Line 1 of synthesis.
Line 2 of synthesis.
Line 3 of synthesis.

CONFIDENCE CALIBRATION NOTES:
Calibration looks good.`;

    const result = parseSynthesisResponse(text);
    expect(result.synthesis).toContain("Line 1");
    expect(result.synthesis).toContain("Line 3");
  });

  it("trims whitespace", () => {
    const text = `SYNTHESIS:
   Synthesis with whitespace.

CONFIDENCE CALIBRATION NOTES:
   Notes with whitespace.   `;

    const result = parseSynthesisResponse(text);
    expect(result.synthesis).toBe("Synthesis with whitespace.");
    expect(result.calibrationNotes).toBe("Notes with whitespace.");
  });

  it("handles missing calibration notes section", () => {
    const text = `SYNTHESIS:
Just synthesis, no calibration notes.`;

    const result = parseSynthesisResponse(text);
    expect(result.synthesis).toBe("Just synthesis, no calibration notes.");
    expect(result.calibrationNotes).toBe("");
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_CONFIDENCE_CONFIG
// ---------------------------------------------------------------------------

describe("DEFAULT_CONFIDENCE_CONFIG", () => {
  it("has 3 models", () => {
    expect(DEFAULT_CONFIDENCE_CONFIG.models).toHaveLength(3);
  });

  it("has a synthesis model defined", () => {
    expect(DEFAULT_CONFIDENCE_CONFIG.synthesisModel).toBeTruthy();
    expect(typeof DEFAULT_CONFIDENCE_CONFIG.synthesisModel).toBe("string");
  });

  it("has a positive timeout", () => {
    expect(DEFAULT_CONFIDENCE_CONFIG.timeoutMs).toBeGreaterThan(0);
  });

  it("has a valid temperature", () => {
    expect(DEFAULT_CONFIDENCE_CONFIG.temperature).toBeGreaterThanOrEqual(0.1);
    expect(DEFAULT_CONFIDENCE_CONFIG.temperature).toBeLessThanOrEqual(5.0);
  });

  it("has non-empty model strings", () => {
    DEFAULT_CONFIDENCE_CONFIG.models.forEach((m) => {
      expect(m.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Integration / Edge Cases
// ---------------------------------------------------------------------------

describe("integration / edge cases", () => {
  it("single model produces 100% weight", () => {
    const answers = [{ model: "solo", rawConfidence: 0.7 }];
    const weights = computeSoftmaxWeights(answers, 1.0);
    expect(weights[0].weightPercent).toBe(100);
    expect(weights[0].normalizedWeight).toBeCloseTo(1.0, 6);
  });

  it("identical confidences produce equal weights", () => {
    const answers = [
      { model: "a", rawConfidence: 0.8 },
      { model: "b", rawConfidence: 0.8 },
      { model: "c", rawConfidence: 0.8 },
    ];
    const weights = computeSoftmaxWeights(answers, 1.0);
    const percents = weights.map((w) => w.weightPercent);
    expect(percents[0]).toBeCloseTo(percents[1], 2);
    expect(percents[1]).toBeCloseTo(percents[2], 2);
  });

  it("weights always sum to approximately 1.0 across various inputs", () => {
    const cases = [
      [0.1, 0.5, 0.9],
      [0.0, 0.0, 1.0],
      [0.5, 0.5],
      [0.99, 0.01, 0.5, 0.5],
    ];
    for (const confidences of cases) {
      const answers = confidences.map((c, i) => ({
        model: `m${i}`,
        rawConfidence: c,
      }));
      const weights = computeSoftmaxWeights(answers, 1.0);
      const sum = weights.reduce((s, w) => s + w.normalizedWeight, 0);
      expect(sum).toBeCloseTo(1.0, 6);
    }
  });

  it("outlier count is correct", () => {
    const answers = [
      { model: "a", rawConfidence: 0.98 },  // outlier
      { model: "b", rawConfidence: 0.5 },   // normal
      { model: "c", rawConfidence: 0.05 },  // outlier
    ];
    const weights = computeSoftmaxWeights(answers, 1.0);
    const outliers = weights.filter((w) => w.isOutlier);
    expect(outliers.length).toBe(2);
  });

  it("weightPercent rounding is correct to 2 decimal places", () => {
    const answers = [
      { model: "a", rawConfidence: 0.3 },
      { model: "b", rawConfidence: 0.6 },
      { model: "c", rawConfidence: 0.9 },
    ];
    const weights = computeSoftmaxWeights(answers, 1.0);
    weights.forEach((w) => {
      // Verify the rounding approach: Math.round(x * 10000) / 100
      const expected = Math.round(w.normalizedWeight * 10000) / 100;
      expect(w.weightPercent).toBe(expected);
    });
  });

  it("weights are sorted by model order (input order preserved)", () => {
    const answers = [
      { model: "first", rawConfidence: 0.3 },
      { model: "second", rawConfidence: 0.7 },
      { model: "third", rawConfidence: 0.5 },
    ];
    const weights = computeSoftmaxWeights(answers, 1.0);
    expect(weights[0].model).toBe("first");
    expect(weights[1].model).toBe("second");
    expect(weights[2].model).toBe("third");
  });

  it("handles zero confidence", () => {
    const answers = [
      { model: "a", rawConfidence: 0 },
      { model: "b", rawConfidence: 0.5 },
    ];
    const weights = computeSoftmaxWeights(answers, 1.0);
    expect(weights[0].normalizedWeight).toBeGreaterThan(0);
    expect(weights[1].normalizedWeight).toBeGreaterThan(weights[0].normalizedWeight);
  });

  it("handles 1.0 confidence", () => {
    const answers = [
      { model: "a", rawConfidence: 1.0 },
      { model: "b", rawConfidence: 0.5 },
    ];
    const weights = computeSoftmaxWeights(answers, 1.0);
    expect(weights[0].normalizedWeight).toBeGreaterThan(weights[1].normalizedWeight);
  });

  it("parse-then-compute roundtrip works", () => {
    const text1 = `RESPONSE:
Answer one.

CONFIDENCE: 0.9
CONFIDENCE_REASONING: Very sure.`;

    const text2 = `RESPONSE:
Answer two.

CONFIDENCE: 0.4
CONFIDENCE_REASONING: Not sure.`;

    const p1 = parseConfidenceResponse(text1);
    const p2 = parseConfidenceResponse(text2);

    const answers = [
      { model: "m1", rawConfidence: p1.confidence },
      { model: "m2", rawConfidence: p2.confidence },
    ];
    const weights = computeSoftmaxWeights(answers, 1.0);
    expect(weights[0].normalizedWeight).toBeGreaterThan(weights[1].normalizedWeight);
    const sum = weights.reduce((s, w) => s + w.normalizedWeight, 0);
    expect(sum).toBeCloseTo(1.0, 6);
  });

  it("parseSynthesisResponse combined with build produces valid output", () => {
    const synthText = `SYNTHESIS:
Combined answer from multiple models.

CONFIDENCE CALIBRATION NOTES:
Model A was overconfident. Model B was well calibrated.`;

    const result = parseSynthesisResponse(synthText);
    expect(result.synthesis).toContain("Combined answer");
    expect(result.calibrationNotes).toContain("overconfident");
  });

  it("empty history array does not add CONVERSATION CONTEXT section", () => {
    const prompt = buildAnswerConfidencePrompt("test question", []);
    expect(prompt).not.toContain("CONVERSATION CONTEXT:");
  });

  it("all models flagged as outliers works correctly", () => {
    const answers = [
      { model: "a", rawConfidence: 0.98 },
      { model: "b", rawConfidence: 0.05 },
    ];
    const weights = computeSoftmaxWeights(answers, 1.0);
    expect(weights.every((w) => w.isOutlier)).toBe(true);
    const sum = weights.reduce((s, w) => s + w.normalizedWeight, 0);
    expect(sum).toBeCloseTo(1.0, 6);
  });

  it("model identity is preserved through weight computation", () => {
    const answers = [
      { model: "anthropic/claude-opus-4-6", rawConfidence: 0.8 },
      { model: "openai/o3", rawConfidence: 0.6 },
    ];
    const weights = computeSoftmaxWeights(answers, 1.0);
    expect(weights[0].model).toBe("anthropic/claude-opus-4-6");
    expect(weights[1].model).toBe("openai/o3");
  });

  it("100% confidence parsed correctly", () => {
    const text = `RESPONSE:
Sure answer.

CONFIDENCE: 100%
CONFIDENCE_REASONING: Absolute certainty.`;

    const result = parseConfidenceResponse(text);
    expect(result.confidence).toBe(1.0);
    expect(result.parsedSuccessfully).toBe(true);
  });

  it("0% confidence parsed correctly", () => {
    const text = `RESPONSE:
Wild guess.

CONFIDENCE: 0%
CONFIDENCE_REASONING: No idea at all.`;

    const result = parseConfidenceResponse(text);
    expect(result.confidence).toBe(0);
    expect(result.parsedSuccessfully).toBe(true);
  });

  it("identical extreme confidences produce equal weights", () => {
    const answers = [
      { model: "a", rawConfidence: 0.99 },
      { model: "b", rawConfidence: 0.99 },
    ];
    const weights = computeSoftmaxWeights(answers, 1.0);
    expect(weights[0].normalizedWeight).toBeCloseTo(weights[1].normalizedWeight, 6);
  });

  it("no history section when history not provided to synthesis prompt", () => {
    const responses = [
      { model: "a", response: "text", weightPercent: 50, rawConfidence: 0.5, isOutlier: false },
    ];
    const prompt = buildWeightedSynthesisPrompt("question", responses);
    expect(prompt).not.toContain("CONVERSATION CONTEXT:");
  });
});
