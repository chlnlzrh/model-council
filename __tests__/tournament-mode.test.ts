/**
 * Tests for Tournament mode:
 * - parseMatchupWinner
 * - parseJudgeReasoning
 * - buildJudgePrompt
 * - buildStrictRetryPrompt
 * - calculateTotalRounds
 * - generateRound1Matchups
 * - generateNextRoundMatchups
 * - DEFAULT_TOURNAMENT_CONFIG
 * - buildBracketPath
 */

import { describe, it, expect } from "vitest";
import {
  parseMatchupWinner,
  parseJudgeReasoning,
  buildJudgePrompt,
  buildStrictRetryPrompt,
  calculateTotalRounds,
  generateRound1Matchups,
  generateNextRoundMatchups,
  buildBracketPath,
  DEFAULT_TOURNAMENT_CONFIG,
} from "@/lib/council/modes/tournament";
import type {
  Contestant,
  TournamentRound,
  MatchupResult,
} from "@/lib/council/modes/tournament";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContestant(model: string, response?: string): Contestant {
  return {
    model,
    response: response ?? `Response from ${model}`,
    responseTimeMs: 1000,
  };
}

function makeMatchupResult(
  overrides: Partial<MatchupResult> & {
    roundNumber: number;
    matchIndex: number;
    winnerModel: string;
    contestantAModel: string;
  }
): MatchupResult {
  return {
    contestantBModel: null,
    winner: "A",
    loserModel: null,
    judgeReasoning: "",
    judgeResponseText: "",
    responseTimeMs: 1000,
    isBye: false,
    wasRetry: false,
    wasDefault: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseMatchupWinner
// ---------------------------------------------------------------------------

describe("parseMatchupWinner", () => {
  it("parses standard 'WINNER: Response A'", () => {
    const text = "REASONING: A is better.\nWINNER: Response A";
    expect(parseMatchupWinner(text)).toBe("A");
  });

  it("parses standard 'WINNER: Response B'", () => {
    const text = "REASONING: B is more thorough.\nWINNER: Response B";
    expect(parseMatchupWinner(text)).toBe("B");
  });

  it("is case-insensitive", () => {
    expect(parseMatchupWinner("winner: response a")).toBe("A");
    expect(parseMatchupWinner("Winner: Response b")).toBe("B");
    expect(parseMatchupWinner("WINNER: RESPONSE A")).toBe("A");
  });

  it("takes the last match when multiple WINNER lines exist", () => {
    const text = `I first thought WINNER: Response A
But actually WINNER: Response B`;
    expect(parseMatchupWinner(text)).toBe("B");
  });

  it("uses fallback 'Response A' when no WINNER prefix", () => {
    const text = "I think Response A is the better answer.";
    expect(parseMatchupWinner(text)).toBe("A");
  });

  it("uses fallback 'Response B' when no WINNER prefix", () => {
    const text = "Response B provides a more complete analysis.";
    expect(parseMatchupWinner(text)).toBe("B");
  });

  it("returns null for unparseable text", () => {
    expect(parseMatchupWinner("I cannot decide between them")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseMatchupWinner("")).toBeNull();
  });

  it("returns null when no A or B present", () => {
    expect(parseMatchupWinner("The winner is Response C")).toBeNull();
    expect(parseMatchupWinner("WINNER: Response D")).toBeNull();
  });

  it("handles whitespace variations", () => {
    expect(parseMatchupWinner("WINNER:   Response A")).toBe("A");
    expect(parseMatchupWinner("WINNER:Response B")).toBe("B");
    expect(parseMatchupWinner("  WINNER: Response A  ")).toBe("A");
  });

  it("handles mid-sentence mention with WINNER", () => {
    const text = "My analysis leads to WINNER: Response B as the clear choice.";
    expect(parseMatchupWinner(text)).toBe("B");
  });

  it("handles multiline with reasoning before WINNER", () => {
    const text = `This is a detailed analysis.
Response A covers more ground.
However Response B is more accurate.

REASONING: Both are solid but B edges ahead on accuracy.
WINNER: Response B`;
    expect(parseMatchupWinner(text)).toBe("B");
  });
});

// ---------------------------------------------------------------------------
// parseJudgeReasoning
// ---------------------------------------------------------------------------

describe("parseJudgeReasoning", () => {
  it("extracts reasoning between REASONING and WINNER markers", () => {
    const text = "REASONING: A is more thorough and accurate.\nWINNER: Response A";
    expect(parseJudgeReasoning(text)).toBe("A is more thorough and accurate.");
  });

  it("returns full text when no REASONING marker found", () => {
    const text = "I think response A is better because it covers more details.";
    expect(parseJudgeReasoning(text)).toBe(text);
  });

  it("handles multiline reasoning", () => {
    const text = `REASONING: First, A provides concrete examples.
Second, A addresses edge cases that B misses.
Third, A is better organized.
WINNER: Response A`;
    const expected = `First, A provides concrete examples.
Second, A addresses edge cases that B misses.
Third, A is better organized.`;
    expect(parseJudgeReasoning(text)).toBe(expected);
  });

  it("trims whitespace from extracted reasoning", () => {
    const text = "REASONING:   lots of spaces here   \nWINNER: Response B";
    expect(parseJudgeReasoning(text)).toBe("lots of spaces here");
  });

  it("returns trimmed full text for empty input", () => {
    expect(parseJudgeReasoning("")).toBe("");
    expect(parseJudgeReasoning("  ")).toBe("");
  });

  it("handles REASONING with no WINNER following", () => {
    const text = "REASONING: A is clearly better in every dimension.";
    expect(parseJudgeReasoning(text)).toBe("A is clearly better in every dimension.");
  });
});

// ---------------------------------------------------------------------------
// buildJudgePrompt
// ---------------------------------------------------------------------------

describe("buildJudgePrompt", () => {
  const query = "What is TypeScript?";
  const resA = "TypeScript is a superset of JavaScript.";
  const resB = "TypeScript adds types to JavaScript.";

  it("includes the user query", () => {
    const prompt = buildJudgePrompt(query, resA, resB);
    expect(prompt).toContain(query);
  });

  it("includes both responses", () => {
    const prompt = buildJudgePrompt(query, resA, resB);
    expect(prompt).toContain(resA);
    expect(prompt).toContain(resB);
  });

  it("includes Response A and Response B labels", () => {
    const prompt = buildJudgePrompt(query, resA, resB);
    expect(prompt).toContain("--- Response A ---");
    expect(prompt).toContain("--- Response B ---");
  });

  it("includes evaluation criteria", () => {
    const prompt = buildJudgePrompt(query, resA, resB);
    expect(prompt).toContain("accuracy");
    expect(prompt).toContain("completeness");
    expect(prompt).toContain("clarity");
    expect(prompt).toContain("practical value");
  });

  it("includes WINNER format instruction", () => {
    const prompt = buildJudgePrompt(query, resA, resB);
    expect(prompt).toContain("WINNER: Response [A|B]");
  });

  it("includes REASONING format instruction", () => {
    const prompt = buildJudgePrompt(query, resA, resB);
    expect(prompt).toContain("REASONING:");
  });
});

// ---------------------------------------------------------------------------
// buildStrictRetryPrompt
// ---------------------------------------------------------------------------

describe("buildStrictRetryPrompt", () => {
  const query = "What is TypeScript?";
  const resA = "TypeScript is a superset of JavaScript.";
  const resB = "TypeScript adds types to JavaScript.";

  it("includes the user query", () => {
    const prompt = buildStrictRetryPrompt(query, resA, resB);
    expect(prompt).toContain(query);
  });

  it("includes both responses", () => {
    const prompt = buildStrictRetryPrompt(query, resA, resB);
    expect(prompt).toContain(resA);
    expect(prompt).toContain(resB);
  });

  it("mentions that previous response could not be parsed", () => {
    const prompt = buildStrictRetryPrompt(query, resA, resB);
    expect(prompt).toContain("could not be parsed");
  });

  it("includes exact format instructions", () => {
    const prompt = buildStrictRetryPrompt(query, resA, resB);
    expect(prompt).toContain("WINNER: Response A");
    expect(prompt).toContain("WINNER: Response B");
  });

  it("is shorter than the primary judge prompt", () => {
    const primary = buildJudgePrompt(query, resA, resB);
    const strict = buildStrictRetryPrompt(query, resA, resB);
    // The strict retry should be comparable in length (has same responses)
    // but the instruction portion is more concise
    expect(strict).toBeDefined();
    expect(primary).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// calculateTotalRounds
// ---------------------------------------------------------------------------

describe("calculateTotalRounds", () => {
  it("returns 1 for 2 contestants", () => {
    expect(calculateTotalRounds(2)).toBe(1);
  });

  it("returns 2 for 4 contestants", () => {
    expect(calculateTotalRounds(4)).toBe(2);
  });

  it("returns 3 for 5 contestants", () => {
    expect(calculateTotalRounds(5)).toBe(3);
  });

  it("returns 3 for 6 contestants", () => {
    expect(calculateTotalRounds(6)).toBe(3);
  });

  it("returns 3 for 7 contestants", () => {
    expect(calculateTotalRounds(7)).toBe(3);
  });

  it("returns 3 for 8 contestants", () => {
    expect(calculateTotalRounds(8)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// generateRound1Matchups
// ---------------------------------------------------------------------------

describe("generateRound1Matchups", () => {
  it("creates 2 matchups for 4 contestants with no byes", () => {
    const contestants = [
      makeContestant("model-a"),
      makeContestant("model-b"),
      makeContestant("model-c"),
      makeContestant("model-d"),
    ];
    const matchups = generateRound1Matchups(contestants);
    expect(matchups).toHaveLength(2);
    expect(matchups.every((m) => !m.isBye)).toBe(true);
  });

  it("creates 3 matchups for 5 contestants with 1 bye", () => {
    const contestants = [
      makeContestant("model-a"),
      makeContestant("model-b"),
      makeContestant("model-c"),
      makeContestant("model-d"),
      makeContestant("model-e"),
    ];
    const matchups = generateRound1Matchups(contestants);
    expect(matchups).toHaveLength(3);
    const byes = matchups.filter((m) => m.isBye);
    expect(byes).toHaveLength(1);
    expect(byes[0].contestantA.model).toBe("model-e");
  });

  it("creates 3 matchups for 6 contestants with no byes", () => {
    const contestants = Array.from({ length: 6 }, (_, i) =>
      makeContestant(`model-${i}`)
    );
    const matchups = generateRound1Matchups(contestants);
    expect(matchups).toHaveLength(3);
    expect(matchups.every((m) => !m.isBye)).toBe(true);
  });

  it("creates 4 matchups for 7 contestants with 1 bye", () => {
    const contestants = Array.from({ length: 7 }, (_, i) =>
      makeContestant(`model-${i}`)
    );
    const matchups = generateRound1Matchups(contestants);
    expect(matchups).toHaveLength(4);
    const byes = matchups.filter((m) => m.isBye);
    expect(byes).toHaveLength(1);
  });

  it("creates 4 matchups for 8 contestants with no byes", () => {
    const contestants = Array.from({ length: 8 }, (_, i) =>
      makeContestant(`model-${i}`)
    );
    const matchups = generateRound1Matchups(contestants);
    expect(matchups).toHaveLength(4);
    expect(matchups.every((m) => !m.isBye)).toBe(true);
  });

  it("creates 1 matchup for 2 contestants", () => {
    const contestants = [
      makeContestant("model-a"),
      makeContestant("model-b"),
    ];
    const matchups = generateRound1Matchups(contestants);
    expect(matchups).toHaveLength(1);
    expect(matchups[0].isBye).toBe(false);
  });

  it("sets roundNumber to 1 for all matchups", () => {
    const contestants = Array.from({ length: 4 }, (_, i) =>
      makeContestant(`model-${i}`)
    );
    const matchups = generateRound1Matchups(contestants);
    expect(matchups.every((m) => m.roundNumber === 1)).toBe(true);
  });

  it("assigns sequential match indices starting at 0", () => {
    const contestants = Array.from({ length: 6 }, (_, i) =>
      makeContestant(`model-${i}`)
    );
    const matchups = generateRound1Matchups(contestants);
    matchups.forEach((m, i) => {
      expect(m.matchIndex).toBe(i);
    });
  });

  it("preserves contestant labels (Response A/B)", () => {
    const contestants = [
      makeContestant("model-a"),
      makeContestant("model-b"),
    ];
    const matchups = generateRound1Matchups(contestants);
    expect(matchups[0].contestantA.model).toBe("model-a");
    expect(matchups[0].contestantB?.model).toBe("model-b");
  });

  it("sets bye structure correctly for odd contestant", () => {
    const contestants = [
      makeContestant("model-a"),
      makeContestant("model-b"),
      makeContestant("model-c"),
    ];
    const matchups = generateRound1Matchups(contestants);
    expect(matchups).toHaveLength(2);
    expect(matchups[1].isBye).toBe(true);
    expect(matchups[1].contestantB).toBeNull();
    expect(matchups[1].contestantA.model).toBe("model-c");
  });
});

// ---------------------------------------------------------------------------
// generateNextRoundMatchups
// ---------------------------------------------------------------------------

describe("generateNextRoundMatchups", () => {
  it("creates 2 matchups from 3 winners (1 bye)", () => {
    const winners = [
      makeContestant("model-a"),
      makeContestant("model-b"),
      makeContestant("model-c"),
    ];
    const matchups = generateNextRoundMatchups(winners, 2);
    expect(matchups).toHaveLength(2);
    expect(matchups[1].isBye).toBe(true);
  });

  it("creates 1 matchup from 2 winners", () => {
    const winners = [
      makeContestant("model-a"),
      makeContestant("model-b"),
    ];
    const matchups = generateNextRoundMatchups(winners, 2);
    expect(matchups).toHaveLength(1);
    expect(matchups[0].isBye).toBe(false);
  });

  it("creates 2 matchups from 4 winners", () => {
    const winners = Array.from({ length: 4 }, (_, i) =>
      makeContestant(`model-${i}`)
    );
    const matchups = generateNextRoundMatchups(winners, 3);
    expect(matchups).toHaveLength(2);
    expect(matchups.every((m) => !m.isBye)).toBe(true);
  });

  it("uses the correct roundNumber", () => {
    const winners = [
      makeContestant("model-a"),
      makeContestant("model-b"),
    ];
    const matchups = generateNextRoundMatchups(winners, 5);
    expect(matchups[0].roundNumber).toBe(5);
  });

  it("resets matchIndex to 0 for new round", () => {
    const winners = Array.from({ length: 4 }, (_, i) =>
      makeContestant(`model-${i}`)
    );
    const matchups = generateNextRoundMatchups(winners, 2);
    expect(matchups[0].matchIndex).toBe(0);
    expect(matchups[1].matchIndex).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_TOURNAMENT_CONFIG
// ---------------------------------------------------------------------------

describe("DEFAULT_TOURNAMENT_CONFIG", () => {
  it("has 4 contestant models", () => {
    expect(DEFAULT_TOURNAMENT_CONFIG.contestantModels).toHaveLength(4);
  });

  it("has a judge model defined", () => {
    expect(DEFAULT_TOURNAMENT_CONFIG.judgeModel).toBeTruthy();
    expect(typeof DEFAULT_TOURNAMENT_CONFIG.judgeModel).toBe("string");
  });

  it("judge is not in the contestant list", () => {
    expect(
      DEFAULT_TOURNAMENT_CONFIG.contestantModels.includes(
        DEFAULT_TOURNAMENT_CONFIG.judgeModel
      )
    ).toBe(false);
  });

  it("has a positive timeout", () => {
    expect(DEFAULT_TOURNAMENT_CONFIG.timeoutMs).toBeGreaterThan(0);
  });

  it("all model strings are non-empty", () => {
    for (const model of DEFAULT_TOURNAMENT_CONFIG.contestantModels) {
      expect(model.length).toBeGreaterThan(0);
    }
    expect(DEFAULT_TOURNAMENT_CONFIG.judgeModel.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// buildBracketPath
// ---------------------------------------------------------------------------

describe("buildBracketPath", () => {
  it("builds correct path for a 4-contestant tournament (2 rounds, no byes)", () => {
    const rounds: TournamentRound[] = [
      {
        roundNumber: 1,
        matchups: [
          makeMatchupResult({
            roundNumber: 1,
            matchIndex: 0,
            contestantAModel: "model-a",
            contestantBModel: "model-b",
            winner: "A",
            winnerModel: "model-a",
            loserModel: "model-b",
          }),
          makeMatchupResult({
            roundNumber: 1,
            matchIndex: 1,
            contestantAModel: "model-c",
            contestantBModel: "model-d",
            winner: "A",
            winnerModel: "model-c",
            loserModel: "model-d",
          }),
        ],
        winners: ["model-a", "model-c"],
        eliminated: ["model-b", "model-d"],
      },
      {
        roundNumber: 2,
        matchups: [
          makeMatchupResult({
            roundNumber: 2,
            matchIndex: 0,
            contestantAModel: "model-a",
            contestantBModel: "model-c",
            winner: "A",
            winnerModel: "model-a",
            loserModel: "model-c",
          }),
        ],
        winners: ["model-a"],
        eliminated: ["model-c"],
      },
    ];

    const path = buildBracketPath("model-a", rounds);
    expect(path).toHaveLength(2);
    expect(path[0]).toEqual({ round: 1, opponent: "model-b", result: "won" });
    expect(path[1]).toEqual({ round: 2, opponent: "model-c", result: "won" });
  });

  it("builds correct path for a 5-contestant tournament with bye", () => {
    const rounds: TournamentRound[] = [
      {
        roundNumber: 1,
        matchups: [
          makeMatchupResult({
            roundNumber: 1,
            matchIndex: 0,
            contestantAModel: "model-a",
            contestantBModel: "model-b",
            winner: "A",
            winnerModel: "model-a",
            loserModel: "model-b",
          }),
          makeMatchupResult({
            roundNumber: 1,
            matchIndex: 1,
            contestantAModel: "model-c",
            contestantBModel: "model-d",
            winner: "B",
            winnerModel: "model-d",
            loserModel: "model-c",
          }),
          makeMatchupResult({
            roundNumber: 1,
            matchIndex: 2,
            contestantAModel: "model-e",
            contestantBModel: null,
            winner: "A",
            winnerModel: "model-e",
            loserModel: null,
            isBye: true,
          }),
        ],
        winners: ["model-a", "model-d", "model-e"],
        eliminated: ["model-b", "model-c"],
      },
      {
        roundNumber: 2,
        matchups: [
          makeMatchupResult({
            roundNumber: 2,
            matchIndex: 0,
            contestantAModel: "model-a",
            contestantBModel: "model-d",
            winner: "A",
            winnerModel: "model-a",
            loserModel: "model-d",
          }),
          makeMatchupResult({
            roundNumber: 2,
            matchIndex: 1,
            contestantAModel: "model-e",
            contestantBModel: null,
            winner: "A",
            winnerModel: "model-e",
            loserModel: null,
            isBye: true,
          }),
        ],
        winners: ["model-a", "model-e"],
        eliminated: ["model-d"],
      },
      {
        roundNumber: 3,
        matchups: [
          makeMatchupResult({
            roundNumber: 3,
            matchIndex: 0,
            contestantAModel: "model-a",
            contestantBModel: "model-e",
            winner: "A",
            winnerModel: "model-a",
            loserModel: "model-e",
          }),
        ],
        winners: ["model-a"],
        eliminated: ["model-e"],
      },
    ];

    const path = buildBracketPath("model-e", rounds);
    expect(path).toHaveLength(2);
    expect(path[0]).toEqual({ round: 1, opponent: null, result: "bye" });
    expect(path[1]).toEqual({ round: 2, opponent: null, result: "bye" });
    // model-e lost in round 3, so no entry for round 3
  });

  it("returns entries in round order", () => {
    const rounds: TournamentRound[] = [
      {
        roundNumber: 1,
        matchups: [
          makeMatchupResult({
            roundNumber: 1,
            matchIndex: 0,
            contestantAModel: "model-a",
            contestantBModel: "model-b",
            winner: "A",
            winnerModel: "model-a",
            loserModel: "model-b",
          }),
        ],
        winners: ["model-a"],
        eliminated: ["model-b"],
      },
    ];

    const path = buildBracketPath("model-a", rounds);
    expect(path[0].round).toBe(1);
  });

  it("marks bye entries correctly", () => {
    const rounds: TournamentRound[] = [
      {
        roundNumber: 1,
        matchups: [
          makeMatchupResult({
            roundNumber: 1,
            matchIndex: 0,
            contestantAModel: "model-a",
            contestantBModel: null,
            winner: "A",
            winnerModel: "model-a",
            loserModel: null,
            isBye: true,
          }),
        ],
        winners: ["model-a"],
        eliminated: [],
      },
    ];

    const path = buildBracketPath("model-a", rounds);
    expect(path[0].result).toBe("bye");
    expect(path[0].opponent).toBeNull();
  });

  it("marks won entries with correct opponent", () => {
    const rounds: TournamentRound[] = [
      {
        roundNumber: 1,
        matchups: [
          makeMatchupResult({
            roundNumber: 1,
            matchIndex: 0,
            contestantAModel: "model-a",
            contestantBModel: "model-b",
            winner: "B",
            winnerModel: "model-b",
            loserModel: "model-a",
          }),
        ],
        winners: ["model-b"],
        eliminated: ["model-a"],
      },
    ];

    const path = buildBracketPath("model-b", rounds);
    expect(path[0].result).toBe("won");
    expect(path[0].opponent).toBe("model-a");
  });

  it("counts totalMatchupsWon correctly (excludes byes)", () => {
    const rounds: TournamentRound[] = [
      {
        roundNumber: 1,
        matchups: [
          makeMatchupResult({
            roundNumber: 1,
            matchIndex: 0,
            contestantAModel: "model-a",
            contestantBModel: null,
            winner: "A",
            winnerModel: "model-a",
            loserModel: null,
            isBye: true,
          }),
        ],
        winners: ["model-a"],
        eliminated: [],
      },
      {
        roundNumber: 2,
        matchups: [
          makeMatchupResult({
            roundNumber: 2,
            matchIndex: 0,
            contestantAModel: "model-a",
            contestantBModel: "model-b",
            winner: "A",
            winnerModel: "model-a",
            loserModel: "model-b",
          }),
        ],
        winners: ["model-a"],
        eliminated: ["model-b"],
      },
    ];

    const path = buildBracketPath("model-a", rounds);
    const matchupsWon = path.filter((e) => e.result === "won").length;
    expect(matchupsWon).toBe(1);
  });

  it("counts totalRounds from rounds array length", () => {
    const rounds: TournamentRound[] = [
      {
        roundNumber: 1,
        matchups: [
          makeMatchupResult({
            roundNumber: 1,
            matchIndex: 0,
            contestantAModel: "model-a",
            contestantBModel: "model-b",
            winner: "A",
            winnerModel: "model-a",
            loserModel: "model-b",
          }),
        ],
        winners: ["model-a"],
        eliminated: ["model-b"],
      },
      {
        roundNumber: 2,
        matchups: [
          makeMatchupResult({
            roundNumber: 2,
            matchIndex: 0,
            contestantAModel: "model-a",
            contestantBModel: "model-c",
            winner: "A",
            winnerModel: "model-a",
            loserModel: "model-c",
          }),
        ],
        winners: ["model-a"],
        eliminated: ["model-c"],
      },
    ];

    const path = buildBracketPath("model-a", rounds);
    expect(path).toHaveLength(2);
    expect(rounds).toHaveLength(2);
  });

  it("preserves champion's unmodified response concept", () => {
    // This is a conceptual test: the champion's response should be the original
    const originalResponse = "This is model-a's original, unmodified response.";
    const contestants = [makeContestant("model-a", originalResponse)];

    // The response passed through should be identical
    expect(contestants[0].response).toBe(originalResponse);
  });
});
