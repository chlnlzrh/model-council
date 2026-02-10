/**
 * Tests for the Vote mode:
 * - parseVote
 * - tallyVotes
 * - buildVotePrompt
 * - buildTiebreakerPrompt
 * - VoteConfig defaults
 */

import { describe, it, expect } from "vitest";
import {
  parseVote,
  tallyVotes,
  buildVotePrompt,
  buildTiebreakerPrompt,
  DEFAULT_VOTE_CONFIG,
} from "@/lib/council/modes/vote";
import type { VoteResponse } from "@/lib/council/modes/vote";
import type { LabelMap } from "@/lib/council/types";

// ---------------------------------------------------------------------------
// parseVote
// ---------------------------------------------------------------------------

describe("parseVote", () => {
  it("parses standard 'VOTE: Response A' format", () => {
    const text = `After careful consideration, Response B provides the most thorough and accurate answer.

VOTE: Response B`;
    expect(parseVote(text)).toBe("Response B");
  });

  it("parses uppercase letters", () => {
    expect(parseVote("VOTE: Response C")).toBe("Response C");
    expect(parseVote("VOTE: Response A")).toBe("Response A");
    expect(parseVote("VOTE: Response E")).toBe("Response E");
  });

  it("handles case-insensitive 'vote:' prefix", () => {
    expect(parseVote("vote: Response A")).toBe("Response A");
    expect(parseVote("Vote: Response B")).toBe("Response B");
    expect(parseVote("VOTE: response c")).toBe("Response C");
  });

  it("takes the last VOTE match when multiple exist", () => {
    const text = `I initially considered VOTE: Response A but changed my mind.
After further thought:
VOTE: Response C`;
    expect(parseVote(text)).toBe("Response C");
  });

  it("falls back to last 'Response X' when no VOTE: prefix", () => {
    const text = `I think Response B is the best answer here.`;
    expect(parseVote(text)).toBe("Response B");
  });

  it("falls back to last Response X with multiple mentions", () => {
    const text = `Response A is good but Response C is better overall.`;
    expect(parseVote(text)).toBe("Response C");
  });

  it("returns null for unparseable text", () => {
    expect(parseVote("I cannot decide")).toBeNull();
    expect(parseVote("")).toBeNull();
    expect(parseVote("The best answer is number 2")).toBeNull();
  });

  it("returns null for text with no response labels", () => {
    expect(parseVote("VOTE: Option 3")).toBeNull();
    expect(parseVote("I vote for the second one")).toBeNull();
  });

  it("handles whitespace variations in VOTE format", () => {
    expect(parseVote("VOTE:   Response A")).toBe("Response A");
    expect(parseVote("VOTE:Response B")).toBe("Response B");
    expect(parseVote("  VOTE: Response C  ")).toBe("Response C");
  });

  it("handles Response X mid-sentence with VOTE:", () => {
    const text = "My vote goes to VOTE: Response D as the winner.";
    expect(parseVote(text)).toBe("Response D");
  });
});

// ---------------------------------------------------------------------------
// tallyVotes
// ---------------------------------------------------------------------------

