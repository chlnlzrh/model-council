import { describe, it, expect } from "vitest";
import {
  parseRanking,
  calculateAggregateRankings,
  createLabelMap,
} from "@/lib/council/ranking-parser";

// ---------------------------------------------------------------------------
// parseRanking
// ---------------------------------------------------------------------------

describe("parseRanking", () => {
  it("parses a well-formatted FINAL RANKING section", () => {
    const text = `Response A provides good detail...
Response B is accurate but lacks depth...
Response C offers the most comprehensive answer...

FINAL RANKING:
1. Response C
2. Response A
3. Response B`;

    const result = parseRanking(text);
    expect(result).toEqual([
      { label: "Response C", position: 1 },
      { label: "Response A", position: 2 },
      { label: "Response B", position: 3 },
    ]);
  });

  it("handles case-insensitive FINAL RANKING marker", () => {
    const text = `Some evaluation text...

Final Ranking:
1. Response B
2. Response A`;

    const result = parseRanking(text);
    expect(result).toEqual([
      { label: "Response B", position: 1 },
      { label: "Response A", position: 2 },
    ]);
  });

  it("handles extra whitespace in ranking entries", () => {
    const text = `FINAL RANKING:
1.  Response A
2.   Response B
3. Response C`;

    const result = parseRanking(text);
    expect(result).toHaveLength(3);
    expect(result[0].label).toBe("Response A");
    expect(result[1].label).toBe("Response B");
    expect(result[2].label).toBe("Response C");
  });

  it("falls back to Response X patterns in ranking section when no numbered list", () => {
    const text = `FINAL RANKING:
Response B is the best, followed by Response A, then Response C.`;

    const result = parseRanking(text);
    expect(result).toEqual([
      { label: "Response B", position: 1 },
      { label: "Response A", position: 2 },
      { label: "Response C", position: 3 },
    ]);
  });

  it("falls back to global Response X patterns when no FINAL RANKING marker", () => {
    const text = `I think Response B is best, then Response A.`;

    const result = parseRanking(text);
    expect(result).toEqual([
      { label: "Response B", position: 1 },
      { label: "Response A", position: 2 },
    ]);
  });

  it("returns empty array for empty string", () => {
    expect(parseRanking("")).toEqual([]);
  });

  it("returns empty array for text with no Response mentions", () => {
    expect(parseRanking("This text has no rankings.")).toEqual([]);
  });

  it("handles five models (A through E)", () => {
    const text = `FINAL RANKING:
1. Response D
2. Response A
3. Response E
4. Response B
5. Response C`;

    const result = parseRanking(text);
    expect(result).toHaveLength(5);
    expect(result[0]).toEqual({ label: "Response D", position: 1 });
    expect(result[4]).toEqual({ label: "Response C", position: 5 });
  });

  it("ignores text before the FINAL RANKING marker", () => {
    const text = `I think Response A is best overall.

But wait, let me reconsider...

FINAL RANKING:
1. Response B
2. Response A`;

    const result = parseRanking(text);
    expect(result).toEqual([
      { label: "Response B", position: 1 },
      { label: "Response A", position: 2 },
    ]);
  });

  it("handles FINAL RANKING with additional text after entries", () => {
    const text = `FINAL RANKING:
1. Response A (excellent answer)
2. Response B (good but verbose)
3. Response C (needs improvement)`;

    // Should still extract "Response A", "Response B", "Response C"
    const result = parseRanking(text);
    expect(result).toHaveLength(3);
    expect(result[0].label).toBe("Response A");
  });
});

// ---------------------------------------------------------------------------
// calculateAggregateRankings
// ---------------------------------------------------------------------------

describe("calculateAggregateRankings", () => {
  const labelToModel = {
    "Response A": "openai/gpt-4o",
    "Response B": "anthropic/claude-sonnet-4",
    "Response C": "google/gemini-2.5-flash",
  };

  it("calculates average rankings correctly", () => {
    const rankings = [
      // Evaluator 1: C > A > B
      [
        { label: "Response C", position: 1 },
        { label: "Response A", position: 2 },
        { label: "Response B", position: 3 },
      ],
      // Evaluator 2: A > C > B
      [
        { label: "Response A", position: 1 },
        { label: "Response C", position: 2 },
        { label: "Response B", position: 3 },
      ],
      // Evaluator 3: A > B > C
      [
        { label: "Response A", position: 1 },
        { label: "Response B", position: 2 },
        { label: "Response C", position: 3 },
      ],
    ];

    const result = calculateAggregateRankings(rankings, labelToModel);

    // A: (2+1+1)/3 = 1.33
    // C: (1+2+3)/3 = 2.00
    // B: (3+3+2)/3 = 2.67
    expect(result[0].model).toBe("openai/gpt-4o");
    expect(result[0].averageRank).toBeCloseTo(1.33, 1);
    expect(result[0].rankingsCount).toBe(3);

    expect(result[1].model).toBe("google/gemini-2.5-flash");
    expect(result[1].averageRank).toBe(2);

    expect(result[2].model).toBe("anthropic/claude-sonnet-4");
    expect(result[2].averageRank).toBeCloseTo(2.67, 1);
  });

  it("handles missing labels gracefully", () => {
    const rankings = [
      [
        { label: "Response A", position: 1 },
        { label: "Response Z", position: 2 }, // not in label map
      ],
    ];

    const result = calculateAggregateRankings(rankings, labelToModel);
    expect(result).toHaveLength(1);
    expect(result[0].model).toBe("openai/gpt-4o");
  });

  it("returns empty array for empty rankings", () => {
    expect(calculateAggregateRankings([], labelToModel)).toEqual([]);
  });

  it("sorts by average rank ascending (best first)", () => {
    const rankings = [
      [
        { label: "Response B", position: 1 },
        { label: "Response A", position: 2 },
      ],
    ];

    const result = calculateAggregateRankings(rankings, labelToModel);
    expect(result[0].model).toBe("anthropic/claude-sonnet-4");
    expect(result[1].model).toBe("openai/gpt-4o");
  });
});

// ---------------------------------------------------------------------------
// createLabelMap
// ---------------------------------------------------------------------------

describe("createLabelMap", () => {
  it("creates sequential labels starting from A", () => {
    const models = ["openai/gpt-4o", "anthropic/claude-sonnet-4"];
    const map = createLabelMap(models);

    expect(map).toEqual({
      "Response A": "openai/gpt-4o",
      "Response B": "anthropic/claude-sonnet-4",
    });
  });

  it("handles single model", () => {
    const map = createLabelMap(["openai/gpt-4o"]);
    expect(map).toEqual({ "Response A": "openai/gpt-4o" });
  });

  it("handles empty array", () => {
    expect(createLabelMap([])).toEqual({});
  });

  it("handles five models", () => {
    const models = ["m1", "m2", "m3", "m4", "m5"];
    const map = createLabelMap(models);
    expect(Object.keys(map)).toHaveLength(5);
    expect(map["Response E"]).toBe("m5");
  });
});
