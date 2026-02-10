/**
 * Tests for the Debate mode:
 * - parseRevision
 * - buildRevisionPrompt
 * - buildDebateVotePrompt
 * - buildDebateTitlePrompt
 * - createShuffledLabelMap
 * - wordCount
 * - DEFAULT_DEBATE_CONFIG
 *
 * Note: parseVote and tallyVotes are already tested in vote-mode.test.ts
 * and are reused here without duplication.
 */

import { describe, it, expect } from "vitest";
import {
  parseRevision,
  buildRevisionPrompt,
  buildDebateVotePrompt,
  buildDebateTitlePrompt,
  createShuffledLabelMap,
  wordCount,
  DEFAULT_DEBATE_CONFIG,
} from "@/lib/council/modes/debate";

// ---------------------------------------------------------------------------
// parseRevision
// ---------------------------------------------------------------------------

describe("parseRevision", () => {
  it("parses REVISE with full markers", () => {
    const text = `DECISION: REVISE
REASONING: Response B raised important points about caching.

REVISED RESPONSE:
Here is my improved answer with caching considerations.`;

    const result = parseRevision(text);
    expect(result.decision).toBe("REVISE");
    expect(result.reasoning).toBe(
      "Response B raised important points about caching."
    );
    expect(result.revisedResponse).toBe(
      "Here is my improved answer with caching considerations."
    );
  });

  it("parses STAND decision", () => {
    const text = `DECISION: STAND
REASONING: My original response already covered all key points.

REVISED RESPONSE:
My original answer stands unchanged. TypeScript is a typed superset of JavaScript.`;

    const result = parseRevision(text);
    expect(result.decision).toBe("STAND");
    expect(result.reasoning).toBe(
      "My original response already covered all key points."
    );
    expect(result.revisedResponse).toContain("TypeScript is a typed superset");
  });

  it("parses MERGE decision", () => {
    const text = `DECISION: MERGE
REASONING: Combining insights from Response A and Response C creates a stronger answer.

REVISED RESPONSE:
A comprehensive merged response combining the best of all answers.`;

    const result = parseRevision(text);
    expect(result.decision).toBe("MERGE");
    expect(result.reasoning).toContain("Combining insights");
    expect(result.revisedResponse).toContain("comprehensive merged response");
  });

  it("handles case-insensitive decision", () => {
    const text = `decision: revise
REASONING: Updated.

REVISED RESPONSE:
Updated answer.`;

    const result = parseRevision(text);
    expect(result.decision).toBe("REVISE");
  });

  it("handles bold markdown formatting in DECISION", () => {
    const text = `DECISION: **REVISE**
REASONING: Better approach found.

REVISED RESPONSE:
Improved answer.`;

    const result = parseRevision(text);
    expect(result.decision).toBe("REVISE");
  });

  it("handles missing REVISED RESPONSE marker with fallback", () => {
    const text = `DECISION: REVISE
REASONING: Updated based on feedback.
Here is the improved response without the marker.`;

    const result = parseRevision(text);
    expect(result.decision).toBe("REVISE");
    // Fallback should extract text after reasoning
    expect(result.revisedResponse).toBeTruthy();
  });

  it("returns null decision when DECISION marker is missing", () => {
    const text = `I think the answer should be revised.

REVISED RESPONSE:
Here is a better answer.`;

    const result = parseRevision(text);
    expect(result.decision).toBeNull();
    expect(result.revisedResponse).toBe("Here is a better answer.");
  });

  it("returns all nulls for empty text", () => {
    const result = parseRevision("");
    expect(result.decision).toBeNull();
    expect(result.reasoning).toBeNull();
    expect(result.revisedResponse).toBeNull();
  });

  it("returns all nulls for whitespace-only text", () => {
    const result = parseRevision("   \n  \n  ");
    expect(result.decision).toBeNull();
    expect(result.reasoning).toBeNull();
    expect(result.revisedResponse).toBeNull();
  });

  it("parses multi-line revised response", () => {
    const text = `DECISION: REVISE
REASONING: Added more detail.

REVISED RESPONSE:
First paragraph of the revised answer.

Second paragraph with additional context.

Third paragraph with conclusion.`;

    const result = parseRevision(text);
    expect(result.decision).toBe("REVISE");
    expect(result.revisedResponse).toContain("First paragraph");
    expect(result.revisedResponse).toContain("Second paragraph");
    expect(result.revisedResponse).toContain("Third paragraph");
  });
});