describe("tallyVotes", () => {
  const labelMap: LabelMap = {
    "Response A": "model-a",
    "Response B": "model-b",
    "Response C": "model-c",
  };

  it("counts votes correctly with clear winner", () => {
    const votes: VoteResponse[] = [
      { model: "model-a", voteText: "VOTE: Response B", votedFor: "Response B", responseTimeMs: 100 },
      { model: "model-b", voteText: "VOTE: Response B", votedFor: "Response B", responseTimeMs: 200 },
      { model: "model-c", voteText: "VOTE: Response A", votedFor: "Response A", responseTimeMs: 150 },
    ];

    const result = tallyVotes(votes, labelMap);
    expect(result.tallies["Response B"]).toBe(2);
    expect(result.tallies["Response A"]).toBe(1);
    expect(result.winners).toEqual(["Response B"]);
    expect(result.isTie).toBe(false);
    expect(result.totalValidVotes).toBe(3);
    expect(result.validVotes).toHaveLength(3);
    expect(result.invalidVotes).toHaveLength(0);
  });

  it("detects a tie", () => {
    const votes: VoteResponse[] = [
      { model: "model-a", voteText: "VOTE: Response B", votedFor: "Response B", responseTimeMs: 100 },
      { model: "model-b", voteText: "VOTE: Response A", votedFor: "Response A", responseTimeMs: 200 },
      { model: "model-c", voteText: "VOTE: Response C", votedFor: "Response C", responseTimeMs: 150 },
    ];

    const result = tallyVotes(votes, labelMap);
    expect(result.isTie).toBe(true);
    expect(result.winners).toHaveLength(3);
    expect(result.winners).toContain("Response A");
    expect(result.winners).toContain("Response B");
    expect(result.winners).toContain("Response C");
  });

  it("detects a two-way tie", () => {
    const votes: VoteResponse[] = [
      { model: "model-a", voteText: "VOTE: Response A", votedFor: "Response A", responseTimeMs: 100 },
      { model: "model-b", voteText: "VOTE: Response B", votedFor: "Response B", responseTimeMs: 200 },
    ];

    const result = tallyVotes(votes, labelMap);
    expect(result.isTie).toBe(true);
    expect(result.winners).toHaveLength(2);
    expect(result.totalValidVotes).toBe(2);
  });

  it("handles invalid votes (null votedFor)", () => {
    const votes: VoteResponse[] = [
      { model: "model-a", voteText: "VOTE: Response B", votedFor: "Response B", responseTimeMs: 100 },
      { model: "model-b", voteText: "I can't decide", votedFor: null, responseTimeMs: 200 },
      { model: "model-c", voteText: "VOTE: Response A", votedFor: "Response A", responseTimeMs: 150 },
    ];

    const result = tallyVotes(votes, labelMap);
    expect(result.validVotes).toHaveLength(2);
    expect(result.invalidVotes).toHaveLength(1);
    expect(result.invalidVotes[0].model).toBe("model-b");
    expect(result.totalValidVotes).toBe(2);
  });

  it("handles votes for non-existent labels as invalid", () => {
    const votes: VoteResponse[] = [
      { model: "model-a", voteText: "VOTE: Response D", votedFor: "Response D", responseTimeMs: 100 },
      { model: "model-b", voteText: "VOTE: Response A", votedFor: "Response A", responseTimeMs: 200 },
    ];

    const result = tallyVotes(votes, labelMap);
    expect(result.validVotes).toHaveLength(1);
    expect(result.invalidVotes).toHaveLength(1);
    expect(result.winners).toEqual(["Response A"]);
  });

  it("handles all invalid votes", () => {
    const votes: VoteResponse[] = [
      { model: "model-a", voteText: "I don't know", votedFor: null, responseTimeMs: 100 },
      { model: "model-b", voteText: "No preference", votedFor: null, responseTimeMs: 200 },
    ];

    const result = tallyVotes(votes, labelMap);
    expect(result.totalValidVotes).toBe(0);
    expect(result.invalidVotes).toHaveLength(2);
    expect(result.winners).toHaveLength(0);
    expect(result.isTie).toBe(false);
  });

  it("handles empty votes array", () => {
    const result = tallyVotes([], labelMap);
    expect(result.totalValidVotes).toBe(0);
    expect(result.winners).toHaveLength(0);
    expect(result.isTie).toBe(false);
  });

  it("handles unanimous vote", () => {
    const votes: VoteResponse[] = [
      { model: "model-a", voteText: "VOTE: Response C", votedFor: "Response C", responseTimeMs: 100 },
      { model: "model-b", voteText: "VOTE: Response C", votedFor: "Response C", responseTimeMs: 200 },
      { model: "model-c", voteText: "VOTE: Response C", votedFor: "Response C", responseTimeMs: 150 },
    ];

    const result = tallyVotes(votes, labelMap);
    expect(result.winners).toEqual(["Response C"]);
    expect(result.tallies["Response C"]).toBe(3);
    expect(result.isTie).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildVotePrompt
// ---------------------------------------------------------------------------

describe("buildVotePrompt", () => {
  it("includes the user query", () => {
    const prompt = buildVotePrompt("What is TypeScript?", [
      { label: "Response A", response: "TS is a typed superset of JS." },
      { label: "Response B", response: "TypeScript adds static types." },
    ]);
    expect(prompt).toContain("What is TypeScript?");
  });

  it("includes all labeled responses", () => {
    const prompt = buildVotePrompt("Test query?", [
      { label: "Response A", response: "Answer one." },
      { label: "Response B", response: "Answer two." },
      { label: "Response C", response: "Answer three." },
    ]);
    expect(prompt).toContain("--- Response A ---");
    expect(prompt).toContain("Answer one.");
    expect(prompt).toContain("--- Response B ---");
    expect(prompt).toContain("Answer two.");
    expect(prompt).toContain("--- Response C ---");
    expect(prompt).toContain("Answer three.");
  });

  it("instructs for VOTE: Response X format", () => {
    const prompt = buildVotePrompt("Q?", [
      { label: "Response A", response: "A" },
    ]);
    expect(prompt).toContain("VOTE: Response X");
  });

  it("mentions evaluation criteria", () => {
    const prompt = buildVotePrompt("Q?", [
      { label: "Response A", response: "A" },
    ]);
    expect(prompt).toContain("accuracy");
    expect(prompt).toContain("completeness");
    expect(prompt).toContain("clarity");
  });
});

// ---------------------------------------------------------------------------
// buildTiebreakerPrompt
// ---------------------------------------------------------------------------

describe("buildTiebreakerPrompt", () => {
  it("includes the original question", () => {
    const prompt = buildTiebreakerPrompt("What is Rust?", [
      { label: "Response A", response: "Rust is a systems language.", voteCount: 2 },
      { label: "Response B", response: "Rust ensures memory safety.", voteCount: 2 },
    ]);
    expect(prompt).toContain("What is Rust?");
  });

  it("includes vote counts for tied responses", () => {
    const prompt = buildTiebreakerPrompt("Q?", [
      { label: "Response A", response: "A", voteCount: 3 },
      { label: "Response B", response: "B", voteCount: 3 },
    ]);
    expect(prompt).toContain("3 votes");
    expect(prompt).toContain("Response A");
    expect(prompt).toContain("Response B");
  });

  it("mentions tie in the prompt", () => {
    const prompt = buildTiebreakerPrompt("Q?", [
      { label: "Response A", response: "A", voteCount: 1 },
      { label: "Response B", response: "B", voteCount: 1 },
    ]);
    expect(prompt).toContain("tie");
  });

  it("includes all tied responses", () => {
    const prompt = buildTiebreakerPrompt("Q?", [
      { label: "Response A", response: "Answer A", voteCount: 2 },
      { label: "Response C", response: "Answer C", voteCount: 2 },
      { label: "Response D", response: "Answer D", voteCount: 2 },
    ]);
    expect(prompt).toContain("--- Response A");
    expect(prompt).toContain("--- Response C");
    expect(prompt).toContain("--- Response D");
    expect(prompt).toContain("Answer A");
    expect(prompt).toContain("Answer C");
    expect(prompt).toContain("Answer D");
  });

  it("instructs for VOTE: Response X format", () => {
    const prompt = buildTiebreakerPrompt("Q?", [
      { label: "Response A", response: "A", voteCount: 1 },
      { label: "Response B", response: "B", voteCount: 1 },
    ]);
    expect(prompt).toContain("VOTE: Response X");
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_VOTE_CONFIG
// ---------------------------------------------------------------------------

describe("DEFAULT_VOTE_CONFIG", () => {
  it("has councilModels array", () => {
    expect(Array.isArray(DEFAULT_VOTE_CONFIG.councilModels)).toBe(true);
    expect(DEFAULT_VOTE_CONFIG.councilModels.length).toBeGreaterThanOrEqual(3);
  });

  it("has a chairmanModel string", () => {
    expect(typeof DEFAULT_VOTE_CONFIG.chairmanModel).toBe("string");
    expect(DEFAULT_VOTE_CONFIG.chairmanModel.length).toBeGreaterThan(0);
  });

  it("has a timeout", () => {
    expect(DEFAULT_VOTE_CONFIG.timeoutMs).toBeGreaterThan(0);
  });
});