// ---------------------------------------------------------------------------
// buildRevisionPrompt
// ---------------------------------------------------------------------------

describe("buildRevisionPrompt", () => {
  it("includes the original question", () => {
    const prompt = buildRevisionPrompt({
      userQuery: "What is TypeScript?",
      yourOriginalResponse: "TypeScript is a language.",
      otherResponses: [
        { label: "Response A", response: "TS adds types to JS." },
      ],
    });
    expect(prompt).toContain("What is TypeScript?");
  });

  it("includes the model's own original response", () => {
    const prompt = buildRevisionPrompt({
      userQuery: "Q?",
      yourOriginalResponse: "My unique original answer about TypeScript.",
      otherResponses: [
        { label: "Response A", response: "Other answer." },
      ],
    });
    expect(prompt).toContain("My unique original answer about TypeScript.");
    expect(prompt).toContain("YOUR ORIGINAL RESPONSE:");
  });

  it("includes anonymized other responses with labels", () => {
    const prompt = buildRevisionPrompt({
      userQuery: "Q?",
      yourOriginalResponse: "Mine.",
      otherResponses: [
        { label: "Response A", response: "Answer from A." },
        { label: "Response B", response: "Answer from B." },
        { label: "Response C", response: "Answer from C." },
      ],
    });
    expect(prompt).toContain("--- Response A ---");
    expect(prompt).toContain("Answer from A.");
    expect(prompt).toContain("--- Response B ---");
    expect(prompt).toContain("Answer from B.");
    expect(prompt).toContain("--- Response C ---");
    expect(prompt).toContain("Answer from C.");
  });

  it("includes DECISION/STAND/MERGE instructions", () => {
    const prompt = buildRevisionPrompt({
      userQuery: "Q?",
      yourOriginalResponse: "A.",
      otherResponses: [{ label: "Response A", response: "B." }],
    });
    expect(prompt).toContain("REVISE");
    expect(prompt).toContain("STAND");
    expect(prompt).toContain("MERGE");
    expect(prompt).toContain("DECISION:");
    expect(prompt).toContain("REVISED RESPONSE:");
  });

  it("includes instructions about considering other responses", () => {
    const prompt = buildRevisionPrompt({
      userQuery: "Q?",
      yourOriginalResponse: "A.",
      otherResponses: [{ label: "Response A", response: "B." }],
    });
    expect(prompt).toContain("Carefully consider the other responses");
    expect(prompt).toContain("errors or omissions");
  });
});

// ---------------------------------------------------------------------------
// buildDebateVotePrompt
// ---------------------------------------------------------------------------

describe("buildDebateVotePrompt", () => {
  it("includes the user query", () => {
    const prompt = buildDebateVotePrompt("What is Rust?", [
      { label: "Response A", response: "Rust is a systems language." },
    ]);
    expect(prompt).toContain("What is Rust?");
  });

  it("includes all labeled revised responses", () => {
    const prompt = buildDebateVotePrompt("Q?", [
      { label: "Response A", response: "Revised A." },
      { label: "Response B", response: "Revised B." },
      { label: "Response C", response: "Revised C." },
    ]);
    expect(prompt).toContain("--- Response A ---");
    expect(prompt).toContain("Revised A.");
    expect(prompt).toContain("--- Response B ---");
    expect(prompt).toContain("Revised B.");
    expect(prompt).toContain("--- Response C ---");
    expect(prompt).toContain("Revised C.");
  });

  it("includes VOTE: Response X format instruction", () => {
    const prompt = buildDebateVotePrompt("Q?", [
      { label: "Response A", response: "A." },
    ]);
    expect(prompt).toContain("VOTE: Response X");
  });

  it("mentions deliberation context", () => {
    const prompt = buildDebateVotePrompt("Q?", [
      { label: "Response A", response: "A." },
    ]);
    expect(prompt).toContain("round of deliberation");
    expect(prompt).toContain("finalized");
  });
});

// ---------------------------------------------------------------------------
// buildDebateTitlePrompt
// ---------------------------------------------------------------------------

describe("buildDebateTitlePrompt", () => {
  it("includes the user query", () => {
    const prompt = buildDebateTitlePrompt("Should companies adopt a 4-day work week?");
    expect(prompt).toContain("Should companies adopt a 4-day work week?");
  });

  it("requests 3-5 word title", () => {
    const prompt = buildDebateTitlePrompt("Q?");
    expect(prompt).toContain("3-5 words");
  });

  it("requests no quotes or punctuation", () => {
    const prompt = buildDebateTitlePrompt("Q?");
    expect(prompt).toContain("No quotes");
    expect(prompt).toContain("no punctuation");
  });
});

// ---------------------------------------------------------------------------
// createShuffledLabelMap
// ---------------------------------------------------------------------------

describe("createShuffledLabelMap", () => {
  it("returns a valid label map with all models", () => {
    const models = ["model-a", "model-b", "model-c"];
    const map = createShuffledLabelMap(models);

    // All models must be present as values
    const values = Object.values(map);
    expect(values).toContain("model-a");
    expect(values).toContain("model-b");
    expect(values).toContain("model-c");
  });

  it("maps all models to Response A/B/C labels", () => {
    const models = ["model-a", "model-b", "model-c"];
    const map = createShuffledLabelMap(models);

    const labels = Object.keys(map);
    expect(labels).toHaveLength(3);
    expect(labels).toContain("Response A");
    expect(labels).toContain("Response B");
    expect(labels).toContain("Response C");
  });

  it("produces a different order from input on at least some runs", () => {
    const models = [
      "model-a",
      "model-b",
      "model-c",
      "model-d",
      "model-e",
      "model-f",
    ];

    // Run multiple times — with 6 models, probability of same order is 1/720
    let foundDifferent = false;
    for (let i = 0; i < 20; i++) {
      const map = createShuffledLabelMap(models);
      const values = Object.values(map);
      if (values.join(",") !== models.join(",")) {
        foundDifferent = true;
        break;
      }
    }
    expect(foundDifferent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// wordCount
// ---------------------------------------------------------------------------

describe("wordCount", () => {
  it("counts words in normal text", () => {
    expect(wordCount("hello world")).toBe(2);
    expect(wordCount("one two three four five")).toBe(5);
  });

  it("returns 0 for empty string", () => {
    expect(wordCount("")).toBe(0);
  });

  it("returns 0 for whitespace-only string", () => {
    expect(wordCount("   \n  \t  ")).toBe(0);
  });

  it("handles multiple spaces between words", () => {
    expect(wordCount("hello    world   test")).toBe(3);
  });

  it("handles newlines and tabs as word separators", () => {
    expect(wordCount("hello\nworld\tthere")).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_DEBATE_CONFIG
// ---------------------------------------------------------------------------

describe("DEFAULT_DEBATE_CONFIG", () => {
  it("has a models array", () => {
    expect(Array.isArray(DEFAULT_DEBATE_CONFIG.models)).toBe(true);
  });

  it("has at least 3 models (minimum for debate)", () => {
    expect(DEFAULT_DEBATE_CONFIG.models.length).toBeGreaterThanOrEqual(3);
  });

  it("has a positive timeout", () => {
    expect(DEFAULT_DEBATE_CONFIG.timeoutMs).toBeGreaterThan(0);
  });

  it("all models are non-empty strings", () => {
    for (const model of DEFAULT_DEBATE_CONFIG.models) {
      expect(typeof model).toBe("string");
      expect(model.length).toBeGreaterThan(0);
    }
  });
});
